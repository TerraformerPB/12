import type { ResourceId } from './config';

/**
 * Data-driven building definitions.
 * Adding a new building = adding one entry to BUILDING_DEFS below.
 * Costs, footprint, production recipe and placement rule are all data;
 * no system code needs to change.
 */

/** Where a building may be placed. */
export const PlacementRule = {
  /** Any free grass tiles. */
  Grass: 'grass',
  /** Free grass tiles with at least one rock tile orthogonally adjacent. */
  AdjacentRock: 'adjacentRock',
} as const;
export type PlacementRule = (typeof PlacementRule)[keyof typeof PlacementRule];

export interface Recipe {
  /** Resource consumed per cycle (delivered from the warehouse). */
  input?: ResourceId;
  /** Resource produced per cycle (picked up by carriers). */
  output: ResourceId;
  /** Cycle duration in seconds. */
  duration: number;
}

export interface BuildingDef {
  id: BuildingDefId;
  name: string;
  /** Footprint in tiles before rotation. */
  footprint: { w: number; h: number };
  cost: Partial<Record<ResourceId, number>>;
  placement: PlacementRule;
  recipe?: Recipe;
  /** Added carrier capacity (huts). */
  population?: number;
  /** Central storage / carrier hub. Not buildable, exactly one per game. */
  isWarehouse?: boolean;
  /** Short German description for the info panel. */
  description: string;
  /** Placeholder art parameters; replaced by sprite atlas entries later. */
  art: { color: number; height: number };
}

export const BUILDING_DEFS = {
  warehouse: {
    id: 'warehouse',
    name: 'Lagerhaus',
    footprint: { w: 2, h: 2 },
    cost: {},
    placement: PlacementRule.Grass,
    isWarehouse: true,
    description: 'Zentrales Lager. Träger liefern hier alle Waren ab.',
    art: { color: 0xb08a4f, height: 40 },
  },
  lumberjack: {
    id: 'lumberjack',
    name: 'Holzfällerhütte',
    footprint: { w: 2, h: 2 },
    cost: { wood: 20 },
    placement: PlacementRule.Grass,
    recipe: { output: 'wood', duration: 4 },
    description: 'Produziert 1 Holz alle 4 Sekunden.',
    art: { color: 0x7a5230, height: 26 },
  },
  quarry: {
    id: 'quarry',
    name: 'Steinbruch',
    footprint: { w: 2, h: 2 },
    cost: { wood: 30 },
    placement: PlacementRule.AdjacentRock,
    recipe: { output: 'stone', duration: 6 },
    description: 'Produziert 1 Stein alle 6 Sekunden. Muss an Fels grenzen.',
    art: { color: 0x8d939e, height: 22 },
  },
  farm: {
    id: 'farm',
    name: 'Weizenfarm',
    footprint: { w: 3, h: 3 },
    cost: { wood: 25 },
    placement: PlacementRule.Grass,
    recipe: { output: 'wheat', duration: 5 },
    description: 'Produziert 1 Weizen alle 5 Sekunden.',
    art: { color: 0xc9a83c, height: 18 },
  },
  mill: {
    id: 'mill',
    name: 'Mühle',
    footprint: { w: 2, h: 2 },
    cost: { wood: 40, stone: 10 },
    placement: PlacementRule.Grass,
    recipe: { input: 'wheat', output: 'flour', duration: 3 },
    description: 'Mahlt 1 Weizen zu 1 Mehl (3 Sekunden).',
    art: { color: 0xd8cfb8, height: 44 },
  },
  bakery: {
    id: 'bakery',
    name: 'Bäckerei',
    footprint: { w: 2, h: 2 },
    cost: { wood: 40, stone: 20 },
    placement: PlacementRule.Grass,
    recipe: { input: 'flour', output: 'bread', duration: 3 },
    description: 'Backt 1 Mehl zu 1 Brot (3 Sekunden).',
    art: { color: 0xb5663c, height: 30 },
  },
  hut: {
    id: 'hut',
    name: 'Hütte',
    footprint: { w: 1, h: 1 },
    cost: { wood: 15 },
    placement: PlacementRule.Grass,
    population: 2,
    description: 'Bietet Platz für 2 weitere Träger.',
    art: { color: 0x9c7b5a, height: 20 },
  },
} as const satisfies Record<string, Omit<BuildingDef, 'id'> & { id: string }>;

export type BuildingDefId = keyof typeof BUILDING_DEFS;

export function getDef(id: BuildingDefId): BuildingDef {
  return BUILDING_DEFS[id] as BuildingDef;
}

/** Definitions shown in the build menu, in display order. */
export const BUILD_MENU_ORDER: BuildingDefId[] = [
  'lumberjack',
  'quarry',
  'farm',
  'mill',
  'bakery',
  'hut',
];
