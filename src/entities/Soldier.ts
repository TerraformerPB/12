import type { Point } from '../world/IsoGrid';
import { Unit } from './Unit';

export interface SoldierSave {
  id: number;
  x: number;
  y: number;
  /** Tile the soldier is marching to, null when standing guard. */
  target: Point | null;
}

/**
 * A soldier: stands guard where commanded. The player selects a soldier
 * by tapping it, then taps a tile to send it there.
 * Combat behaviour arrives in phase 3.
 */
export class Soldier extends Unit {
  state: 'idle' | 'moving' = 'idle';

  toSave(): SoldierSave {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      target: this.state === 'moving' ? this.pathTarget() : null,
    };
  }

  static fromSave(s: SoldierSave): { soldier: Soldier; target: Point | null } {
    return { soldier: new Soldier(s.id, s.x, s.y), target: s.target };
  }
}
