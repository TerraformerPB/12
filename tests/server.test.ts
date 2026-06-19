import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app';
import { JsonStore } from '../server/src/storage';
import { eloDeltas, ELO_START } from '../server/src/elo';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../server/src/auth';

let server: Server;
let base = '';
let store: JsonStore;

async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  process.env.BURGSPIEL_RATE_MAX = '10000'; // the suite fires fast bursts
  store = new JsonStore(null); // in-memory
  server = createServer(createApp(store));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('auth & accounts', () => {
  it('hashes and verifies passwords (scrypt)', () => {
    const hash = hashPassword('geheim123');
    expect(verifyPassword('geheim123', hash)).toBe(true);
    expect(verifyPassword('falsch', hash)).toBe(false);
  });

  it('signs and verifies tokens; rejects tampering and expiry', () => {
    const token = signToken({ userId: 7, exp: Date.now() + 1000 }, 'secret');
    expect(verifyToken(token, 'secret')?.userId).toBe(7);
    expect(verifyToken(token, 'other')).toBeNull();
    expect(verifyToken(token + 'x', 'secret')).toBeNull();
    const expired = signToken({ userId: 7, exp: Date.now() - 1 }, 'secret');
    expect(verifyToken(expired, 'secret')).toBeNull();
  });

  it('registers the first account as admin, later ones as players', async () => {
    const first = await api('/api/auth/register', { body: { username: 'koenig', password: 'burgburg' } });
    expect(first.status).toBe(201);
    expect((first.body.user as Record<string, unknown>).role).toBe('admin');
    const second = await api('/api/auth/register', { body: { username: 'ritter1', password: 'burgburg' } });
    expect((second.body.user as Record<string, unknown>).role).toBe('player');
  });

  it('rejects bad usernames, short passwords and duplicates', async () => {
    expect((await api('/api/auth/register', { body: { username: 'x', password: 'burgburg' } })).status).toBe(400);
    expect((await api('/api/auth/register', { body: { username: 'okname', password: 'kurz' } })).status).toBe(400);
    expect((await api('/api/auth/register', { body: { username: 'KOENIG', password: 'burgburg' } })).status).toBe(409);
  });

  it('logs in and serves the profile', async () => {
    const login = await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } });
    expect(login.status).toBe(200);
    const me = await api('/api/me', { token: login.body.token as string });
    expect((me.body.user as Record<string, unknown>).username).toBe('ritter1');
    expect((await api('/api/me')).status).toBe(401);
  });
});

describe('scores & leaderboards', () => {
  let token = '';
  beforeAll(async () => {
    const login = await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } });
    token = login.body.token as string;
  });

  it('keeps only the best run', async () => {
    await api('/api/scores', { token, body: { waves: 5, kills: 40 } });
    await api('/api/scores', { token, body: { waves: 3, kills: 99 } });
    const me = await api('/api/me', { token });
    expect((me.body.user as Record<string, unknown>).bestWaves).toBe(5);
    expect((me.body.user as Record<string, unknown>).bestKills).toBe(40);
  });

  it('serves the waves leaderboard', async () => {
    const lb = await api('/api/leaderboard/waves');
    const entries = lb.body.entries as { username: string; waves: number }[];
    expect(entries[0].username).toBe('ritter1');
    expect(entries[0].waves).toBe(5);
  });
});

describe('duels & elo', () => {
  it('elo is zero-sum and favours upsets', () => {
    const even = eloDeltas(1000, 1000, true);
    expect(even.attacker).toBe(16);
    expect(even.defender).toBe(-16);
    const upset = eloDeltas(900, 1100, true);
    expect(upset.attacker).toBeGreaterThan(16);
    expect(upset.attacker + upset.defender).toBe(0);
  });

  it('uploads castles, finds matches by rating and settles results', async () => {
    const a = await api('/api/auth/login', { body: { username: 'koenig', password: 'burgburg' } });
    const b = await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } });
    const ta = a.body.token as string;
    const tb = b.body.token as string;

    expect((await api('/api/duel/match', { token: ta })).status).toBe(404); // nobody uploaded yet
    expect((await api('/api/duel/castle', { token: tb, body: { code: 'kein-burg-code' } })).status).toBe(400);
    await api('/api/duel/castle', { token: tb, body: { code: 'BURG1.abc' } });

    const match = await api('/api/duel/match', { token: ta });
    const opponent = match.body.opponent as Record<string, unknown>;
    expect(opponent.username).toBe('ritter1');
    expect(opponent.castleCode).toBe('BURG1.abc');

    const result = await api('/api/duel/result', { token: ta, body: { opponentId: opponent.id, victory: true } });
    expect(result.body.trophyDelta).toBe(16);
    const meA = await api('/api/me', { token: ta });
    expect((meA.body.user as Record<string, unknown>).trophies).toBe(ELO_START + 16);
    const meB = await api('/api/me', { token: tb });
    expect((meB.body.user as Record<string, unknown>).trophies).toBe(ELO_START - 16);
    const lb = await api('/api/leaderboard/trophies');
    expect((lb.body.entries as unknown[]).length).toBe(2);
  });
});

describe('admin', () => {
  let admin = '';
  let playerId = 0;
  beforeAll(async () => {
    const a = await api('/api/auth/login', { body: { username: 'koenig', password: 'burgburg' } });
    admin = a.body.token as string;
    playerId = store.userByName('ritter1')!.id;
  });

  it('lists users and stats for admins only', async () => {
    const denied = await api('/api/admin/users');
    expect(denied.status).toBe(401);
    const users = await api('/api/admin/users', { token: admin });
    expect((users.body.users as unknown[]).length).toBeGreaterThanOrEqual(2);
    const stats = await api('/api/admin/stats', { token: admin });
    expect(stats.body.duelsTotal).toBe(1);
  });

  it('bans lock the account out and hide it from leaderboards', async () => {
    await api(`/api/admin/users/${playerId}/ban`, { token: admin, method: 'POST', body: {} });
    const login = await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } });
    expect(login.status).toBe(403);
    const lb = await api('/api/leaderboard/waves');
    expect((lb.body.entries as { username: string }[]).some((e) => e.username === 'ritter1')).toBe(false);
    await api(`/api/admin/users/${playerId}/unban`, { token: admin, method: 'POST', body: {} });
    const again = await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } });
    expect(again.status).toBe(200);
  });

  it('admins cannot ban themselves', async () => {
    const selfId = store.userByName('koenig')!.id;
    const res = await api(`/api/admin/users/${selfId}/ban`, { token: admin, method: 'POST', body: {} });
    expect(res.status).toBe(400);
  });
});

describe('admin moderation tools', () => {
  let admin = '';
  let playerId = 0;
  beforeAll(async () => {
    const a = await api('/api/auth/login', { body: { username: 'koenig', password: 'burgburg' } });
    admin = a.body.token as string;
    playerId = store.userByName('ritter1')!.id;
  });

  it('records an audit entry for every state-changing action', async () => {
    await api(`/api/admin/users/${playerId}/promote`, { token: admin, method: 'POST', body: {} });
    await api(`/api/admin/users/${playerId}/demote`, { token: admin, method: 'POST', body: {} });
    const audit = await api('/api/admin/audit', { token: admin });
    const entries = audit.body.entries as { action: string; detail: string; adminName: string }[];
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // Newest first.
    expect(entries[0].action).toBe('demote');
    expect(entries[0].adminName).toBe('koenig');
    expect((await api('/api/admin/audit')).status).toBe(401); // admin only
  });

  it('suspends an account for a fixed time and lifts it automatically', async () => {
    const res = await api(`/api/admin/users/${playerId}/suspend`, {
      token: admin,
      method: 'POST',
      body: { hours: 2 },
    });
    expect(res.status).toBe(200);
    expect((res.body.user as Record<string, unknown>).banned).toBe(true);
    // Locked out while the suspension stands.
    expect((await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } })).status).toBe(403);
    // Once the deadline passes, the next login lifts the ban for good.
    store.userByName('ritter1')!.bannedUntil = Date.now() - 1;
    const login = await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } });
    expect(login.status).toBe(200);
    expect(store.userByName('ritter1')!.banned).toBe(false);
  });

  it('rejects bad suspension durations and self-suspension', async () => {
    expect((await api(`/api/admin/users/${playerId}/suspend`, { token: admin, method: 'POST', body: { hours: 0 } })).status).toBe(400);
    const selfId = store.userByName('koenig')!.id;
    expect((await api(`/api/admin/users/${selfId}/suspend`, { token: admin, method: 'POST', body: { hours: 5 } })).status).toBe(400);
  });

  it('lists recent duels with resolved names', async () => {
    const duels = await api('/api/admin/duels', { token: admin });
    const entries = duels.body.entries as { attacker: string; defender: string }[];
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(typeof entries[0].attacker).toBe('string');
    expect((await api('/api/admin/duels')).status).toBe(401);
  });

  it('maintenance mode pauses gameplay for players but not admins', async () => {
    const player = await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } });
    const pt = player.body.token as string;
    const toggle = await api('/api/admin/maintenance', { token: admin, method: 'POST', body: {} });
    expect(toggle.body.maintenanceMode).toBe(true);
    expect((await api('/api/scores', { token: pt, body: { waves: 1, kills: 1 } })).status).toBe(503);
    // Admins keep working through maintenance.
    expect((await api('/api/scores', { token: admin, body: { waves: 1, kills: 1 } })).status).toBe(200);
    // Turn it back off.
    const off = await api('/api/admin/maintenance', { token: admin, method: 'POST', body: {} });
    expect(off.body.maintenanceMode).toBe(false);
    expect((await api('/api/scores', { token: pt, body: { waves: 1, kills: 1 } })).status).toBe(200);
  });
});

describe('ad management', () => {
  let adminToken = '';
  let playerToken = '';

  beforeAll(async () => {
    const adminLogin = await api('/api/auth/login', { body: { username: 'koenig', password: 'burgburg' } });
    adminToken = adminLogin.body.token as string;
    const playerLogin = await api('/api/auth/login', { body: { username: 'ritter1', password: 'burgburg' } });
    playerToken = playerLogin.body.token as string;
  });

  it('increments watched ads count for player', async () => {
    const res = await api('/api/ad-watched', { token: playerToken, method: 'POST', body: {} });
    expect(res.status).toBe(200);
    expect(res.body.adsWatched).toBe(1);

    const me = await api('/api/me', { token: playerToken });
    expect((me.body.user as any).adsWatched).toBe(1);
  });

  it('toggles global ads enabled status as admin only', async () => {
    const stats = await api('/api/admin/stats', { token: adminToken });
    expect(stats.body.adsEnabled).toBe(true);

    const failToggle = await api('/api/admin/ads/toggle', { token: playerToken, method: 'POST', body: {} });
    expect(failToggle.status).toBe(403);

    const toggle1 = await api('/api/admin/ads/toggle', { token: adminToken, method: 'POST', body: {} });
    expect(toggle1.status).toBe(200);
    expect(toggle1.body.adsEnabled).toBe(false);

    const stats2 = await api('/api/admin/stats', { token: adminToken });
    expect(stats2.body.adsEnabled).toBe(false);

    const me = await api('/api/me', { token: playerToken });
    expect(me.body.adsEnabled).toBe(false);

    const toggle2 = await api('/api/admin/ads/toggle', { token: adminToken, method: 'POST', body: {} });
    expect(toggle2.body.adsEnabled).toBe(true);
  });
});
