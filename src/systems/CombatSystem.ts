import {
  ENEMY_BREACH_COST,
  ENEMY_REPATH_INTERVAL,
  MELEE_RANGE,
  SOLDIER_AGGRO_RANGE,
  SOLDIER_ATTACK_INTERVAL,
  TICK_RATE,
  TOWER_ATTACK_INTERVAL,
  TOWER_DAMAGE,
  TOWER_RANGE,
  UPGRADE_TOWER_DAMAGE_BONUS,
  UPGRADE_TOWER_RANGE_BONUS,
} from '../data/config';
import type { Building } from '../entities/Building';
import type { Enemy } from '../entities/Enemy';
import type { Soldier } from '../entities/Soldier';
import { NO_OCCUPANT, type IsoGrid } from '../world/IsoGrid';
import { findPath } from '../world/Pathfinding';
import type { SoundId } from '../core/SoundManager';

const SOLDIER_ATTACK_TICKS = Math.round(SOLDIER_ATTACK_INTERVAL * TICK_RATE);
const TOWER_ATTACK_TICKS = Math.round(TOWER_ATTACK_INTERVAL * TICK_RATE);
const ENEMY_REPATH_TICKS = Math.round(ENEMY_REPATH_INTERVAL * TICK_RATE);
const CHASE_REPATH_TICKS = TICK_RATE / 2;
/** Projectile flight time in ticks (visual only; damage is instant). */
const PROJECTILE_TTL = 6;

/** Transient tower-arrow visual, in grid coordinates. Not saved. */
export interface Projectile {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  age: number;
  /** Render tint; tower arrows when omitted. */
  color?: number;
}

export interface CombatContext {
  grid: IsoGrid;
  buildings: Map<number, Building>;
  soldiers: Soldier[];
  enemies: Enemy[];
  getWarehouse(): Building | null;
  /** Remove a destroyed building (no refund); handles warehouse = game over. */
  destroyBuilding(id: number): void;
  onEnemyKilled(): void;
  onSoldierKilled(soldier: Soldier): void;
  playSound(id: SoundId): void;
  /** Research multipliers. */
  towerDamageFactor(): number;
  soldierDamageFactor(): number;
  towerRangeBonus(): number;
  /** Duel: the opposing castle's warehouse (march target), else null. */
  getFoeWarehouse(): Building | null;
}

/**
 * Phase 3 combat: enemy routing/attacks, tower fire and soldier melee.
 *
 * Enemy routing uses `IsoGrid.enemyMoveCost`: building tiles are walkable
 * at a high virtual cost, so the cheapest route doubles as the breach
 * plan — when the next waypoint is a building tile, the enemy attacks
 * that building until it falls, then marches on.
 */
export class CombatSystem {
  private ctx: CombatContext;
  private tickCount = 0;
  /** Tower shot cooldowns by building id. */
  private towerCooldowns = new Map<number, number>();
  readonly projectiles: Projectile[] = [];

  constructor(ctx: CombatContext) {
    this.ctx = ctx;
  }

  tick(): void {
    this.tickCount++;
    this.tickEnemies();
    this.tickSoldierCombat();
    this.tickTowers();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (++this.projectiles[i].age > PROJECTILE_TTL) this.projectiles.splice(i, 1);
    }
  }

  // --- Enemies -----------------------------------------------------------------

  private tickEnemies(): void {
    const { enemies, buildings } = this.ctx;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      if (enemy.attackCooldown > 0) enemy.attackCooldown--;

      // Fight back: strike a soldier within reach (ranged enemies shoot).
      // Siege vehicles ignore soldiers entirely and head for buildings.
      const reach = enemy.def.range ?? MELEE_RANGE;
      const soldier = enemy.def.ignoresSoldiers
        ? null
        : this.nearestSoldier(enemy.x, enemy.y, reach);
      if (soldier) {
        enemy.rest();
        if (enemy.attackCooldown <= 0) {
          enemy.attackCooldown = Math.round(enemy.def.attackInterval * TICK_RATE);
          if (enemy.def.range) {
            this.projectiles.push({
              x0: enemy.x, y0: enemy.y, x1: soldier.x, y1: soldier.y, age: 0, color: 0x9a4a3a,
            });
            this.ctx.playSound('arrow');
          }
          this.damageSoldier(soldier, enemy.def.damage);
        }
        continue;
      }

      // Breach: attack the building blocking the next waypoint.
      if (enemy.attackTargetId !== null) {
        const target = buildings.get(enemy.attackTargetId);
        if (!target) {
          enemy.attackTargetId = null; // breached — continue the march
        } else {
          enemy.rest();
          if (enemy.attackCooldown <= 0) {
            enemy.attackCooldown = Math.round(enemy.def.attackInterval * TICK_RATE);
            if (enemy.def.range) {
              const tc = target.center;
              this.projectiles.push({
                x0: enemy.x, y0: enemy.y, x1: tc.x, y1: tc.y, age: 0, color: 0x9a4a3a,
              });
            }
            this.damageBuilding(target, enemy.def.damage);
          }
          continue;
        }
      }

      const next = enemy.nextWaypoint();
      if (!next) {
        this.repathEnemy(enemy);
        continue;
      }
      // Ranged siege engines stop as soon as a blocking building along
      // their path comes into range (they outrange towers).
      if (enemy.def.range) {
        const ahead = enemy.peekPath(Math.ceil(enemy.def.range) + 2);
        for (const wp of ahead) {
          const occ = this.ctx.grid.inBounds(wp.x, wp.y)
            ? this.ctx.grid.occupantAt(wp.x, wp.y)
            : NO_OCCUPANT;
          if (occ !== NO_OCCUPANT) {
            if (Math.hypot(wp.x - enemy.x, wp.y - enemy.y) <= enemy.def.range) {
              enemy.attackTargetId = occ;
            }
            break;
          }
        }
        if (enemy.attackTargetId !== null) continue;
      }
      const occupant = this.ctx.grid.inBounds(next.x, next.y)
        ? this.ctx.grid.occupantAt(next.x, next.y)
        : NO_OCCUPANT;
      if (occupant !== NO_OCCUPANT) {
        enemy.attackTargetId = occupant;
        continue;
      }
      enemy.step(enemy.def.speed / TICK_RATE);
    }
  }

  private repathEnemy(enemy: Enemy): void {
    if (this.tickCount - enemy.lastRepath < ENEMY_REPATH_TICKS) {
      enemy.rest();
      return;
    }
    enemy.lastRepath = this.tickCount;
    const warehouse = this.ctx.getWarehouse();
    if (!warehouse) return;
    const breachGrid = {
      width: this.ctx.grid.width,
      height: this.ctx.grid.height,
      moveCost: this.ctx.grid.enemyMoveCost(ENEMY_BREACH_COST),
    };
    const path = findPath(breachGrid, enemy.tile, warehouse.footprintTiles());
    if (path) enemy.setPath(path);
  }

  // --- Soldiers ------------------------------------------------------------------

  private tickSoldierCombat(): void {
    for (const s of this.ctx.soldiers) {
      if (s.attackCooldown > 0) s.attackCooldown--;
      if (s.mode === 'advance') {
        this.tickAdvance(s);
        continue;
      }
      if (s.mode !== 'guard') continue; // player orders override combat

      const target = this.acquireSoldierTarget(s);
      if (!target) {
        s.combatTargetId = null;
        // Duel: with no enemy units around, besiege the opposing castle.
        if (this.engageFoeBuilding(s, s.anchor)) continue;
        // Walk back to the guard post after a fight.
        if (!s.hasPath() && (s.tile.x !== s.anchor.x || s.tile.y !== s.anchor.y)) {
          const path = findPath(this.ctx.grid, s.tile, [s.anchor]);
          if (path) s.setPath(path);
        }
        continue;
      }

      s.combatTargetId = target.id;
      const dist = Math.hypot(target.x - s.x, target.y - s.y);
      if (dist <= this.soldierReach(s)) {
        s.clearPath();
        this.soldierStrikeEnemy(s, target);
      } else if (this.shouldChase(s, target)) {
        s.lastRepath = this.tickCount;
        const path = findPath(this.ctx.grid, s.tile, [target.tile]);
        if (path) s.setPath(path);
        else s.combatTargetId = null; // unreachable (behind a wall)
      }
    }
  }

  /** Duel: nearest foe building with a footprint tile in range of `origin`. */
  private nearestFoeBuilding(
    s: Soldier,
    origin: { x: number; y: number },
  ): { building: Building; dist: number } | null {
    let best: Building | null = null;
    let bestDist = Infinity;
    for (const b of this.ctx.buildings.values()) {
      if (b.owner !== 'foe') continue;
      for (const t of b.footprintTiles()) {
        if (Math.hypot(t.x - origin.x, t.y - origin.y) > SOLDIER_AGGRO_RANGE) continue;
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (d < bestDist) {
          bestDist = d;
          best = b;
        }
      }
    }
    return best ? { building: best, dist: bestDist } : null;
  }

  /** March to and strike the nearest foe building. True while engaged. */
  private engageFoeBuilding(s: Soldier, origin: { x: number; y: number }): boolean {
    const found = this.nearestFoeBuilding(s, origin);
    if (!found) return false;
    const { building, dist } = found;
    if (dist <= this.soldierReach(s) + 0.45) {
      s.clearPath();
      if (s.attackCooldown <= 0) {
        s.attackCooldown = SOLDIER_ATTACK_TICKS;
        if (s.def.range) {
          const c = building.center;
          this.projectiles.push({
            x0: s.x, y0: s.y, x1: c.x, y1: c.y, age: 0, color: 0x4f9dd8,
          });
          this.ctx.playSound('arrow');
        }
        this.damageBuilding(building, s.attackDamage * this.ctx.soldierDamageFactor());
      }
      return true;
    }
    // Out of reach: walk to an adjacent tile. Never reset a path that is
    // already heading there — re-pathing every interval makes the unit
    // oscillate around its tile center and it would never arrive.
    const access = building.accessTiles(this.ctx.grid);
    const target = s.pathTarget();
    const onCourse =
      target !== null && access.some((t) => t.x === target.x && t.y === target.y);
    if (!onCourse && this.tickCount - s.lastRepath >= CHASE_REPATH_TICKS) {
      s.lastRepath = this.tickCount;
      const path = findPath(this.ctx.grid, s.tile, access);
      if (path) s.setPath(path);
      else return false; // walled off — stand down until something opens
    }
    return true;
  }

  /**
   * Clash-style deployed unit: fights enemies and foe buildings around its
   * own position, otherwise keeps marching on the foe warehouse.
   */
  private tickAdvance(s: Soldier): void {
    // 1) Enemy units crossing the lane (siege units push on regardless).
    if (!s.def.siege) {
      let foe: Enemy | null = null;
      let foeDist = SOLDIER_AGGRO_RANGE;
      for (const e of this.ctx.enemies) {
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        if (d < foeDist) {
          foe = e;
          foeDist = d;
        }
      }
      if (foe) {
        if (foeDist <= this.soldierReach(s)) {
          s.clearPath();
          this.soldierStrikeEnemy(s, foe);
        } else if (this.shouldChase(s, foe)) {
          s.lastRepath = this.tickCount;
          const path = findPath(this.ctx.grid, s.tile, [foe.tile]);
          if (path) s.setPath(path);
        }
        return;
      }
    }
    // 2) Foe buildings around the current position (walls first).
    if (this.engageFoeBuilding(s, s)) return;
    // 3) March on the foe warehouse (or its nearest standing building).
    if (s.hasPath() || this.tickCount - s.lastRepath < CHASE_REPATH_TICKS) return;
    s.lastRepath = this.tickCount;
    const warehouse = this.ctx.getFoeWarehouse();
    if (!warehouse) return;
    const path = findPath(this.ctx.grid, s.tile, warehouse.accessTiles(this.ctx.grid));
    if (path) {
      s.setPath(path);
      return;
    }
    // Warehouse walled in: head for the closest foe building instead.
    let nearest: Building | null = null;
    let nearestDist = Infinity;
    for (const b of this.ctx.buildings.values()) {
      if (b.owner !== 'foe') continue;
      const c = b.center;
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = b;
      }
    }
    if (nearest) {
      const p = findPath(this.ctx.grid, s.tile, nearest.accessTiles(this.ctx.grid));
      if (p) s.setPath(p);
    }
  }

  /** Strike reach of a soldier (ranged types shoot from a distance). */
  private soldierReach(s: Soldier): number {
    return s.def.range ?? MELEE_RANGE;
  }

  /**
   * Recompute the chase path only when the current one no longer ends near
   * the target — constant re-pathing makes units oscillate in place.
   */
  private shouldChase(s: Soldier, target: Enemy): boolean {
    if (this.tickCount - s.lastRepath < CHASE_REPATH_TICKS) return false;
    const end = s.pathTarget();
    if (!end) return true;
    return Math.hypot(end.x - target.x, end.y - target.y) > 1.5;
  }

  /** One strike at an enemy, with an arrow visual for ranged types. */
  private soldierStrikeEnemy(s: Soldier, target: Enemy): void {
    if (s.attackCooldown > 0) return;
    s.attackCooldown = SOLDIER_ATTACK_TICKS;
    if (s.def.range) {
      this.projectiles.push({
        x0: s.x, y0: s.y, x1: target.x, y1: target.y, age: 0, color: 0x4f9dd8,
      });
      this.ctx.playSound('arrow');
    }
    this.damageEnemy(target, s.attackDamage * this.ctx.soldierDamageFactor(), s);
  }

  /** Nearest living enemy within aggro range of the soldier's anchor. */
  private acquireSoldierTarget(s: Soldier): Enemy | null {
    if (s.def.siege) return null; // rams only care about buildings
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of this.ctx.enemies) {
      const anchorDist = Math.hypot(e.x - s.anchor.x, e.y - s.anchor.y);
      if (anchorDist > SOLDIER_AGGRO_RANGE) continue;
      const d = Math.hypot(e.x - s.x, e.y - s.y);
      if (d < bestDist) {
        best = e;
        bestDist = d;
      }
    }
    return best;
  }

  private nearestSoldier(gx: number, gy: number, radius: number): Soldier | null {
    let best: Soldier | null = null;
    let bestDist = radius;
    for (const s of this.ctx.soldiers) {
      const d = Math.hypot(s.x - gx, s.y - gy);
      if (d <= bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }

  // --- Towers --------------------------------------------------------------------

  private tickTowers(): void {
    for (const b of this.ctx.buildings.values()) {
      if (b.def.shoots !== true || b.underConstruction) continue;
      const cooldown = this.towerCooldowns.get(b.id) ?? 0;
      if (cooldown > 0) {
        this.towerCooldowns.set(b.id, cooldown - 1);
        continue;
      }
      const center = b.center;
      // Duel: the opposing castle's towers shoot the player's soldiers.
      if (b.owner === 'foe') {
        const soldier = this.nearestSoldier(center.x, center.y, TOWER_RANGE);
        if (!soldier) continue;
        this.towerCooldowns.set(b.id, TOWER_ATTACK_TICKS);
        this.projectiles.push({
          x0: center.x, y0: center.y, x1: soldier.x, y1: soldier.y, age: 0, color: 0x9a4a3a,
        });
        this.ctx.playSound('arrow');
        this.damageSoldier(soldier, TOWER_DAMAGE);
        continue;
      }
      let target: Enemy | null = null;
      let bestDist =
        TOWER_RANGE + UPGRADE_TOWER_RANGE_BONUS * (b.level - 1) + this.ctx.towerRangeBonus();
      for (const e of this.ctx.enemies) {
        const d = Math.hypot(e.x - center.x, e.y - center.y);
        if (d <= bestDist) {
          target = e;
          bestDist = d;
        }
      }
      if (!target) continue;
      this.towerCooldowns.set(b.id, TOWER_ATTACK_TICKS);
      this.projectiles.push({ x0: center.x, y0: center.y, x1: target.x, y1: target.y, age: 0 });
      this.ctx.playSound('arrow');
      const levelBonus = 1 + UPGRADE_TOWER_DAMAGE_BONUS * (b.level - 1);
      this.damageEnemy(target, TOWER_DAMAGE * levelBonus * this.ctx.towerDamageFactor());
    }
  }

  // --- Damage & deaths ----------------------------------------------------------

  private damageEnemy(enemy: Enemy, amount: number, killer?: Soldier): void {
    enemy.hp -= amount;
    if (enemy.hp <= 0) {
      const idx = this.ctx.enemies.indexOf(enemy);
      if (idx !== -1) this.ctx.enemies.splice(idx, 1);
      if (killer) {
        const before = killer.rank;
        killer.kills++;
        if (killer.rank > before) this.ctx.playSound('horn'); // promotion!
      }
      this.ctx.onEnemyKilled();
      this.ctx.playSound('death');
    } else {
      this.ctx.playSound('hit');
    }
  }

  private damageSoldier(soldier: Soldier, amount: number): void {
    soldier.hp -= amount;
    this.ctx.playSound('hit');
    if (soldier.hp <= 0) {
      this.ctx.onSoldierKilled(soldier);
    }
  }

  private damageBuilding(building: Building, amount: number): void {
    building.hp -= amount;
    this.ctx.playSound('hit');
    if (building.hp <= 0) {
      this.towerCooldowns.delete(building.id);
      this.ctx.destroyBuilding(building.id);
    }
  }
}
