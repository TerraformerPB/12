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
  /** Free grass tiles with at least one forest tile orthogonally adjacent. */
  AdjacentForest: 'adjacentForest',
  /** Free water tiles (bridges). */
  Water: 'water',
  /** Free grass tiles with at least one water tile orthogonally adjacent. */
  AdjacentWater: 'adjacentWater',
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
  /** Walkable by everyone; own units move faster. 1 = road/bridge, 2 = paved. */
  roadTier?: 1 | 2;
  /**
   * Id of the def this building can be upgraded into (info panel action).
   * Typed as string to avoid a circular type with BUILDING_DEFS; resolved
   * via getDef at runtime.
   */
  upgradesTo?: string;
  /** Workers that must be assigned before the building produces. */
  workersRequired?: number;
  /** Maximum upgrade level; BUILDING_MAX_LEVEL when omitted, 1 = fixed. */
  maxLevel?: number;
  /** Per-level upgrade cost; derived from `cost` when omitted. */
  upgradeCost?: Partial<Record<ResourceId, number>>;
  /** Soldiers can be recruited here (barracks). */
  recruitsSoldiers?: boolean;
  /** Hit points; BUILDING_DEFAULT_HP when omitted. */
  maxHp?: number;
  /** Rank index required in the empire scenario (0/omitted = always). */
  requiredRank?: number;
  /** Short German description for the info panel. */
  description: string;
  /** Placeholder art parameters; replaced by sprite atlas entries later. */
  art: { color: number; height: number; material?: 'wood' | 'stone' };
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
    upgradeCost: { wood: 40, stone: 20 },
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
    placement: PlacementRule.AdjacentForest,
    recipe: { output: 'wood', duration: 4 },
    workersRequired: 1,
    description: 'Produziert 1 Holz alle 4 Sekunden. Muss an Wald grenzen.',
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
    workersRequired: 1,
    description: 'Produziert 1 Stein alle 6 Sekunden. Muss an Fels grenzen.',
    art: { color: 0x8d939e, height: 22 },
  },
  mine: {
    id: 'mine',
    category: 'economy',
    name: 'Erzmine',
    footprint: { w: 2, h: 2 },
    cost: { wood: 30, stone: 10 },
    placement: PlacementRule.AdjacentRock,
    recipe: { output: 'ore', duration: 7 },
    workersRequired: 1,
    description: 'Fördert 1 Erz alle 7 Sekunden. Muss an Fels grenzen.',
    art: { color: 0x6b5d52, height: 24 },
  },
  smithy: {
    id: 'smithy',
    category: 'economy',
    name: 'Schmiede',
    footprint: { w: 2, h: 2 },
    cost: { wood: 50, stone: 30 },
    placement: PlacementRule.Grass,
    recipe: { input: 'ore', output: 'weapons', duration: 5 },
    workersRequired: 1,
    requiredRank: 2,
    description: 'Schmiedet 1 Erz zu 1 Waffe (5 Sekunden). Nötig für Soldaten.',
    art: { color: 0x55504e, height: 28 },
  },
  fishery: {
    id: 'fishery',
    category: 'economy',
    name: 'Fischerhütte',
    footprint: { w: 2, h: 1 },
    cost: { wood: 25 },
    placement: PlacementRule.AdjacentWater,
    recipe: { output: 'fish', duration: 6 },
    workersRequired: 1,
    description: 'Fängt 1 Fisch alle 6 Sekunden. Muss am Wasser stehen.',
    maxHp: 40,
    art: { color: 0x5e7f95, height: 18 },
  },
  farm: {
    id: 'farm',
    category: 'economy',
    name: 'Weizenfarm',
    footprint: { w: 3, h: 3 },
    cost: { wood: 25 },
    placement: PlacementRule.Grass,
    recipe: { output: 'wheat', duration: 5 },
    workersRequired: 2,
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
    workersRequired: 1,
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
    workersRequired: 1,
    description: 'Backt 1 Mehl zu 1 Brot (3 Sekunden).',
    art: { color: 0xb5663c, height: 30 },
  },
  brewery: {
    id: 'brewery',
    category: 'economy',
    name: 'Brauerei',
    footprint: { w: 2, h: 2 },
    cost: { wood: 45, stone: 15 },
    placement: PlacementRule.Grass,
    requiredRank: 1,
    recipe: { input: 'wheat', output: 'beer', duration: 6 },
    workersRequired: 1,
    description: 'Braut 1 Weizen zu 1 Bier (6 Sekunden). Für Forschung.',
    art: { color: 0x8c6f3f, height: 32 },
  },
  market: {
    id: 'market',
    category: 'economy',
    name: 'Marktplatz',
    footprint: { w: 2, h: 2 },
    cost: { wood: 30, stone: 20 },
    placement: PlacementRule.Grass,
    requiredRank: 1,
    description: 'Handelt Waren gegen Gold; hier wird auch die Steuer erhoben.',
    maxHp: 60,
    art: { color: 0xb3893c, height: 16 },
  },
  sheepFarm: {
    id: 'sheepFarm',
    category: 'economy',
    name: 'Schäferei',
    footprint: { w: 2, h: 2 },
    cost: { wood: 35, stone: 5 },
    placement: PlacementRule.Grass,
    recipe: { output: 'wool', duration: 7 },
    workersRequired: 1,
    requiredRank: 1,
    description: 'Schafe liefern alle 7 Sekunden 1 Wolle.',
    art: { color: 0xd8d2c2, height: 18 },
  },
  weavery: {
    id: 'weavery',
    category: 'economy',
    name: 'Weberei',
    footprint: { w: 2, h: 2 },
    cost: { wood: 45, stone: 20 },
    placement: PlacementRule.Grass,
    recipe: { input: 'wool', output: 'cloth', duration: 6 },
    workersRequired: 2,
    requiredRank: 2,
    description: 'Webt 1 Wolle zu 1 Tuch (6 Sekunden). Luxusgut.',
    art: { color: 0x9a5a74, height: 28 },
  },
  stable: {
    id: 'stable',
    category: 'economy',
    name: 'Stall',
    footprint: { w: 2, h: 2 },
    cost: { wood: 40, stone: 10 },
    requiredRank: 2,
    placement: PlacementRule.Grass,
    description: 'Stellt einen Ochsenkarren: transportiert 3 Waren pro Fahrt.',
    maxHp: 60,
    art: { color: 0x96793f, height: 26 },
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
    maxLevel: 1,
    name: 'Straße',
    footprint: { w: 1, h: 1 },
    cost: { wood: 2 },
    placement: PlacementRule.Grass,
    roadTier: 1,
    upgradesTo: 'roadStone',
    description: 'Träger und Soldaten laufen auf Straßen 40% schneller.',
    maxHp: 40,
    art: { color: 0x77705f, height: 0 },
  },
  roadStone: {
    id: 'roadStone',
    category: 'economy',
    maxLevel: 1,
    name: 'Pflasterstraße',
    footprint: { w: 1, h: 1 },
    cost: { stone: 3 },
    placement: PlacementRule.Grass,
    roadTier: 2,
    description: 'Ausgebaute Route: 80% schneller. Straßen sind aufrüstbar.',
    maxHp: 60,
    art: { color: 0x9a958a, height: 0 },
  },
  bridge: {
    id: 'bridge',
    category: 'economy',
    maxLevel: 1,
    name: 'Brücke',
    footprint: { w: 1, h: 1 },
    cost: { wood: 10 },
    placement: PlacementRule.Water,
    roadTier: 1,
    description: 'Überquert den Fluss. Achtung: auch Angreifer nutzen sie.',
    maxHp: 60,
    art: { color: 0x8a6b42, height: 0 },
  },
  wall: {
    id: 'wall',
    category: 'defense',
    name: 'Mauer',
    footprint: { w: 1, h: 1 },
    cost: { stone: 2 },
    placement: PlacementRule.Grass,
    maxLevel: 1,
    upgradesTo: 'wallStrong',
    description: 'Blockiert den Weg. Baue Linien, um die Burg zu schützen.',
    maxHp: 80,
    art: { color: 0x8a8f99, height: 34, material: 'stone' },
  },
  wallStrong: {
    requiredRank: 3,
    id: 'wallStrong',
    category: 'defense',
    name: 'Verstärkte Mauer',
    footprint: { w: 1, h: 1 },
    cost: { stone: 6 },
    placement: PlacementRule.Grass,
    description: 'Doppelt so zäh wie eine einfache Mauer.',
    maxHp: 170,
    art: { color: 0x6e7480, height: 40, material: 'stone' },
  },
  gate: {
    id: 'gate',
    category: 'defense',
    name: 'Tor',
    footprint: { w: 1, h: 1 },
    cost: { stone: 5 },
    placement: PlacementRule.Grass,
    passable: true,
    maxLevel: 1,
    upgradesTo: 'gateIron',
    description: 'Durchgang in der Mauer — eigene Einheiten können passieren.',
    maxHp: 60,
    art: { color: 0xa08252, height: 30, material: 'stone' },
  },
  gateIron: {
    requiredRank: 3,
    id: 'gateIron',
    category: 'defense',
    name: 'Eisentor',
    footprint: { w: 1, h: 1 },
    cost: { stone: 8, weapons: 1 },
    placement: PlacementRule.Grass,
    passable: true,
    description: 'Beschlagenes Tor — hält Belagerungen deutlich länger stand.',
    maxHp: 140,
    art: { color: 0x76695a, height: 32, material: 'stone' },
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
    art: { color: 0x6f7682, height: 58, material: 'stone' },
  },
  barracks: {
    id: 'barracks',
    category: 'defense',
    name: 'Kaserne',
    footprint: { w: 3, h: 3 },
    cost: { wood: 50, stone: 20 },
    placement: PlacementRule.Grass,
    recruitsSoldiers: true,
    description: 'Rekrutiert Soldaten gegen Brot und Waffen. Soldaten belegen Bevölkerung.',
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
    ids: [
      'lumberjack',
      'quarry',
      'mine',
      'fishery',
      'farm',
      'mill',
      'bakery',
      'brewery',
      'sheepFarm',
      'weavery',
      'smithy',
      'market',
      'stable',
      'hut',
      'road',
      'roadStone',
      'bridge',
    ],
  },
  {
    title: 'Verteidigung',
    ids: ['wall', 'wallStrong', 'gate', 'gateIron', 'tower', 'barracks'],
  },
];
