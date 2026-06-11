import { events } from '../core/EventBus';
import {
  TICK_RATE,
  WAVE_BASE_COUNT,
  WAVE_COUNT_GROWTH,
  WAVE_FIRST_DELAY,
  WAVE_INTERVAL,
  WAVE_MAX_COUNT,
} from '../data/config';
import { ENEMY_BREACH_COST } from '../data/config';
import { waveComposition } from '../data/enemies';
import { Enemy } from '../entities/Enemy';
import { IsoGrid, Terrain, type Point } from '../world/IsoGrid';

/** Enemies in wave `n` (1-based). Pure, unit-tested. */
export function waveSize(n: number): number {
  return Math.min(WAVE_MAX_COUNT, WAVE_BASE_COUNT + WAVE_COUNT_GROWTH * (n - 1));
}

export interface WaveSave {
  /** Last wave that was spawned (0 = none yet). */
  number: number;
  /** Seconds until the next wave arrives. */
  nextInSeconds: number;
  /** Enemies defeated so far (score). */
  kills: number;
}

export interface WaveContext {
  grid: IsoGrid;
  enemies: Enemy[];
  nextEntityId(): number;
  /** Spawn points must be able to reach the warehouse. */
  getWarehouse(): { footprintTiles(): Point[] } | null;
}

/**
 * Wave timing and spawning. Enemies enter at random walkable border tiles
 * in up to three groups. Combat behaviour lives in CombatSystem.
 */
export class WaveSystem {
  private ctx: WaveContext;
  waveNumber = 0;
  /** Ticks until the next wave spawns. */
  ticksToNext = WAVE_FIRST_DELAY * TICK_RATE;
  kills = 0;
  private lastStatusSecond = -1;

  constructor(ctx: WaveContext) {
    this.ctx = ctx;
  }

  tick(): void {
    this.ticksToNext--;
    if (this.ticksToNext <= 0) {
      this.waveNumber++;
      this.spawnWave(this.waveNumber);
      this.ticksToNext = WAVE_INTERVAL * TICK_RATE;
      events.emit('wave:started', { wave: this.waveNumber, count: waveSize(this.waveNumber) });
    }
    this.emitStatus();
  }

  onEnemyKilled(): void {
    this.kills++;
    this.emitStatus(true);
  }

  private spawnWave(n: number): void {
    const spawnPoints = this.pickSpawnPoints(Math.min(3, 1 + Math.floor(n / 3)));
    if (spawnPoints.length === 0) return; // map edge fully blocked — skip wave
    let i = 0;
    for (const part of waveComposition(n, waveSize(n))) {
      for (let k = 0; k < part.count; k++, i++) {
        const base = spawnPoints[i % spawnPoints.length];
        // Slight scatter so groups don't stack on one tile.
        this.ctx.enemies.push(
          new Enemy(
            this.ctx.nextEntityId(),
            base.x + (Math.random() - 0.5) * 0.8,
            base.y + (Math.random() - 0.5) * 0.8,
            part.defId,
          ),
        );
      }
    }
  }

  /**
   * Random border tiles from which the warehouse is reachable. Without
   * this check, raiders spawning across the river would idle forever and
   * waves would feel arbitrarily easy or unbeatable.
   */
  private pickSpawnPoints(groups: number): Point[] {
    const grid = this.ctx.grid;
    const warehouse = this.ctx.getWarehouse();
    const reachable = new Set<number>();
    if (warehouse) {
      // Flood fill with the enemy cost function (buildings are breachable,
      // water is not — bridges connect the banks).
      const cost = grid.enemyMoveCost(ENEMY_BREACH_COST);
      const queue: Point[] = [...warehouse.footprintTiles()];
      for (const t of queue) reachable.add(t.y * grid.width + t.x);
      while (queue.length > 0) {
        const cur = queue.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          const key = ny * grid.width + nx;
          if (reachable.has(key) || !isFinite(cost(nx, ny))) continue;
          reachable.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
    }
    const onBorderAndReachable = (x: number, y: number): boolean =>
      grid.terrainAt(x, y) === Terrain.Grass &&
      (reachable.size === 0 || reachable.has(y * grid.width + x));

    const border: Point[] = [];
    for (let x = 0; x < grid.width; x++) {
      if (onBorderAndReachable(x, 0)) border.push({ x, y: 0 });
      if (onBorderAndReachable(x, grid.height - 1)) border.push({ x, y: grid.height - 1 });
    }
    for (let y = 1; y < grid.height - 1; y++) {
      if (onBorderAndReachable(0, y)) border.push({ x: 0, y });
      if (onBorderAndReachable(grid.width - 1, y)) border.push({ x: grid.width - 1, y });
    }
    const points: Point[] = [];
    for (let i = 0; i < groups && border.length > 0; i++) {
      points.push(border[Math.floor(Math.random() * border.length)]);
    }
    return points;
  }

  /** Emit at most once per second unless forced. */
  private emitStatus(force = false): void {
    const seconds = Math.max(0, Math.ceil(this.ticksToNext / TICK_RATE));
    if (!force && seconds === this.lastStatusSecond) return;
    this.lastStatusSecond = seconds;
    events.emit('wave:status', {
      wave: this.waveNumber,
      nextInSeconds: seconds,
      enemiesAlive: this.ctx.enemies.length,
      kills: this.kills,
    });
  }

  toSave(): WaveSave {
    return {
      number: this.waveNumber,
      nextInSeconds: Math.max(1, Math.ceil(this.ticksToNext / TICK_RATE)),
      kills: this.kills,
    };
  }

  restore(save: WaveSave): void {
    this.waveNumber = save.number;
    this.ticksToNext = save.nextInSeconds * TICK_RATE;
    this.kills = save.kills;
    this.emitStatus(true);
  }
}
