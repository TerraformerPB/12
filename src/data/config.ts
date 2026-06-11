/**
 * Central balancing and engine configuration.
 * Every tunable number in the game lives here or in `buildings.ts` —
 * never hardcode balancing values elsewhere.
 */

// --- Resources -------------------------------------------------------------

export const RESOURCE_IDS = ['wood', 'stone', 'ore', 'weapons', 'wheat', 'flour', 'bread', 'fish', 'beer', 'gold'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export interface ResourceInfo {
  label: string;
  icon: string;
  /** Placeholder tint used by the renderer for carried goods. */
  color: number;
}

export const RESOURCE_INFO: Record<ResourceId, ResourceInfo> = {
  wood: { label: 'Holz', icon: '🪵', color: 0x9a6b3f },
  stone: { label: 'Stein', icon: '🪨', color: 0xa8adb8 },
  ore: { label: 'Erz', icon: '⛏️', color: 0x7a6a58 },
  weapons: { label: 'Waffen', icon: '🗡️', color: 0xc8ccd4 },
  wheat: { label: 'Weizen', icon: '🌾', color: 0xe3c558 },
  flour: { label: 'Mehl', icon: '⚪', color: 0xf1e9d6 },
  bread: { label: 'Brot', icon: '🥖', color: 0xc07a3a },
  fish: { label: 'Fisch', icon: '🐟', color: 0x7fb6d9 },
  beer: { label: 'Bier', icon: '🍺', color: 0xd9a441 },
  gold: { label: 'Gold', icon: '🪙', color: 0xe3b341 },
};

// --- Simulation ------------------------------------------------------------

/** Logic ticks per second (fixed timestep). */
export const TICK_RATE = 20;
/** Milliseconds per logic tick. */
export const TICK_MS = 1000 / TICK_RATE;
/** Clamp for frame delta so a backgrounded tab never fast-forwards. */
export const MAX_FRAME_DELTA_MS = 250;

// --- Map / iso grid ----------------------------------------------------------

export const TILE_W = 64;
export const TILE_H = 32;
export const MAP_W = 48;
export const MAP_H = 48;

/** Side length of square terrain render chunks, in tiles. */
export const TERRAIN_CHUNK_SIZE = 12;

// Terrain generation: river band, rock clusters, forest clusters.
export const TERRAIN_ROCK_CLUSTERS = 6;
export const TERRAIN_ROCK_CLUSTER_MIN = 4;
export const TERRAIN_ROCK_CLUSTER_MAX = 10;
export const TERRAIN_FOREST_CLUSTERS = 12;
export const TERRAIN_FOREST_CLUSTER_MIN = 8;
export const TERRAIN_FOREST_CLUSTER_MAX = 20;
export const TERRAIN_RIVER_WIDTH = 2;
/** Square around map center kept free of obstacles (start area), in tiles. */
export const TERRAIN_SAFE_RADIUS = 6;
/** Walking through forest is slow (units prefer paths around it). */
export const FOREST_MOVE_COST = 1.6;
/** Wood a lumberjack harvests before one adjacent forest tile is felled. */
export const FOREST_WOOD_PER_TILE = 10;
/** Every N seconds a few forest tiles try to spread to adjacent grass. */
export const FOREST_REGROW_INTERVAL = 20;
export const FOREST_REGROW_ATTEMPTS = 3;

// --- Camera / input ----------------------------------------------------------

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_DEFAULT = 1.0;
export const WHEEL_ZOOM_STEP = 1.1;
/** A pointer release counts as a tap below both thresholds. */
export const TAP_MAX_MS = 250;
export const TAP_MAX_PX = 10;

// --- Economy -----------------------------------------------------------------

/** Local output/input storage capacity of production buildings. */
export const LOCAL_STORE_CAP = 5;
/** Carrier walking speed in tiles per second. */
export const WORKER_SPEED = 2.2;
/** Carriers available at game start. */
export const START_WORKERS = 4;
/** Fraction of building cost refunded on demolition. */
export const DEMOLISH_REFUND = 0.5;

// Generous enough that walls/towers stand before wave 1 even though
// construction sites consume their materials from this stock (phase 13).
export const START_RESOURCES: Record<ResourceId, number> = {
  wood: 140,
  stone: 50,
  ore: 0,
  weapons: 0,
  wheat: 0,
  flour: 0,
  bread: 8,
  fish: 4,
  beer: 0,
  gold: 0,
};

// --- Roads (phase 4) -------------------------------------------------------------

/** Pathfinding cost of a road tile for own units (grass = 1). */
export const ROAD_MOVE_COST = 0.6;
/** Paved (upgraded) roads are even cheaper. */
export const STONE_ROAD_MOVE_COST = 0.45;
/** Walking speed multiplier while standing on a road / paved road tile. */
export const ROAD_SPEED_FACTOR = 1.4;
export const STONE_ROAD_SPEED_FACTOR = 1.8;

// --- Military (phase 2) --------------------------------------------------------
// Per-type soldier stats live in data/soldiers.ts (phase 11).

/** Carriers that must always remain — soldiers cannot use the last slots. */
export const MIN_WORKERS = 1;

// --- Carts (phase 11) -------------------------------------------------------------

/** Ox cart walking speed in tiles per second (slower but hauls more). */
export const CART_SPEED = 1.7;
/** Goods an ox cart hauls per trip. */
export const CART_CAPACITY = 3;
/** Carts provided per stable. */
export const CARTS_PER_STABLE = 1;

// --- Combat (phase 3) ------------------------------------------------------------

/** Seconds between soldier melee strikes. */
export const SOLDIER_ATTACK_INTERVAL = 0.8;
/** Soldiers engage enemies within this radius (tiles) around their guard post. */
export const SOLDIER_AGGRO_RANGE = 5;
/** Melee reach in tiles (soldiers and enemies). */
export const MELEE_RANGE = 1.3;

export const TOWER_RANGE = 5.5;
export const TOWER_DAMAGE = 4;
/** Seconds between tower shots. */
export const TOWER_ATTACK_INTERVAL = 0.9;

/**
 * Virtual path cost of a building tile for enemies: they prefer open
 * routes but will breach (attack) blocking walls when walled out.
 */
export const ENEMY_BREACH_COST = 25;
/** Enemies recompute their route at most every N seconds. */
export const ENEMY_REPATH_INTERVAL = 4;

// --- Waves (phase 3) ---------------------------------------------------------------

/** Seconds of peace before the first wave (time to build the bread chain). */
export const WAVE_FIRST_DELAY = 480;
/** Seconds between waves. */
export const WAVE_INTERVAL = 150;
/** Enemies in wave n: BASE + GROWTH × (n − 1), capped. */
export const WAVE_BASE_COUNT = 2;
export const WAVE_COUNT_GROWTH = 2;
export const WAVE_MAX_COUNT = 30;

/** Default hit points for buildings without an explicit maxHp. */
export const BUILDING_DEFAULT_HP = 50;

// --- Building levels (phase 8) ------------------------------------------------------

/** Maximum upgrade level for regular buildings (roads upgrade by def swap). */
export const BUILDING_MAX_LEVEL = 3;
/** Upgrade to level n costs base cost × (n − 1). */
export const UPGRADE_COST_FACTOR = 1;
/** Hp bonus per level above 1 (fraction of base maxHp). */
export const UPGRADE_HP_BONUS = 0.5;
/** Production speed bonus per level above 1. */
export const UPGRADE_SPEED_BONUS = 0.3;
/** Tower damage bonus / extra range per level above 1. */
export const UPGRADE_TOWER_DAMAGE_BONUS = 0.35;
export const UPGRADE_TOWER_RANGE_BONUS = 0.75;
/** Extra hut population per level above 1. */
export const UPGRADE_HUT_POPULATION = 1;

// --- Monetization (phase 6) -------------------------------------------------------

/**
 * Google's official TEST rewarded ad unit — replace with the real ad unit
 * id from the AdMob console before the store release. The AdMob APP id
 * lives in android/app/src/main/AndroidManifest.xml.
 */
export const ADMOB_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';
/** Must be false in the store release. */
export const ADMOB_USE_TEST_ADS = true;

// --- Consumption & morale (phase 12) -------------------------------------------------

/** Seconds between meals. */
export const FOOD_INTERVAL = 15;
/** Food units eaten per meal: population × this (rounded up) … */
export const FOOD_PER_POP = 0.25;
/** … plus one per soldier (they eat heartily). */
export const FOOD_PER_SOLDIER = 1;
export const MORALE_START = 70;
export const MORALE_HUNGER_PENALTY = 6;
export const MORALE_FED_BONUS = 2;
/** Extra morale when ≥2 food kinds (bread/fish/beer) are in stock. */
export const MORALE_VARIETY_BONUS = 1;
/** Worker speed = MORALE_SPEED_BASE + morale/100 × MORALE_SPEED_SPAN. */
export const MORALE_SPEED_BASE = 0.75;
export const MORALE_SPEED_SPAN = 0.5;
/** Morale lost per tax level at every meal interval. */
export const MORALE_TAX_PENALTY = 1.5;
/** Gold per population per tax level at every meal interval. */
export const TAX_GOLD_PER_POP = 0.15;

// --- Construction sites (phase 12) ----------------------------------------------------

/** Build time per footprint tile once materials arrived, in seconds. */
export const CONSTRUCTION_TIME_PER_TILE = 2.5;

// --- Veterans (phase 12) ---------------------------------------------------------------

/** Kills needed for ranks 1..3. */
export const VETERAN_THRESHOLDS = [3, 8, 15] as const;
/** Damage/hp bonus per rank. */
export const VETERAN_BONUS = 0.1;

// --- Seasons (phase 12) ------------------------------------------------------------------

/** Seconds per season (Frühling → Sommer → Herbst → Winter). */
export const SEASON_LENGTH = 180;
/** Farm output multiplier in autumn. */
export const AUTUMN_FARM_BONUS = 1.5;
/** Food consumption multiplier in winter (farms stand still). */
export const WINTER_FOOD_FACTOR = 1.5;

// --- Persistence ---------------------------------------------------------------

export const SAVE_KEY = 'burgspiel.save';
export const SAVE_VERSION = 9;
export const AUTOSAVE_INTERVAL_MS = 30_000;

/** User-facing app version (keep in sync with package.json / build.gradle). */
export const APP_VERSION = '0.1.0';
