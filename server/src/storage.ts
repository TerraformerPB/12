import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Persistence for the Burgspiel backend: one JSON file, loaded into memory,
 * flushed atomically (tmp file + rename) and debounced. Deliberately
 * dependency-free — at leaderboard/account scale a document store is
 * plenty, and the server runs anywhere Node 18+ runs. Swap this class for
 * a real database behind the same interface when the player count demands it.
 */

export interface UserRecord {
  id: number;
  username: string;
  /** scrypt hash, format: salt:hex */
  passwordHash: string;
  role: 'player' | 'admin';
  banned: boolean;
  createdAt: number;
  /** Online duel rating (Elo, starts at 1000). */
  trophies: number;
  duelWins: number;
  duelLosses: number;
  /** Best survival run. */
  bestWaves: number;
  bestKills: number;
  /** Uploaded castle snapshot (BURG1. code) for async duels. */
  castleCode: string | null;
  adsWatched: number;
}

export interface DuelLogRecord {
  id: number;
  attackerId: number;
  defenderId: number;
  victory: boolean;
  attackerDelta: number;
  defenderDelta: number;
  at: number;
}

export interface DataShape {
  nextUserId: number;
  nextDuelId: number;
  /** HMAC secret for tokens; generated on first start. */
  secret: string;
  users: UserRecord[];
  duels: DuelLogRecord[];
  adsEnabled?: boolean;
}

const EMPTY: DataShape = { nextUserId: 1, nextDuelId: 1, secret: '', users: [], duels: [], adsEnabled: true };

export class JsonStore {
  readonly data: DataShape;
  private readonly file: string | null;
  private flushTimer: NodeJS.Timeout | null = null;

  /** file = null keeps everything in memory (tests). */
  constructor(file: string | null) {
    this.file = file;
    this.data = { ...EMPTY, users: [], duels: [] };
    if (file) {
      try {
        const raw = readFileSync(file, 'utf8');
        Object.assign(this.data, JSON.parse(raw) as DataShape);
      } catch {
        // first start — file appears on the first flush
      }
    }
  }

  userByName(username: string): UserRecord | undefined {
    const needle = username.toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === needle);
  }

  userById(id: number): UserRecord | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  /** Schedule an atomic write (debounced 250 ms). */
  flushSoon(): void {
    if (!this.file) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, 250);
    this.flushTimer.unref?.();
  }

  flushNow(): void {
    if (!this.file) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
