import { events } from '../core/EventBus';
import { TICK_RATE } from '../data/config';
import type { Soldier } from '../entities/Soldier';
import type { IsoGrid, Point } from '../world/IsoGrid';
import { findPath } from '../world/Pathfinding';

/**
 * Soldier movement and player commands. Combat decisions (engaging,
 * chasing, striking) live in CombatSystem, which sets paths on guards.
 */
export class SoldierSystem {
  private grid: IsoGrid;
  private soldiers: Soldier[];
  /** Research speed multiplier (Marschverpflegung). */
  private speedFactor: () => number;

  constructor(grid: IsoGrid, soldiers: Soldier[], speedFactor: () => number = () => 1) {
    this.grid = grid;
    this.soldiers = soldiers;
    this.speedFactor = speedFactor;
  }

  tick(): void {
    for (const s of this.soldiers) {
      if (!s.hasPath()) {
        s.rest();
        continue;
      }
      const roadBonus = this.grid.speedFactorAt(s.tile.x, s.tile.y);
      const speed = (s.def.speed / TICK_RATE) * roadBonus * this.speedFactor();
      if (s.step(speed) && s.mode === 'command') {
        // Order completed: take up guard duty here.
        s.mode = 'guard';
        s.anchor = s.tile;
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
    soldier.mode = 'command';
    soldier.combatTargetId = null;
    soldier.anchor = { ...target };
    soldier.setPath(path);
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
