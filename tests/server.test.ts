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
