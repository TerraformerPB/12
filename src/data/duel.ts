import type { ResourceId } from './config';
import type { EnemyDefId } from './enemies';

/**
 * Duel balancing: how a player's stockpile converts into an attack army.
 * Better economy management = stronger army — the core idea of the mode.
 */

/** One raider per N bread. */
export const DUEL_BREAD_PER_RAIDER = 3;
/** Extra raiders per own soldier (they join the raid). */
export const DUEL_RAIDERS_PER_SOLDIER = 2;
/** One brute per N weapons. */
export const DUEL_WEAPONS_PER_BRUTE = 5;
/** One skirmisher per N fish. */
export const DUEL_FISH_PER_SKIRMISHER = 6;
/** Maximum total army size. */
export const DUEL_ARMY_CAP = 40;
/** Units released per tap on the map border. */
export const DUEL_GROUP_SIZE = 5;
/** Spawn taps must be within this many tiles of the map edge. */
export const DUEL_SPAWN_EDGE = 4;
/** Breach cost used only to validate spawn tiles (any finite tile is ok). */
export const ENEMY_BREACH_COST_DUEL = 25;
/** A duel ends as a defeat after this many seconds (no stalemates). */
export const DUEL_TIME_LIMIT = 300;

/** Compute the attack army from current resources and soldiers. Pure. */
export function computeArmy(
  resources: Record<ResourceId, number>,
  soldierCount: number,
): EnemyDefId[] {
  const army: EnemyDefId[] = [];
  const raiders =
    Math.floor(resources.bread / DUEL_BREAD_PER_RAIDER) + soldierCount * DUEL_RAIDERS_PER_SOLDIER;
  const brutes = Math.floor(resources.weapons / DUEL_WEAPONS_PER_BRUTE);
  const skirmishers = Math.floor(resources.fish / DUEL_FISH_PER_SKIRMISHER);
  for (let i = 0; i < raiders; i++) army.push('raider');
  for (let i = 0; i < brutes; i++) army.push('brute');
  for (let i = 0; i < skirmishers; i++) army.push('skirmisher');
  return army.slice(0, DUEL_ARMY_CAP);
}

/** German summary like "12× Plünderer, 2× Brecher". */
export function armySummary(army: EnemyDefId[], names: Record<EnemyDefId, string>): string {
  const counts = new Map<EnemyDefId, number>();
  for (const id of army) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].map(([id, n]) => `${n}× ${names[id]}`).join(', ');
}
