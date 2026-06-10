import { getEnemyDef, type EnemyDef, type EnemyDefId } from '../data/enemies';
import { Unit } from './Unit';

export interface EnemySave {
  id: number;
  x: number;
  y: number;
  hp: number;
  /** Since save version 4. */
  defId: EnemyDefId;
}

/**
 * An attacker marching on the warehouse. Routing and combat decisions live
 * in CombatSystem; paths and the attack target are recomputed after
 * loading, so only position, type and hp are persisted.
 */
export class Enemy extends Unit {
  readonly defId: EnemyDefId;
  hp: number;
  /** Building currently being attacked, null while marching. */
  attackTargetId: number | null = null;
  /** Ticks until the next strike. */
  attackCooldown = 0;
  /** Tick of the last route computation (rate-limits repathing). */
  lastRepath = -1_000_000;

  constructor(id: number, x: number, y: number, defId: EnemyDefId = 'raider') {
    super(id, x, y);
    this.defId = defId;
    this.hp = this.def.hp;
  }

  get def(): EnemyDef {
    return getEnemyDef(this.defId);
  }

  toSave(): EnemySave {
    return { id: this.id, x: this.x, y: this.y, hp: this.hp, defId: this.defId };
  }

  static fromSave(s: EnemySave): Enemy {
    const e = new Enemy(s.id, s.x, s.y, s.defId);
    e.hp = Math.min(s.hp, e.def.hp);
    return e;
  }
}
