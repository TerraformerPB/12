/**
 * Player ranks in the empire scenario (Wirtschaftssimulator). Prestige
 * accrues from population, fulfilled luxury needs and trade caravans;
 * ranks gate buildings via `BuildingDef.requiredRank` and reaching the
 * highest rank wins the scenario.
 */

export interface RankDef {
  /** Index doubles as the `requiredRank` gate value. */
  index: number;
  name: string;
  icon: string;
  /** Prestige needed to hold this rank. */
  prestige: number;
}

export const RANKS: RankDef[] = [
  { index: 0, name: 'Bauer', icon: '🌾', prestige: 0 },
  { index: 1, name: 'Bürger', icon: '🏠', prestige: 60 },
  { index: 2, name: 'Händler', icon: '⚖️', prestige: 180 },
  { index: 3, name: 'Ratsherr', icon: '📜', prestige: 400 },
  { index: 4, name: 'Graf', icon: '🛡️', prestige: 750 },
  { index: 5, name: 'Herzog', icon: '👑', prestige: 1200 },
];

/** Current rank for a prestige value. */
export function rankFor(prestige: number): RankDef {
  let current = RANKS[0];
  for (const r of RANKS) {
    if (prestige >= r.prestige) current = r;
  }
  return current;
}

/** The next rank to reach, or null at the top. */
export function nextRank(prestige: number): RankDef | null {
  const current = rankFor(prestige);
  return RANKS[current.index + 1] ?? null;
}
