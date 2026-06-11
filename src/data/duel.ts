import type { ResourceId } from './config';
import type { EnemyDefId } from './enemies';

/**
 * Burg-Duell (1 gegen 1): a mirrored map, one small castle per side and an
 * identical resource budget for both players. The opponent is a local AI
 * that converts its budget into attack squads over time — an online
 * opponent would plug in at the same interface (DuelAI ctx).
 */

/** Selectable, symmetric starting budgets. */
export const DUEL_BUDGETS = {
  klein: {
    name: 'Kleines Budget',
    description: 'Schnelles Gefecht',
    resources: { wood: 80, stone: 30, bread: 12, weapons: 5, fish: 6 },
  },
  mittel: {
    name: 'Mittleres Budget',
    description: 'Ausgewogen',
    resources: { wood: 130, stone: 60, bread: 24, weapons: 12, fish: 12 },
  },
  gross: {
    name: 'Großes Budget',
    description: 'Lange Schlacht',
    resources: { wood: 200, stone: 100, bread: 40, weapons: 25, fish: 18, beer: 8 },
  },
} as const satisfies Record<
  string,
  { name: string; description: string; resources: Partial<Record<ResourceId, number>> }
>;

export type DuelBudgetId = keyof typeof DUEL_BUDGETS;
export const DUEL_BUDGET_IDS = Object.keys(DUEL_BUDGETS) as DuelBudgetId[];

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
/** A duel ends after this many seconds; more warehouse hp wins then. */
export const DUEL_TIME_LIMIT = 600;

/** Seconds until the AI sends its first squad (build-up grace period). */
export const DUEL_AI_FIRST_ATTACK = 75;
/** Seconds between AI attack squads. */
export const DUEL_AI_ATTACK_INTERVAL = 45;
/** Units per AI squad (as long as the budget lasts). */
export const DUEL_AI_SQUAD_SIZE = 5;

/** What one AI unit costs from the shared budget. */
export const DUEL_UNIT_COSTS: Partial<Record<EnemyDefId, Partial<Record<ResourceId, number>>>> = {
  raider: { bread: DUEL_BREAD_PER_RAIDER },
  brute: { weapons: DUEL_WEAPONS_PER_BRUTE },
  skirmisher: { fish: DUEL_FISH_PER_SKIRMISHER },
  ram: { wood: 20 },
};
/** At most this many rams per AI squad (they pay from the wood budget). */
export const DUEL_AI_RAM_CAP = 1;

// --- Clash-style deployment & capture points (phase 14) ---------------------------

/** What deploying one player unit costs (paid from the inventory). */
export const DUEL_DEPLOY_COSTS: Record<
  'soldier' | 'knight' | 'archer' | 'ram',
  Partial<Record<ResourceId, number>>
> = {
  soldier: { bread: 3 },
  archer: { fish: 6 },
  knight: { weapons: 5, bread: 2 },
  ram: { wood: 12 },
};

/** Deployment card order and icons in the duel bar. */
export const DUEL_DEPLOY_IDS = ['soldier', 'archer', 'knight', 'ram'] as const;
export const DUEL_DEPLOY_ICONS: Record<(typeof DUEL_DEPLOY_IDS)[number], string> = {
  soldier: '⚔️',
  archer: '🏹',
  knight: '🛡️',
  ram: '🐏',
};

/** AI difficulty levels — attack pacing, squad size and trophy stakes. */
export const DUEL_AI_LEVELS = {
  leicht: { name: 'Leicht', attackInterval: 65, squadSize: 4, trophiesWin: 20, trophiesLoss: 10 },
  normal: { name: 'Normal', attackInterval: 45, squadSize: 5, trophiesWin: 30, trophiesLoss: 15 },
  schwer: { name: 'Schwer', attackInterval: 30, squadSize: 7, trophiesWin: 45, trophiesLoss: 20 },
} as const;
export type DuelAiLevelId = keyof typeof DUEL_AI_LEVELS;
export const DUEL_AI_LEVEL_IDS = Object.keys(DUEL_AI_LEVELS) as DuelAiLevelId[];

/** Capture radius of a resource depot in tiles. */
export const DUEL_NODE_RADIUS = 2.5;
/** Seconds between income ticks of a controlled depot. */
export const DUEL_NODE_INTERVAL = 6;
/** Units of the depot's resource per income tick. */
export const DUEL_NODE_YIELD = 1;

/**
 * Neutral resource depots on the battlefield (west coordinates; each gets a
 * mirrored twin so both sides face the same layout). Whoever holds units
 * nearby — and the opponent doesn't — earns the depot's resource.
 */
export const DUEL_NODES: { x: number; y: number; resource: ResourceId; icon: string }[] = [
  { x: 21, y: 17, resource: 'bread', icon: '🥖' },
  { x: 21, y: 31, resource: 'weapons', icon: '⚔️' },
];

/**
 * Cleared-to-grass rectangles for a duel map: both castle grounds, every
 * depot patch and three guaranteed lanes between the castles — random
 * rivers must never cut the halves apart (melee units have to be able to
 * reach the enemy keep).
 */
export function duelClearRects(
  mapW: number,
  mapH: number,
): { x: number; y: number; w: number; h: number }[] {
  const cy = Math.floor(mapH / 2);
  return [
    { x: 2, y: cy - 6, w: 10, h: 13 },
    { x: mapW - 12, y: cy - 6, w: 10, h: 13 },
    ...DUEL_NODES.flatMap((n) => [
      { x: n.x - 2, y: n.y - 2, w: 5, h: 5 },
      { x: mapW - 1 - (n.x + 2), y: n.y - 2, w: 5, h: 5 },
    ]),
    { x: 11, y: cy - 1, w: mapW - 22, h: 3 },
    ...DUEL_NODES.map((n) => ({ x: 11, y: n.y - 1, w: mapW - 22, h: 3 })),
  ];
}

/** Compute an attack army from resources and soldiers. Pure. */
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
