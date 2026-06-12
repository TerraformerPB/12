import { events } from '../core/EventBus';
import {
  ALLY_PRICE_BONUS,
  CARAVAN_BATCH,
  CARAVAN_RELATION_GAIN,
  CARAVAN_TRAVEL_SECONDS,
  CONTRACT_AMOUNT_MAX,
  CONTRACT_AMOUNT_MIN,
  CONTRACT_CHANCE_PER_MIN,
  CONTRACT_DURATION_SECONDS,
  CONTRACT_RELATION_GAIN,
  CONTRACT_RELATION_PENALTY,
  CONTRACT_REWARD_FACTOR,
  GIFT_GOLD_COST,
  GIFT_RELATION_GAIN,
  PRICE_RECOVERY_PER_MIN,
  PRICE_SATURATION_PER_BATCH,
  RAID_BASE_STRENGTH,
  RAID_INTERVAL_SECONDS,
  RAID_STRENGTH_GROWTH,
  RELATION_ALLY_THRESHOLD,
  RELATION_DECAY_PER_MIN,
  RELATION_REST,
  RELATION_START,
  RELATION_WAR_THRESHOLD,
  TICK_RATE,
  TRIBUTE_GOLD_COST,
  TRIBUTE_RELATION,
  type ResourceId,
} from '../data/config';
import { FACTION_IDS, FACTIONS, factionPrice, getFaction, type FactionId } from '../data/factions';
import type { ResourceStore } from './EconomySystem';

export interface CaravanState {
  factionId: FactionId;
  resource: ResourceId;
  amount: number;
  /** Diplomacy ticks remaining until the caravan returns. */
  ticksLeft: number;
}

export interface ContractState {
  factionId: FactionId;
  resource: ResourceId;
  amount: number;
  /** Gold paid on delivery (computed when posted). */
  reward: number;
  ticksLeft: number;
}

export interface DiplomacySave {
  relations: Record<FactionId, number>;
  caravans: CaravanState[];
  raidCooldowns: Record<FactionId, number>;
  raidCounts: Record<FactionId, number>;
  /** Since phase 19 (older v10 saves restore with defaults). */
  saturation?: Record<FactionId, Partial<Record<ResourceId, number>>>;
  contracts?: ContractState[];
}

export interface DiplomacyContext {
  store: ResourceStore;
  /** Spawn a faction raid of the given strength; returns units spawned. */
  spawnRaid(strength: number): number;
  /** Caravans grant prestige on return. */
  onCaravanReturned(gold: number): void;
  /** Fulfilled delivery contracts grant extra prestige. */
  onContractFulfilled(): void;
}

/**
 * Empire scenario: neighbour relations, trade caravans and faction wars.
 * War is never scheduled — it is the consequence of letting a relation
 * rot below the threshold; peace costs tribute or patience.
 */
export class DiplomacySystem {
  private ctx: DiplomacyContext;
  relations: Record<FactionId, number>;
  caravans: CaravanState[] = [];
  /** Open delivery requests, at most one per faction. */
  contracts: ContractState[] = [];
  /** Market saturation per faction and good (dynamic prices). */
  private saturation: Record<FactionId, Partial<Record<ResourceId, number>>>;
  private raidCooldowns: Record<FactionId, number>;
  private raidCounts: Record<FactionId, number>;
  private tickCount = 0;

  constructor(ctx: DiplomacyContext) {
    this.ctx = ctx;
    this.relations = Object.fromEntries(FACTION_IDS.map((f) => [f, RELATION_START])) as Record<
      FactionId,
      number
    >;
    this.raidCooldowns = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<
      FactionId,
      number
    >;
    this.raidCounts = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<
      FactionId,
      number
    >;
    this.saturation = Object.fromEntries(FACTION_IDS.map((f) => [f, {}])) as Record<
      FactionId,
      Partial<Record<ResourceId, number>>
    >;
  }

  /**
   * Effective gold per unit when selling to a faction right now: the base
   * faction price, dampened by market saturation (every sold batch floods
   * the market, recovery takes minutes) and boosted for allies.
   */
  effectivePrice(id: FactionId, resource: ResourceId): number {
    const sat = this.saturation[id][resource] ?? 0;
    const ally = this.relations[id] >= RELATION_ALLY_THRESHOLD ? ALLY_PRICE_BONUS : 1;
    return (factionPrice(id, resource) * ally) / (1 + sat);
  }

  atWar(id: FactionId): boolean {
    return this.relations[id] < RELATION_WAR_THRESHOLD;
  }

  /** Any faction currently raiding? (HUD warning) */
  anyWar(): boolean {
    return FACTION_IDS.some((f) => this.atWar(f));
  }

  tick(): void {
    this.tickCount++;
    // Relations slowly decay toward the resting point — friendship needs care.
    if (this.tickCount % (60 * TICK_RATE) === 0) {
      for (const f of FACTION_IDS) {
        if (this.relations[f] > RELATION_REST) {
          this.setRelation(f, this.relations[f] - RELATION_DECAY_PER_MIN);
        }
      }
      // Saturated markets recover and factions occasionally post requests.
      for (const f of FACTION_IDS) {
        const sat = this.saturation[f];
        for (const r of Object.keys(sat) as ResourceId[]) {
          sat[r] = Math.max(0, (sat[r] ?? 0) - PRICE_RECOVERY_PER_MIN);
          if (sat[r] === 0) delete sat[r];
        }
        if (
          !this.atWar(f) &&
          !this.contracts.some((c) => c.factionId === f) &&
          Math.random() < CONTRACT_CHANCE_PER_MIN
        ) {
          this.postContract(f);
        }
      }
    }
    // Contracts expire with a relation penalty.
    for (let i = this.contracts.length - 1; i >= 0; i--) {
      const c = this.contracts[i];
      if (--c.ticksLeft > 0) continue;
      this.contracts.splice(i, 1);
      this.setRelation(c.factionId, this.relations[c.factionId] - CONTRACT_RELATION_PENALTY);
      events.emit('toast:show', {
        message: `📜 Auftrag von ${getFaction(c.factionId).name} verfallen — Beziehung leidet`,
      });
    }
    // Caravans travel and return with gold.
    for (let i = this.caravans.length - 1; i >= 0; i--) {
      const c = this.caravans[i];
      if (--c.ticksLeft > 0) continue;
      this.caravans.splice(i, 1);
      // Price is settled on arrival — and the sale saturates the market.
      const gold = Math.round(c.amount * this.effectivePrice(c.factionId, c.resource));
      this.saturation[c.factionId][c.resource] =
        (this.saturation[c.factionId][c.resource] ?? 0) + PRICE_SATURATION_PER_BATCH;
      this.ctx.store.add('gold', gold);
      this.setRelation(c.factionId, this.relations[c.factionId] + CARAVAN_RELATION_GAIN);
      this.ctx.onCaravanReturned(gold);
      events.emit('toast:show', {
        message: `🐪 Karawane zurück von ${getFaction(c.factionId).name}: +${gold} 🪙`,
      });
    }
    // Wars: factions below the threshold raid periodically, growing bolder.
    for (const f of FACTION_IDS) {
      if (!this.atWar(f)) {
        this.raidCounts[f] = 0;
        continue;
      }
      if (this.raidCooldowns[f] > 0) {
        this.raidCooldowns[f]--;
        continue;
      }
      this.raidCooldowns[f] = RAID_INTERVAL_SECONDS * TICK_RATE;
      const strength = RAID_BASE_STRENGTH + RAID_STRENGTH_GROWTH * this.raidCounts[f]++;
      const spawned = this.ctx.spawnRaid(strength);
      if (spawned > 0) {
        events.emit('toast:show', {
          message: `⚔️ ${getFaction(f).name} überfällt dich mit ${spawned} Kriegern!`,
        });
      }
    }
  }

  /** Gift action: gold for goodwill. Returns false when unaffordable. */
  sendGift(id: FactionId): boolean {
    if (this.ctx.store.get('gold') < GIFT_GOLD_COST) {
      events.emit('toast:show', { message: 'Nicht genug Gold' });
      return false;
    }
    this.ctx.store.pay({ gold: GIFT_GOLD_COST });
    this.setRelation(id, this.relations[id] + GIFT_RELATION_GAIN);
    events.emit('toast:show', { message: `🎁 ${getFaction(id).name}: Beziehung verbessert` });
    return true;
  }

  /** Send a caravan with one batch of the given good. */
  sendCaravan(id: FactionId, resource: ResourceId): boolean {
    if (this.atWar(id)) {
      events.emit('toast:show', { message: 'Im Krieg fahren keine Karawanen' });
      return false;
    }
    if (this.ctx.store.get(resource) < CARAVAN_BATCH) {
      events.emit('toast:show', { message: `Nicht genug Ware (${CARAVAN_BATCH} nötig)` });
      return false;
    }
    this.ctx.store.pay({ [resource]: CARAVAN_BATCH });
    this.caravans.push({
      factionId: id,
      resource,
      amount: CARAVAN_BATCH,
      ticksLeft: CARAVAN_TRAVEL_SECONDS * TICK_RATE,
    });
    events.emit('toast:show', { message: `🐪 Karawane zu ${getFaction(id).name} unterwegs …` });
    return true;
  }

  /** Buy peace while at war. */
  offerPeace(id: FactionId): boolean {
    if (!this.atWar(id)) return false;
    if (this.ctx.store.get('gold') < TRIBUTE_GOLD_COST) {
      events.emit('toast:show', { message: `Tribut kostet ${TRIBUTE_GOLD_COST} Gold` });
      return false;
    }
    this.ctx.store.pay({ gold: TRIBUTE_GOLD_COST });
    this.setRelation(id, TRIBUTE_RELATION);
    this.raidCounts[id] = 0;
    events.emit('toast:show', { message: `🕊️ Frieden mit ${getFaction(id).name}` });
    return true;
  }

  /** Post a delivery request for a good the faction craves. */
  private postContract(id: FactionId): void {
    const craved = (Object.keys(FACTIONS[id].buys) as ResourceId[]).filter(
      (r) => ((FACTIONS[id].buys as Partial<Record<ResourceId, number>>)[r] ?? 1) > 1,
    );
    if (craved.length === 0) return;
    const resource = craved[Math.floor(Math.random() * craved.length)];
    const amount =
      CONTRACT_AMOUNT_MIN +
      Math.floor(Math.random() * (CONTRACT_AMOUNT_MAX - CONTRACT_AMOUNT_MIN + 1));
    const reward = Math.round(amount * factionPrice(id, resource) * CONTRACT_REWARD_FACTOR);
    this.contracts.push({
      factionId: id,
      resource,
      amount,
      reward,
      ticksLeft: CONTRACT_DURATION_SECONDS * TICK_RATE,
    });
    events.emit('diplomacy:changed', undefined);
    events.emit('toast:show', {
      message: `📜 ${getFaction(id).name} sucht ${amount}× ${resource === 'bread' ? '🥖' : ''} Ware — gut bezahlt!`,
    });
  }

  /** Deliver an open contract straight from the warehouse stock. */
  fulfillContract(id: FactionId): boolean {
    const idx = this.contracts.findIndex((c) => c.factionId === id);
    if (idx === -1) return false;
    const c = this.contracts[idx];
    if (this.ctx.store.get(c.resource) < c.amount) {
      events.emit('toast:show', { message: `Nicht genug Ware (${c.amount} nötig)` });
      return false;
    }
    this.contracts.splice(idx, 1);
    this.ctx.store.pay({ [c.resource]: c.amount });
    this.ctx.store.add('gold', c.reward);
    this.setRelation(id, this.relations[id] + CONTRACT_RELATION_GAIN);
    this.ctx.onContractFulfilled();
    events.emit('toast:show', {
      message: `📜 Auftrag erfüllt: +${c.reward} 🪙 von ${getFaction(id).name}`,
    });
    return true;
  }

  /** Open contract of a faction, if any. */
  contractOf(id: FactionId): ContractState | null {
    return this.contracts.find((c) => c.factionId === id) ?? null;
  }

  private setRelation(id: FactionId, value: number): void {
    const before = this.relations[id];
    const wasAtWar = this.atWar(id);
    this.relations[id] = Math.max(0, Math.min(100, value));
    if (this.relations[id] !== before) {
      events.emit('diplomacy:changed', undefined);
      if (!wasAtWar && this.atWar(id)) {
        this.raidCooldowns[id] = 0; // first raid comes promptly
        events.emit('toast:show', {
          message: `⚔️ ${getFaction(id).name} erklärt dir den Krieg!`,
        });
      }
    }
  }

  /** Trade or other actions can shift relations directly. */
  adjustRelation(id: FactionId, delta: number): void {
    this.setRelation(id, this.relations[id] + delta);
  }

  toSave(): DiplomacySave {
    return {
      relations: { ...this.relations },
      caravans: this.caravans.map((c) => ({ ...c })),
      raidCooldowns: { ...this.raidCooldowns },
      raidCounts: { ...this.raidCounts },
      saturation: Object.fromEntries(
        FACTION_IDS.map((f) => [f, { ...this.saturation[f] }]),
      ) as Record<FactionId, Partial<Record<ResourceId, number>>>,
      contracts: this.contracts.map((c) => ({ ...c })),
    };
  }

  restore(save: DiplomacySave): void {
    for (const f of FACTION_IDS) {
      this.relations[f] = save.relations[f] ?? RELATION_START;
      this.raidCooldowns[f] = save.raidCooldowns?.[f] ?? 0;
      this.raidCounts[f] = save.raidCounts?.[f] ?? 0;
    }
    this.caravans = (save.caravans ?? []).map((c) => ({ ...c }));
    for (const f of FACTION_IDS) this.saturation[f] = { ...(save.saturation?.[f] ?? {}) };
    this.contracts = (save.contracts ?? []).map((c) => ({ ...c }));
    events.emit('diplomacy:changed', undefined);
  }
}
