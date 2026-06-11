import { DUEL_AI_LEVELS, type DuelAiLevelId } from '../data/duel';

/**
 * Local duel record: trophies, wins/losses and the current win streak.
 * This is the offline foundation for the planned online match system —
 * the trophy count doubles as the matchmaking rating later.
 */
export interface DuelRating {
  trophies: number;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
}

const KEY = 'burgspiel.duel';

const EMPTY: DuelRating = { trophies: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0 };

export function loadDuelRating(storage: Pick<Storage, 'getItem'> = localStorage): DuelRating {
  try {
    const raw = storage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<DuelRating>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/** Record one finished duel; returns the new rating and the trophy delta. */
export function recordDuel(
  victory: boolean,
  level: DuelAiLevelId,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): { rating: DuelRating; delta: number } {
  const rating = loadDuelRating(storage);
  const stakes = DUEL_AI_LEVELS[level];
  // Losses never push the rating below zero.
  const loss = Math.min(stakes.trophiesLoss, rating.trophies);
  const delta = victory ? stakes.trophiesWin : loss > 0 ? -loss : 0;
  rating.trophies += delta;
  if (victory) {
    rating.wins++;
    rating.streak++;
    rating.bestStreak = Math.max(rating.bestStreak, rating.streak);
  } else {
    rating.losses++;
    rating.streak = 0;
  }
  try {
    storage.setItem(KEY, JSON.stringify(rating));
  } catch {
    // storage blocked — rating stays session-only
  }
  return { rating, delta };
}
