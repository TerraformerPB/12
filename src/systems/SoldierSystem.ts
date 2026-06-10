import { events } from '../core/EventBus';
import { SOLDIER_SPEED, TICK_RATE } from '../data/config';
import type { Soldier } from '../entities/Soldier';
import type { IsoGrid, Point } from '../world/IsoGrid';
import { findPath } from '../world/Pathfinding';

const SPEED_PER_TICK = SOLDIER_SPEED / TICK_RATE;

/**
 * Soldier movement and player commands.
 * Phase 3 extension point: target acquisition, combat and tower garrisons
 * plug in here without touching the economy.
 */
export class SoldierSystem {
  private grid: IsoGrid;
  private soldiers: Soldier[];

  constructor(grid: IsoGrid, soldiers: Soldier[]) {
    this.grid = grid;
    this.soldiers = soldiers;
  }

  tick(): void {
    for (const s of this.soldiers) {
      if (s.state !== 'moving') {
        s.rest();
        continue;
      }
      if (s.step(SPEED_PER_TICK)) {
        s.state = 'idle';
      }
    }
  }

  /**
   * Order a soldier to march to a tile. Returns false (with a toast)
   * when no path exists.
   */
  command(soldier: Soldier, target: Point): boolean {
    if (!isFinite(this.grid.moveCost(target.x, target.y))) {
      events.emit('toast:show', { message: 'Dorthin kann er nicht' });
      return false;
    }
    const path = findPath(this.grid, soldier.tile, [target]);
    if (!path) {
      events.emit('toast:show', { message: 'Kein Weg dorthin' });
      return false;
    }
    soldier.setPath(path);
    soldier.state = 'moving';
    return true;
  }

  /** Re-issue saved movement orders after loading a savegame. */
  restoreAfterLoad(targets: Map<number, Point>): void {
    for (const s of this.soldiers) {
      const target = targets.get(s.id);
      if (target) this.command(s, target);
    }
  }

  /** The soldier closest to a fractional grid point within `radius` tiles. */
  soldierAt(gx: number, gy: number, radius: number): Soldier | null {
    let best: Soldier | null = null;
    let bestDist = radius;
    for (const s of this.soldiers) {
      const d = Math.hypot(s.x - gx, s.y - gy);
      if (d <= bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }
}
