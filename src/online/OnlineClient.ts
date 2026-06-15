/**
 * Client for the Burgspiel backend (server/). Strictly optional: the game
 * stays fully playable offline; everything here degrades into toasts when
 * the server is unreachable. Token and server URL live in localStorage.
 */

export interface OnlineUser {
  id: number;
  username: string;
  role: 'player' | 'admin';
  trophies: number;
  duelWins: number;
  duelLosses: number;
  bestWaves: number;
  bestKills: number;
  hasCastle: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  trophies: number;
  wins: number;
  losses: number;
  waves: number;
  kills: number;
}

export interface MatchOpponent {
  id: number;
  username: string;
  trophies: number;
  castleCode: string;
}

const URL_KEY = 'burgspiel.serverUrl';
const TOKEN_KEY = 'burgspiel.onlineToken';

/**
 * Default backend address. In the browser the backend is reached same-origin
 * (nginx reverse-proxies /api and /admin to the Node server), so a deployed
 * build works without manually entering a server URL. Falls back to the local
 * dev server outside the browser (e.g. tests, SSR).
 */
function defaultServerUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
    return window.location.origin;
  }
  return 'http://localhost:8787';
}

export class OnlineError extends Error {}

export class OnlineClient {
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Profile from the last successful request (UI cache). */
  user: OnlineUser | null = null;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage) {
    this.storage = storage;
  }

  get serverUrl(): string {
    return this.storage.getItem(URL_KEY) ?? defaultServerUrl();
  }

  setServerUrl(url: string): void {
    this.storage.setItem(URL_KEY, url.replace(/\/+$/, ''));
  }

  get loggedIn(): boolean {
    return this.storage.getItem(TOKEN_KEY) !== null;
  }

  logout(): void {
    this.storage.removeItem(TOKEN_KEY);
    this.user = null;
  }

  private async call<T>(
    path: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const token = this.storage.getItem(TOKEN_KEY);
    let res: Response;
    try {
      res = await fetch(this.serverUrl + path, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new OnlineError('Server nicht erreichbar');
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new OnlineError((body.error as string) ?? `Fehler ${res.status}`);
    return body as T;
  }

  private storeSession(r: { token: string; user: OnlineUser }): OnlineUser {
    this.storage.setItem(TOKEN_KEY, r.token);
    this.user = r.user;
    return r.user;
  }

  async register(username: string, password: string): Promise<OnlineUser> {
    return this.storeSession(
      await this.call<{ token: string; user: OnlineUser }>('/api/auth/register', {
        body: { username, password },
      }),
    );
  }

  async login(username: string, password: string): Promise<OnlineUser> {
    return this.storeSession(
      await this.call<{ token: string; user: OnlineUser }>('/api/auth/login', {
        body: { username, password },
      }),
    );
  }

  async fetchProfile(): Promise<OnlineUser> {
    const r = await this.call<{ user: OnlineUser }>('/api/me');
    this.user = r.user;
    return r.user;
  }

  async leaderboard(kind: 'trophies' | 'waves'): Promise<LeaderboardEntry[]> {
    const r = await this.call<{ entries: LeaderboardEntry[] }>(`/api/leaderboard/${kind}`);
    return r.entries;
  }

  /** Fire-and-forget best-run sync; errors are swallowed (offline play). */
  async submitScore(waves: number, kills: number): Promise<void> {
    if (!this.loggedIn) return;
    try {
      await this.call('/api/scores', { body: { waves, kills } });
    } catch {
      // offline — the local highscore list still has it
    }
  }

  async uploadCastle(code: string): Promise<void> {
    await this.call('/api/duel/castle', { body: { code } });
    if (this.user) this.user.hasCastle = true;
  }

  async findMatch(): Promise<MatchOpponent> {
    const r = await this.call<{ opponent: MatchOpponent }>('/api/duel/match');
    return r.opponent;
  }

  async reportDuel(opponentId: number, victory: boolean): Promise<number> {
    const r = await this.call<{ trophyDelta: number; user: OnlineUser }>('/api/duel/result', {
      body: { opponentId, victory },
    });
    this.user = r.user;
    return r.trophyDelta;
  }
}
