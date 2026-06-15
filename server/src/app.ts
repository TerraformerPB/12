import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth.js';
import { ELO_START, eloDeltas } from './elo.js';
import type { JsonStore, UserRecord } from './storage.js';

/**
 * Burgspiel backend: accounts, online leaderboards, async duel matchmaking
 * and an admin dashboard — REST + JSON on plain node:http, no dependencies.
 *
 * Matches are asynchronous (offline-first game): players upload a castle
 * snapshot, opponents are picked by Elo proximity, results are reported by
 * the client and settle both ratings. A future real-time mode can reuse
 * the same accounts and ratings.
 */

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD = 6;
const MAX_BODY = 64 * 1024;
const MAX_CASTLE_CODE = 16 * 1024;
/** Sliding-window rate limit per IP (override via BURGSPIEL_RATE_MAX). */
const RATE_WINDOW_MS = 10_000;

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  body: unknown;
  user: UserRecord | null;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Public projection of a user (never leaks the hash). */
function publicUser(u: UserRecord): Record<string, unknown> {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    trophies: u.trophies,
    duelWins: u.duelWins,
    duelLosses: u.duelLosses,
    bestWaves: u.bestWaves,
    bestKills: u.bestKills,
    hasCastle: u.castleCode !== null,
    createdAt: u.createdAt,
  };
}

/**
 * Real client IP for rate limiting. Behind a reverse proxy (nginx/Cloudflare)
 * the socket address is always the proxy, so with BURGSPIEL_TRUST_PROXY set we
 * trust the left-most X-Forwarded-For entry (nginx fills it from the real
 * client, restoring Cloudflare's CF-Connecting-IP). Off by default so a
 * directly exposed server cannot be spoofed via headers.
 */
function clientIp(req: IncomingMessage): string {
  if (process.env.BURGSPIEL_TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? '?';
}

export function createApp(store: JsonStore): (req: IncomingMessage, res: ServerResponse) => void {
  if (!store.data.secret) {
    store.data.secret = randomBytes(32).toString('hex');
    store.flushSoon();
  }
  // Seed an admin account from the environment (idempotent).
  const adminUser = process.env.BURGSPIEL_ADMIN_USER;
  const adminPass = process.env.BURGSPIEL_ADMIN_PASSWORD;
  if (adminUser && adminPass && !store.userByName(adminUser)) {
    store.data.users.push(newUser(store, adminUser, adminPass, 'admin'));
    store.flushSoon();
  }

  const rates = new Map<string, number[]>();
  const rateMax = Number(process.env.BURGSPIEL_RATE_MAX) || 30;

  return (req, res) => {
    void handle(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : 'Interner Fehler';
      if (status === 500) console.error(err);
      sendJson(res, status, { error: message });
    });
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', process.env.BURGSPIEL_CORS ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const ip = clientIp(req);
    const now = Date.now();
    const hits = (rates.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    hits.push(now);
    rates.set(ip, hits);
    if (hits.length > rateMax) throw new HttpError(429, 'Zu viele Anfragen');

    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    const ctx: Ctx = { req, res, body: await readBody(req), user: authUser(req) };

    // --- static admin dashboard ---
    if (route === 'GET /admin' || route === 'GET /admin/') {
      const dir = dirname(fileURLToPath(import.meta.url));
      const html = readFileSync(join(dir, '..', 'public', 'admin.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      return;
    }
    if (route === 'GET /api/health') {
      sendJson(res, 200, { ok: true, users: store.data.users.length });
      return;
    }

    // --- auth ---
    if (route === 'POST /api/auth/register') return register(ctx);
    if (route === 'POST /api/auth/login') return login(ctx);

    // --- account ---
    if (route === 'GET /api/me') return me(ctx);
    if (route === 'POST /api/me/password') return changePassword(ctx);
    if (route === 'DELETE /api/me') return deleteMe(ctx);

    // --- leaderboards ---
    if (route === 'GET /api/leaderboard/trophies') return leaderboard(ctx, 'trophies');
    if (route === 'GET /api/leaderboard/waves') return leaderboard(ctx, 'waves');

    // --- gameplay ---
    if (route === 'POST /api/scores') return submitScore(ctx);
    if (route === 'POST /api/duel/castle') return uploadCastle(ctx);
    if (route === 'GET /api/duel/match') return findMatch(ctx);
    if (route === 'POST /api/duel/result') return duelResult(ctx);

    // --- admin ---
    if (route === 'GET /api/admin/users') return adminUsers(ctx);
    if (route === 'GET /api/admin/stats') return adminStats(ctx);
    const banMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/(ban|unban|promote|demote)$/);
    if (req.method === 'POST' && banMatch) {
      return adminUserAction(ctx, Number(banMatch[1]), banMatch[2]);
    }
    const delMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (req.method === 'DELETE' && delMatch) return adminDeleteUser(ctx, Number(delMatch[1]));

    throw new HttpError(404, 'Unbekannte Route');
  }

  // --- helpers -------------------------------------------------------------------

  function authUser(req: IncomingMessage): UserRecord | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    const payload = verifyToken(header.slice(7), store.data.secret);
    if (!payload) return null;
    const user = store.userById(payload.userId);
    return user && !user.banned ? user : null;
  }

  function requireUser(ctx: Ctx): UserRecord {
    if (!ctx.user) throw new HttpError(401, 'Nicht angemeldet');
    return ctx.user;
  }

  function requireAdmin(ctx: Ctx): UserRecord {
    const user = requireUser(ctx);
    if (user.role !== 'admin') throw new HttpError(403, 'Nur für Admins');
    return user;
  }

  function field(body: unknown, key: string): unknown {
    return typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)[key]
      : undefined;
  }

  function issueToken(user: UserRecord): string {
    return signToken({ userId: user.id, exp: Date.now() + TOKEN_TTL_MS }, store.data.secret);
  }

  // --- auth ------------------------------------------------------------------------

  function register(ctx: Ctx): void {
    const username = field(ctx.body, 'username');
    const password = field(ctx.body, 'password');
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Name: 3–20 Zeichen, nur Buchstaben/Zahlen/_');
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Passwort: mindestens ${MIN_PASSWORD} Zeichen`);
    }
    if (store.userByName(username)) throw new HttpError(409, 'Name ist bereits vergeben');
    const user = newUser(store, username, password, store.data.users.length === 0 ? 'admin' : 'player');
    store.data.users.push(user);
    store.flushSoon();
    sendJson(ctx.res, 201, { token: issueToken(user), user: publicUser(user) });
  }

  function login(ctx: Ctx): void {
    const username = field(ctx.body, 'username');
    const password = field(ctx.body, 'password');
    const user = typeof username === 'string' ? store.userByName(username) : undefined;
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'Name oder Passwort falsch');
    }
    if (user.banned) throw new HttpError(403, 'Konto gesperrt');
    sendJson(ctx.res, 200, { token: issueToken(user), user: publicUser(user) });
  }

  // --- account ----------------------------------------------------------------------

  function me(ctx: Ctx): void {
    sendJson(ctx.res, 200, { user: publicUser(requireUser(ctx)) });
  }

  function changePassword(ctx: Ctx): void {
    const user = requireUser(ctx);
    const oldPw = field(ctx.body, 'oldPassword');
    const newPw = field(ctx.body, 'newPassword');
    if (typeof oldPw !== 'string' || !verifyPassword(oldPw, user.passwordHash)) {
      throw new HttpError(401, 'Altes Passwort falsch');
    }
    if (typeof newPw !== 'string' || newPw.length < MIN_PASSWORD) {
      throw new HttpError(400, `Passwort: mindestens ${MIN_PASSWORD} Zeichen`);
    }
    user.passwordHash = hashPassword(newPw);
    store.flushSoon();
    sendJson(ctx.res, 200, { ok: true });
  }

  function deleteMe(ctx: Ctx): void {
    const user = requireUser(ctx);
    store.data.users = store.data.users.filter((u) => u.id !== user.id);
    store.flushSoon();
    sendJson(ctx.res, 200, { ok: true });
  }

  // --- leaderboards --------------------------------------------------------------------

  function leaderboard(ctx: Ctx, kind: 'trophies' | 'waves'): void {
    const limit = Math.min(100, Number(new URL(ctx.req.url ?? '/', 'http://x').searchParams.get('limit')) || 20);
    const users = store.data.users.filter((u) => !u.banned);
    const sorted =
      kind === 'trophies'
        ? users.filter((u) => u.duelWins + u.duelLosses > 0).sort((a, b) => b.trophies - a.trophies)
        : users.filter((u) => u.bestWaves > 0).sort((a, b) => b.bestWaves - a.bestWaves || b.bestKills - a.bestKills);
    sendJson(ctx.res, 200, {
      entries: sorted.slice(0, limit).map((u, i) => ({
        rank: i + 1,
        username: u.username,
        trophies: u.trophies,
        wins: u.duelWins,
        losses: u.duelLosses,
        waves: u.bestWaves,
        kills: u.bestKills,
      })),
    });
  }

  // --- gameplay ---------------------------------------------------------------------------

  function submitScore(ctx: Ctx): void {
    const user = requireUser(ctx);
    const waves = field(ctx.body, 'waves');
    const kills = field(ctx.body, 'kills');
    if (typeof waves !== 'number' || typeof kills !== 'number' || waves < 0 || kills < 0 || waves > 10_000) {
      throw new HttpError(400, 'Ungültiger Score');
    }
    if (waves > user.bestWaves || (waves === user.bestWaves && kills > user.bestKills)) {
      user.bestWaves = Math.floor(waves);
      user.bestKills = Math.floor(kills);
      store.flushSoon();
    }
    sendJson(ctx.res, 200, { user: publicUser(user) });
  }

  function uploadCastle(ctx: Ctx): void {
    const user = requireUser(ctx);
    const code = field(ctx.body, 'code');
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CASTLE_CODE || !code.startsWith('BURG')) {
      throw new HttpError(400, 'Ungültiger Burg-Code');
    }
    user.castleCode = code;
    store.flushSoon();
    sendJson(ctx.res, 200, { ok: true });
  }

  function findMatch(ctx: Ctx): void {
    const user = requireUser(ctx);
    const candidates = store.data.users.filter(
      (u) => u.id !== user.id && !u.banned && u.castleCode !== null,
    );
    if (candidates.length === 0) throw new HttpError(404, 'Noch kein Gegner verfügbar');
    candidates.sort(
      (a, b) => Math.abs(a.trophies - user.trophies) - Math.abs(b.trophies - user.trophies),
    );
    // Small random pick among the closest ratings so rematches vary.
    const pool = candidates.slice(0, 5);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    sendJson(ctx.res, 200, {
      opponent: {
        id: pick.id,
        username: pick.username,
        trophies: pick.trophies,
        castleCode: pick.castleCode,
      },
    });
  }

  function duelResult(ctx: Ctx): void {
    const user = requireUser(ctx);
    const opponentId = field(ctx.body, 'opponentId');
    const victory = field(ctx.body, 'victory');
    if (typeof opponentId !== 'number' || typeof victory !== 'boolean') {
      throw new HttpError(400, 'Ungültiges Ergebnis');
    }
    const opponent = store.userById(opponentId);
    if (!opponent) throw new HttpError(404, 'Gegner unbekannt');
    const deltas = eloDeltas(user.trophies, opponent.trophies, victory);
    user.trophies = Math.max(0, user.trophies + deltas.attacker);
    opponent.trophies = Math.max(0, opponent.trophies + deltas.defender);
    if (victory) user.duelWins++;
    else user.duelLosses++;
    if (victory) opponent.duelLosses++;
    else opponent.duelWins++;
    store.data.duels.push({
      id: store.data.nextDuelId++,
      attackerId: user.id,
      defenderId: opponent.id,
      victory,
      attackerDelta: deltas.attacker,
      defenderDelta: deltas.defender,
      at: Date.now(),
    });
    store.flushSoon();
    sendJson(ctx.res, 200, { trophyDelta: deltas.attacker, user: publicUser(user) });
  }

  // --- admin ------------------------------------------------------------------------------

  function adminUsers(ctx: Ctx): void {
    requireAdmin(ctx);
    sendJson(ctx.res, 200, {
      users: store.data.users.map((u) => ({ ...publicUser(u), banned: u.banned })),
    });
  }

  function adminStats(ctx: Ctx): void {
    requireAdmin(ctx);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    sendJson(ctx.res, 200, {
      users: store.data.users.length,
      banned: store.data.users.filter((u) => u.banned).length,
      duelsTotal: store.data.duels.length,
      duelsToday: store.data.duels.filter((d) => d.at > dayAgo).length,
      castles: store.data.users.filter((u) => u.castleCode !== null).length,
    });
  }

  function adminUserAction(ctx: Ctx, id: number, action: string): void {
    const admin = requireAdmin(ctx);
    const target = store.userById(id);
    if (!target) throw new HttpError(404, 'Unbekannter Nutzer');
    if (target.id === admin.id && (action === 'ban' || action === 'demote')) {
      throw new HttpError(400, 'Nicht auf das eigene Konto anwendbar');
    }
    if (action === 'ban') target.banned = true;
    if (action === 'unban') target.banned = false;
    if (action === 'promote') target.role = 'admin';
    if (action === 'demote') target.role = 'player';
    store.flushSoon();
    sendJson(ctx.res, 200, { user: { ...publicUser(target), banned: target.banned } });
  }

  function adminDeleteUser(ctx: Ctx, id: number): void {
    const admin = requireAdmin(ctx);
    if (id === admin.id) throw new HttpError(400, 'Eigenes Konto: bitte über /api/me löschen');
    store.data.users = store.data.users.filter((u) => u.id !== id);
    store.flushSoon();
    sendJson(ctx.res, 200, { ok: true });
  }
}

function newUser(
  store: JsonStore,
  username: string,
  password: string,
  role: 'player' | 'admin',
): UserRecord {
  return {
    id: store.data.nextUserId++,
    username,
    passwordHash: hashPassword(password),
    role,
    banned: false,
    createdAt: Date.now(),
    trophies: ELO_START,
    duelWins: 0,
    duelLosses: 0,
    bestWaves: 0,
    bestKills: 0,
    castleCode: null,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'DELETE') {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Anfrage zu groß'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new HttpError(400, 'Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}
