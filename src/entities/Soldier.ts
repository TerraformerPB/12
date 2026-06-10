import { SOLDIER_HP } from '../data/config';
import type { Point } from '../world/IsoGrid';
import { Unit } from './Unit';

export interface SoldierSave {
  id: number;
  x: number;
  y: number;
  /** Tile the soldier is marching to, null when standing guard. */
  target: Point | null;
  /** Since save version 3. */
  hp: number;
  anchor: Point;
}

/**
 * A soldier: stands guard at its anchor (the spot the player sent it to)
 * and engages enemies that come within aggro range of that anchor.
 * Tap the soldier, then tap a tile to move the guard post.
 */
export class Soldier extends Unit {
  /**
   * command: marching on a player order (no combat until arrival).
   * guard:   holding the anchor, auto-engaging nearby enemies.
   */
  mode: 'command' | 'guard' = 'guard';
  hp = SOLDIER_HP;
  /** Guard post: combat chases start and end here. */
  anchor: Point;
  /** Enemy currently engaged, null while guarding. */
  combatTargetId: number | null = null;
  /** Ticks until the next strike. */
  attackCooldown = 0;
  /** Tick of the last chase path computation. */
  lastRepath = -1_000_000;

  constructor(id: number, x: number, y: number) {
    super(id, x, y);
    this.anchor = { x: Math.round(x), y: Math.round(y) };
  }

  toSave(): SoldierSave {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      target: this.mode === 'command' ? this.pathTarget() : null,
      hp: this.hp,
      anchor: { ...this.anchor },
    };
  }

  static fromSave(s: SoldierSave): { soldier: Soldier; target: Point | null } {
    const soldier = new Soldier(s.id, s.x, s.y);
    soldier.hp = Math.min(s.hp, SOLDIER_HP);
    soldier.anchor = { ...s.anchor };
    return { soldier, target: s.target };
  }
}
