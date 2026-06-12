import { RELATION_ALLY_THRESHOLD, RELATION_WAR_THRESHOLD, type ResourceId } from './config';
import { SELL_PRICE } from './market';

/**
 * Neighbour factions of the empire scenario. Each has its own market:
 * goods it craves fetch a premium when caravans deliver them, goods it
 * produces itself sell poorly. Relations decide between trade and war.
 */

export interface FactionDef {
  id: FactionId;
  name: string;
  icon: string;
  description: string;
  /** Price factor on the base SELL_PRICE when selling TO this faction. */
  buys: Partial<Record<ResourceId, number>>;
}

export const FACTIONS = {
  eichwald: {
    id: 'eichwald',
    name: 'Grafschaft Eichwald',
    icon: '🌳',
    description: 'Waldreiche Grafschaft — hungrig nach Brot und Bier.',
    buys: { bread: 1.8, beer: 1.6, fish: 1.3, wood: 0.5, cloth: 1.2 },
  },
  seestadt: {
    id: 'seestadt',
    name: 'Hansebund Seestadt',
    icon: '⚓',
    description: 'Reiche Handelsstadt — zahlt Spitzenpreise für Tuch und Waffen.',
    buys: { cloth: 2.0, weapons: 1.6, beer: 1.3, fish: 0.5, wool: 1.2 },
  },
  steinfaust: {
    id: 'steinfaust',
    name: 'Bergclan Steinfaust',
    icon: '⛰️',
    description: 'Raue Bergleute — kaufen Nahrung und Tuch, Stein haben sie selbst.',
    buys: { bread: 1.6, fish: 1.5, cloth: 1.4, stone: 0.4, ore: 0.5 },
  },
} as const satisfies Record<string, Omit<FactionDef, 'id'> & { id: string }>;

export type FactionId = keyof typeof FACTIONS;
export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];

export function getFaction(id: FactionId): FactionDef {
  return FACTIONS[id] as FactionDef;
}

/** Gold one unit fetches when a caravan sells it to the faction. */
export function factionPrice(id: FactionId, resource: ResourceId): number {
  const base = SELL_PRICE[resource] ?? 0;
  const factor = (FACTIONS[id].buys as Partial<Record<ResourceId, number>>)[resource] ?? 1;
  return base * factor;
}

/** The good this faction currently pays the most for (caravan suggestion). */
export function bestExport(id: FactionId): ResourceId {
  let best: ResourceId = 'bread';
  let bestPrice = 0;
  for (const r of Object.keys(SELL_PRICE) as ResourceId[]) {
    const p = factionPrice(id, r);
    if (p > bestPrice) {
      bestPrice = p;
      best = r;
    }
  }
  return best;
}

/** German status label for a relation value. */
export function relationStatus(relation: number): string {
  if (relation < RELATION_WAR_THRESHOLD) return '⚔️ Krieg';
  if (relation < 35) return '😠 Feindselig';
  if (relation < 60) return '😐 Neutral';
  if (relation < RELATION_ALLY_THRESHOLD) return '🙂 Freundlich';
  return '🤝 Verbündet';
}
