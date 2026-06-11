/** Local highscore list (top runs), stored in localStorage. */

export interface ScoreEntry {
  waves: number;
  kills: number;
  date: string;
}

const KEY = 'burgspiel.scores';
const MAX_ENTRIES = 5;

export function loadScores(storage: Pick<Storage, 'getItem'> = localStorage): ScoreEntry[] {
  try {
    const raw = storage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScoreEntry[]) : [];
  } catch {
    return [];
  }
}

/** Insert a run, keep the best MAX_ENTRIES (waves, then kills). */
export function recordScore(
  entry: ScoreEntry,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): ScoreEntry[] {
  const scores = [...loadScores(storage), entry]
    .sort((a, b) => b.waves - a.waves || b.kills - a.kills)
    .slice(0, MAX_ENTRIES);
  try {
    storage.setItem(KEY, JSON.stringify(scores));
  } catch {
    // storage full/blocked — scores stay session-only
  }
  return scores;
}
