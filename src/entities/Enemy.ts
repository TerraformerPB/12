import { ENEMY_HP } from '../data/config';
import { Unit } from './Unit';

export interface EnemySave {
  id: number;
  x: number;
  y: number;
  hp: number;
}

/**
 * A raider marching on the warehouse. Routing and combat decisions live in
 * CombatSystem; paths and the attack target are recomputed after loading,
 * so only position and hp are persisted.
 */
export class Enemy extends Unit {
  hp = ENEMY_HP;
  /** Building currently being attacked, null while marching. */
  attackTargetId: number | null = null;
  /** Ticks until the next strike. */
  attackCooldown = 0;
  /** Tick of the last route computation (rate-limits repathing). */
  lastRepath = -1_000_000;

  toSave(): EnemySave {
    return { id: this.id, x: this.x, y: this.y, hp: this.hp };
  }

  static fromSave(s: EnemySave): Enemy {
    const e = new Enemy(s.id, s.x, s.y);
    e.hp = Math.min(s.hp, ENEMY_HP);
    return e;
  }
}
