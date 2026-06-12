import { events } from '../core/EventBus';
import {
  CARAVAN_BATCH,
  CARAVAN_RELATION_GAIN,
  CARAVAN_TRAVEL_SECONDS,
  GIFT_GOLD_COST,
  GIFT_RELATION_GAIN,
  RAID_BASE_STRENGTH,
  RAID_INTERVAL_SECONDS,
  RAID_STRENGTH_GROWTH,
  RELATION_DECAY_PER_MIN,
  RELATION_REST,
  RELATION_START,
  RELATION_WAR_THRESHOLD,
  TICK_RATE,
  TRIBUTE_GOLD_COST,
  TRIBUTE_RELATION,
  type ResourceId,
} from '../data/config';
import { FACTION_IDS, factionPrice, getFaction, type FactionId } from '../data/factions';
import type { ResourceStore } from './EconomySystem';

export interface CaravanState {
  factionId: FactionId;
  resource: ResourceId;
  amount: number;
  /** Diplomacy ticks remaining until the caravan returns. */
  ticksLeft: number;
}

export interface DiplomacySave {
  relations: Record<FactionId, number>;
  caravans: CaravanState[];
  raidCooldowns: Record<FactionId, number>;
  raidCounts: Record<FactionId, number>;
}

export interface DiplomacyContext {
  store: ResourceStore;
  /** Spawn a faction raid of the given strength; returns units spawned. */
  spawnRaid(strength: number): number;
  /** Caravans grant prestige on return. */
  onCaravanReturned(gold: number): void;
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
    }
    // Caravans travel and return with gold.
    for (let i = this.caravans.length - 1; i >= 0; i--) {
      const c = this.caravans[i];
      if (--c.ticksLeft > 0) continue;
      this.caravans.splice(i, 1);
      const gold = Math.round(c.amount * factionPrice(c.factionId, c.resource));
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
    };
  }

  restore(save: DiplomacySave): void {
    for (const f of FACTION_IDS) {
      this.relations[f] = save.relations[f] ?? RELATION_START;
      this.raidCooldowns[f] = save.raidCooldowns?.[f] ?? 0;
      this.raidCounts[f] = save.raidCounts?.[f] ?? 0;
    }
    this.caravans = (save.caravans ?? []).map((c) => ({ ...c }));
    events.emit('diplomacy:changed', undefined);
  }
}
