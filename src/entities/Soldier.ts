import { VETERAN_BONUS, VETERAN_THRESHOLDS } from '../data/config';
import { getSoldierType, type SoldierTypeDef, type SoldierTypeId } from '../data/soldiers';
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
  /** Since save version 8. */
  typeId: SoldierTypeId;
  /** Since save version 9 (veteran ranks). */
  kills: number;
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
   * advance: duel deployment — marches at the foe castle on its own,
   *          fighting whatever crosses its path (Clash-style).
   */
  mode: 'command' | 'guard' | 'advance' = 'guard';
  readonly typeId: SoldierTypeId;
  hp: number;
  /** Lifetime kills; thresholds promote the soldier (veteran ranks). */
  kills = 0;
  /** Guard post: combat chases start and end here. */
  anchor: Point;
  /** Enemy currently engaged, null while guarding. */
  combatTargetId: number | null = null;
  /** Ticks until the next strike. */
  attackCooldown = 0;
  /** Tick of the last chase path computation. */
  lastRepath = -1_000_000;

  constructor(id: number, x: number, y: number, typeId: SoldierTypeId = 'soldier') {
    super(id, x, y);
    this.typeId = typeId;
    this.hp = this.def.hp;
    this.anchor = { x: Math.round(x), y: Math.round(y) };
  }

  get def(): SoldierTypeDef {
    return getSoldierType(this.typeId);
  }

  /** Veteran rank 0–3 from kills. */
  get rank(): number {
    let rank = 0;
    for (const t of VETERAN_THRESHOLDS) if (this.kills >= t) rank++;
    return rank;
  }

  /** Max hp including the veteran bonus. */
  get maxHp(): number {
    return Math.round(this.def.hp * (1 + VETERAN_BONUS * this.rank));
  }

  /** Damage including the veteran bonus. */
  get attackDamage(): number {
    return this.def.damage * (1 + VETERAN_BONUS * this.rank);
  }

  toSave(): SoldierSave {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      target: this.mode === 'command' ? this.pathTarget() : null,
      hp: this.hp,
      anchor: { ...this.anchor },
      typeId: this.typeId,
      kills: this.kills,
    };
  }

  static fromSave(s: SoldierSave): { soldier: Soldier; target: Point | null } {
    const soldier = new Soldier(s.id, s.x, s.y, s.typeId);
    soldier.kills = s.kills;
    soldier.hp = Math.min(s.hp, soldier.maxHp);
    soldier.anchor = { ...s.anchor };
    return { soldier, target: s.target };
  }
}
