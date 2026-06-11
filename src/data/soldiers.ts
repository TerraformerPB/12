import type { ResourceId } from './config';

/**
 * Recruitable soldier types (phase 11). A new type = a new entry here
 * plus a sprite id in the manifest; recruit buttons appear automatically.
 */

export interface SoldierTypeDef {
  id: SoldierTypeId;
  name: string;
  hp: number;
  damage: number;
  /** Tiles per second. */
  speed: number;
  cost: Partial<Record<ResourceId, number>>;
}

export const SOLDIER_TYPES = {
  soldier: {
    id: 'soldier',
    name: 'Soldat',
    hp: 35,
    damage: 4,
    speed: 1.8,
    cost: { bread: 2, weapons: 1 },
  },
  knight: {
    id: 'knight',
    name: 'Ritter',
    hp: 70,
    damage: 8,
    speed: 1.6,
    cost: { bread: 3, weapons: 3, beer: 1 },
  },
} as const satisfies Record<string, Omit<SoldierTypeDef, 'id'> & { id: string }>;

export type SoldierTypeId = keyof typeof SOLDIER_TYPES;

export const SOLDIER_TYPE_IDS = Object.keys(SOLDIER_TYPES) as SoldierTypeId[];

export function getSoldierType(id: SoldierTypeId): SoldierTypeDef {
  return SOLDIER_TYPES[id] as SoldierTypeDef;
}
