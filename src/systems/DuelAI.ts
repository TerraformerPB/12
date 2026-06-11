import {
  DUEL_AI_FIRST_ATTACK,
  DUEL_AI_LEVELS,
  DUEL_AI_RAM_CAP,
  DUEL_UNIT_COSTS,
  type DuelAiLevelId,
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
 * converts it into attack squads on a timer (pace and squad size depend
 * on the chosen difficulty). Its castle defends itself passively (foe
 * towers in CombatSystem). An online opponent would replace this class
 * behind the same context.
 */
export class DuelAI {
  private ctx: DuelAIContext;
  private budget: Record<ResourceId, number>;
  private level: (typeof DUEL_AI_LEVELS)[DuelAiLevelId];
  private ticks = 0;
  private nextAttackTick = DUEL_AI_FIRST_ATTACK * TICK_RATE;

  constructor(
    ctx: DuelAIContext,
    budget: Partial<Record<ResourceId, number>>,
    level: DuelAiLevelId = 'normal',
  ) {
    this.ctx = ctx;
    this.level = DUEL_AI_LEVELS[level];
    this.budget = Object.fromEntries(
      RESOURCE_IDS.map((r) => [r, budget[r] ?? 0]),
    ) as Record<ResourceId, number>;
  }

  /** True once the budget can no longer buy a single unit. */
  get exhausted(): boolean {
    return this.affordableUnit(0) === null;
  }

  /** Income from captured battlefield depots. */
  credit(resource: ResourceId, n: number): void {
    this.budget[resource] += n;
  }

  tick(): void {
    this.ticks++;
    if (this.ticks < this.nextAttackTick) return;
    this.nextAttackTick = this.ticks + this.level.attackInterval * TICK_RATE;
    this.sendSquad();
  }

  /** Spend budget on the next squad and put it on the map. Returns its size. */
  sendSquad(): number {
    const squad: EnemyDefId[] = [];
    let rams = 0;
    while (squad.length < this.level.squadSize) {
      const unit = this.affordableUnit(rams);
      if (!unit) break;
      this.pay(DUEL_UNIT_COSTS[unit]!);
      if (unit === 'ram') rams++;
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

  /** Strongest affordable unit (brute > ram > skirmisher > raider). */
  private affordableUnit(ramsInSquad: number): EnemyDefId | null {
    for (const unit of ['brute', 'ram', 'skirmisher', 'raider'] as const) {
      if (unit === 'ram' && ramsInSquad >= DUEL_AI_RAM_CAP) continue;
      const cost = DUEL_UNIT_COSTS[unit];
      if (cost && RESOURCE_IDS.every((r) => this.budget[r] >= (cost[r] ?? 0))) return unit;
    }
    return null;
  }

  private pay(cost: Partial<Record<ResourceId, number>>): void {
    for (const r of RESOURCE_IDS) this.budget[r] -= cost[r] ?? 0;
  }
}
