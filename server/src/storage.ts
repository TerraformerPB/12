import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  /** For timed suspensions: unix ms when the ban auto-lifts (null = permanent). */
  bannedUntil?: number | null;
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

/** An audit trail entry for every state-changing admin action. */
export interface AuditRecord {
  id: number;
  /** Who performed the action. */
  adminId: number;
  adminName: string;
  /** Machine action key, e.g. 'ban', 'suspend', 'delete', 'maintenance'. */
  action: string;
  /** Affected user id, if any. */
  targetId?: number | null;
  /** Human-readable detail for the dashboard. */
  detail?: string;
  at: number;
}

export interface DataShape {
  nextUserId: number;
  nextDuelId: number;
  nextAuditId: number;
  /** HMAC secret for tokens; generated on first start. */
  secret: string;
  users: UserRecord[];
  duels: DuelLogRecord[];
  auditLog: AuditRecord[];
  adsEnabled?: boolean;
  /** When true, gameplay endpoints are paused for non-admins. */
  maintenanceMode?: boolean;
}

const EMPTY: DataShape = {
  nextUserId: 1,
  nextDuelId: 1,
  nextAuditId: 1,
  secret: '',
  users: [],
  duels: [],
  auditLog: [],
  adsEnabled: true,
  maintenanceMode: false,
};

export class JsonStore {
  readonly data: DataShape;
  private readonly file: string | null;
  private flushTimer: NodeJS.Timeout | null = null;

  /** file = null keeps everything in memory (tests). */
  constructor(file: string | null) {
    this.file = file;
    this.data = { ...EMPTY, users: [], duels: [], auditLog: [] };
    if (file) {
      try {
        const raw = readFileSync(file, 'utf8');
        Object.assign(this.data, JSON.parse(raw) as DataShape);
        // Backfill fields added after the file was first written.
        this.data.auditLog ??= [];
        this.data.nextAuditId ??= 1;
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
    // Keep one previous version as a safety net before overwriting.
    if (existsSync(this.file)) {
      try {
        copyFileSync(this.file, `${this.file}.bak`);
      } catch {
        // a missing backup must never block the write
      }
    }
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
