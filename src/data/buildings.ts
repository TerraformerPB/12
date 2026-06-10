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

/** Build menu grouping. */
export type BuildingCategory = 'economy' | 'defense';

export interface BuildingDef {
  id: BuildingDefId;
  name: string;
  category: BuildingCategory;
  /** Footprint in tiles before rotation. */
  footprint: { w: number; h: number };
  cost: Partial<Record<ResourceId, number>>;
  placement: PlacementRule;
  recipe?: Recipe;
  /** Added carrier capacity (huts). */
  population?: number;
  /** Central storage / carrier hub. Not buildable, exactly one per game. */
  isWarehouse?: boolean;
  /** Own units may walk through this building's tiles (gates). */
  passable?: boolean;
  /** Walkable by everyone; own units move faster (roads). */
  isRoad?: boolean;
  /** Soldiers can be recruited here (barracks). */
  recruitsSoldiers?: boolean;
  /** Hit points; BUILDING_DEFAULT_HP when omitted. */
  maxHp?: number;
  /** Short German description for the info panel. */
  description: string;
  /** Placeholder art parameters; replaced by sprite atlas entries later. */
  art: { color: number; height: number };
}

export const BUILDING_DEFS = {
  warehouse: {
    id: 'warehouse',
    category: 'economy',
    name: 'Lagerhaus',
    footprint: { w: 2, h: 2 },
    cost: {},
    placement: PlacementRule.Grass,
    isWarehouse: true,
    description: 'Zentrales Lager. Träger liefern hier alle Waren ab.',
    maxHp: 150,
    art: { color: 0xb08a4f, height: 40 },
  },
  lumberjack: {
    id: 'lumberjack',
    category: 'economy',
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
    category: 'economy',
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
    category: 'economy',
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
    category: 'economy',
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
    category: 'economy',
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
    category: 'economy',
    name: 'Hütte',
    footprint: { w: 1, h: 1 },
    cost: { wood: 15 },
    placement: PlacementRule.Grass,
    population: 2,
    description: 'Bietet Platz für 2 weitere Träger.',
    maxHp: 30,
    art: { color: 0x9c7b5a, height: 20 },
  },
  road: {
    id: 'road',
    category: 'economy',
    name: 'Straße',
    footprint: { w: 1, h: 1 },
    cost: { wood: 2 },
    placement: PlacementRule.Grass,
    isRoad: true,
    description: 'Träger und Soldaten laufen auf Straßen 40% schneller.',
    maxHp: 40,
    art: { color: 0x77705f, height: 0 },
  },
  wall: {
    id: 'wall',
    category: 'defense',
    name: 'Mauer',
    footprint: { w: 1, h: 1 },
    cost: { stone: 2 },
    placement: PlacementRule.Grass,
    description: 'Blockiert den Weg. Baue Linien, um die Burg zu schützen.',
    maxHp: 80,
    art: { color: 0x8a8f99, height: 34 },
  },
  gate: {
    id: 'gate',
    category: 'defense',
    name: 'Tor',
    footprint: { w: 1, h: 1 },
    cost: { stone: 5 },
    placement: PlacementRule.Grass,
    passable: true,
    description: 'Durchgang in der Mauer — eigene Einheiten können passieren.',
    maxHp: 60,
    art: { color: 0xa08252, height: 30 },
  },
  tower: {
    id: 'tower',
    category: 'defense',
    name: 'Wachturm',
    footprint: { w: 2, h: 2 },
    cost: { wood: 10, stone: 30 },
    placement: PlacementRule.Grass,
    description: 'Beschießt Angreifer in Reichweite automatisch.',
    maxHp: 100,
    art: { color: 0x6f7682, height: 58 },
  },
  barracks: {
    id: 'barracks',
    category: 'defense',
    name: 'Kaserne',
    footprint: { w: 3, h: 3 },
    cost: { wood: 50, stone: 20 },
    placement: PlacementRule.Grass,
    recruitsSoldiers: true,
    description: 'Rekrutiert Soldaten gegen Brot. Soldaten belegen Bevölkerung.',
    art: { color: 0x7d5a66, height: 32 },
  },
} as const satisfies Record<string, Omit<BuildingDef, 'id'> & { id: string }>;

export type BuildingDefId = keyof typeof BUILDING_DEFS;

export function getDef(id: BuildingDefId): BuildingDef {
  return BUILDING_DEFS[id] as BuildingDef;
}

/** Build menu sections, in display order. */
export const BUILD_MENU_SECTIONS: { title: string; ids: BuildingDefId[] }[] = [
  {
    title: 'Wirtschaft',
    ids: ['lumberjack', 'quarry', 'farm', 'mill', 'bakery', 'hut', 'road'],
  },
  {
    title: 'Verteidigung',
    ids: ['wall', 'gate', 'tower', 'barracks'],
  },
];
