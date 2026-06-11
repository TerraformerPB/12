import {
  DUEL_AI_ATTACK_INTERVAL,
  DUEL_AI_FIRST_ATTACK,
  DUEL_AI_SQUAD_SIZE,
  DUEL_UNIT_COSTS,
} from '../data/duel';
import { RESOURCE_IDS, TICK_RATE, type ResourceId } from '../data/config';
import type { EnemyDefId } from '../data/enemies';
import { Enemy } from '../entities/Enemy';
import type { Point } from '../world/IsoGrid';
import type { SoundId } from '../core/SoundManager';

export interface DuelAIContext {
  enemies: Enemy[];
  nextEntityId(): number;
  /** Marshalling tile in front of the AI castle. */
  spawnTile(): Point;
  playSound(id: SoundId): void;
  onSquadSent(size: number): void;
}

/**
 * The duel opponent: gets the same resource budget as the player and
 * converts it into attack squads on a timer. Its castle defends itself
 * passively (foe towers in CombatSystem). An online opponent would
 * replace this class behind the same context.
 */
export class DuelAI {
  private ctx: DuelAIContext;
  private budget: Record<ResourceId, number>;
  private ticks = 0;
  private nextAttackTick = DUEL_AI_FIRST_ATTACK * TICK_RATE;

  constructor(ctx: DuelAIContext, budget: Partial<Record<ResourceId, number>>) {
    this.ctx = ctx;
    this.budget = Object.fromEntries(
      RESOURCE_IDS.map((r) => [r, budget[r] ?? 0]),
    ) as Record<ResourceId, number>;
  }

  /** True once the budget can no longer buy a single unit. */
  get exhausted(): boolean {
    return this.affordableUnit() === null;
  }

  tick(): void {
    this.ticks++;
    if (this.ticks < this.nextAttackTick) return;
    this.nextAttackTick = this.ticks + DUEL_AI_ATTACK_INTERVAL * TICK_RATE;
    this.sendSquad();
  }

  /** Spend budget on the next squad and put it on the map. Returns its size. */
  sendSquad(): number {
    const squad: EnemyDefId[] = [];
    while (squad.length < DUEL_AI_SQUAD_SIZE) {
      const unit = this.affordableUnit();
      if (!unit) break;
      this.pay(DUEL_UNIT_COSTS[unit]!);
      squad.push(unit);
    }
    if (squad.length === 0) return 0;
    const spawn = this.ctx.spawnTile();
    for (const defId of squad) {
      this.ctx.enemies.push(
        new Enemy(
          this.ctx.nextEntityId(),
          spawn.x + (Math.random() - 0.5) * 0.8,
          spawn.y + (Math.random() - 0.5) * 0.8,
          defId,
        ),
      );
    }
    this.ctx.playSound('horn');
    this.ctx.onSquadSent(squad.length);
    return squad.length;
  }

  /** Strongest unit the budget still covers (brute > skirmisher > raider). */
  private affordableUnit(): EnemyDefId | null {
    for (const unit of ['brute', 'skirmisher', 'raider'] as const) {
      const cost = DUEL_UNIT_COSTS[unit];
      if (cost && RESOURCE_IDS.every((r) => this.budget[r] >= (cost[r] ?? 0))) return unit;
    }
    return null;
  }

  private pay(cost: Partial<Record<ResourceId, number>>): void {
    for (const r of RESOURCE_IDS) this.budget[r] -= cost[r] ?? 0;
  }
}
