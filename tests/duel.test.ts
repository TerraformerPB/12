import { describe, expect, it } from 'vitest';
import { decodeCastle, encodeCastle, type CastleSnapshot } from '../src/core/CastleCode';
import { DUEL_ARMY_CAP, computeArmy } from '../src/data/duel';

const RES = {
  wood: 0, stone: 0, ore: 0, weapons: 0, wheat: 0, flour: 0, bread: 0, fish: 0, beer: 0, gold: 0,
};

describe('castle codes', () => {
  it('round-trips a castle snapshot', () => {
    const snapshot: Omit<CastleSnapshot, 'v'> = {
      seed: 987654,
      overrides: [[3, 4, 0]],
      buildings: [
        { d: 'warehouse', x: 23, y: 23, r: 0, l: 2 },
        { d: 'tower', x: 19, y: 21, r: 0, l: 3 },
        { d: 'fishery', x: 10, y: 11, r: 1, l: 1 },
      ],
      soldiers: [{ x: 20, y: 20 }],
      techs: ['steelArrows'],
    };
    const code = encodeCastle(snapshot);
    expect(code.startsWith('BURG1.')).toBe(true);
    expect(decodeCastle(code)).toEqual({ v: 1, ...snapshot });
    // Whitespace from messengers is tolerated.
    expect(decodeCastle(`  ${code}\n`)).not.toBeNull();
  });

  it('rejects garbage and foreign prefixes', () => {
    expect(decodeCastle('quatsch')).toBeNull();
    expect(decodeCastle('BURG1.%%%')).toBeNull();
    expect(decodeCastle('BURG2.abc')).toBeNull();
  });
});

describe('duel army', () => {
  it('converts bread, weapons, fish and soldiers into troops', () => {
    const army = computeArmy({ ...RES, bread: 9, weapons: 10, fish: 12 }, 2);
    const count = (id: string): number => army.filter((a) => a === id).length;
    expect(count('raider')).toBe(3 + 4); // 9/3 bread + 2 soldiers × 2
    expect(count('brute')).toBe(2); // 10/5 weapons
    expect(count('skirmisher')).toBe(2); // 12/6 fish
  });

  it('returns an empty army without supplies', () => {
    expect(computeArmy({ ...RES }, 0)).toEqual([]);
  });

  it('caps the army size', () => {
    const army = computeArmy({ ...RES, bread: 900 }, 50);
    expect(army.length).toBe(DUEL_ARMY_CAP);
  });
});

describe('phase 11 data', () => {
  it('exposes both soldier types with sane stats', async () => {
    const { getSoldierType } = await import('../src/data/soldiers');
    const soldier = getSoldierType('soldier');
    const knight = getSoldierType('knight');
    expect(knight.hp).toBeGreaterThan(soldier.hp);
    expect(knight.damage).toBeGreaterThan(soldier.damage);
    expect((knight.cost.weapons ?? 0) > (soldier.cost.weapons ?? 0)).toBe(true);
  });

  it('adds battering rams from wave 6 that ignore soldiers', async () => {
    const { waveComposition, getEnemyDef } = await import('../src/data/enemies');
    expect(waveComposition(5, 10).map((p) => p.defId)).not.toContain('ram');
    expect(waveComposition(6, 12).map((p) => p.defId)).toContain('ram');
    expect(getEnemyDef('ram').ignoresSoldiers).toBe(true);
  });

  it('wall and gate upgrade into stronger variants', async () => {
    const { getDef } = await import('../src/data/buildings');
    expect(getDef('wall').upgradesTo).toBe('wallStrong');
    expect(getDef('gate').upgradesTo).toBe('gateIron');
    expect(getDef('wallStrong').maxHp).toBeGreaterThan(getDef('wall').maxHp ?? 0);
    expect(getDef('gateIron').passable).toBe(true);
  });
});

describe('mirror duel (phase 13)', () => {
  it('mirrors the west half onto the east half', async () => {
    const { IsoGrid } = await import('../src/world/IsoGrid');
    const { generateTerrain, mirrorTerrainEastWest } = await import(
      '../src/world/TerrainGenerator'
    );
    const grid = new IsoGrid(48, 48);
    generateTerrain(grid, 13371337);
    mirrorTerrainEastWest(grid);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 24; x++) {
        expect(grid.terrainAt(47 - x, y)).toBe(grid.terrainAt(x, y));
      }
    }
  });

  it('clears the requested castle rects to grass', async () => {
    const { IsoGrid, Terrain } = await import('../src/world/IsoGrid');
    const { generateTerrain, mirrorTerrainEastWest } = await import(
      '../src/world/TerrainGenerator'
    );
    const grid = new IsoGrid(48, 48);
    generateTerrain(grid, 24682468);
    mirrorTerrainEastWest(grid, [{ x: 2, y: 18, w: 10, h: 13 }]);
    for (let y = 18; y < 31; y++) {
      for (let x = 2; x < 12; x++) {
        expect(grid.terrainAt(x, y)).toBe(Terrain.Grass);
      }
    }
  });

  it('AI converts its budget into squads until it is exhausted', async () => {
    const { DuelAI } = await import('../src/systems/DuelAI');
    const { Enemy } = await import('../src/entities/Enemy');
    const enemies: InstanceType<typeof Enemy>[] = [];
    let nextId = 1;
    let squads = 0;
    const ai = new DuelAI(
      {
        enemies,
        nextEntityId: () => nextId++,
        spawnTile: () => ({ x: 40, y: 24 }),
        playSound: () => {},
        onSquadSent: () => squads++,
      },
      { bread: 9, weapons: 10, fish: 6 },
    );
    // 9/3 raiders + 10/5 brutes + 6/6 skirmishers = 6 units total.
    let sent = 0;
    while (!ai.exhausted) sent += ai.sendSquad();
    expect(sent).toBe(6);
    expect(enemies.length).toBe(6);
    expect(squads).toBeGreaterThan(0);
    expect(ai.sendSquad()).toBe(0); // budget exhausted
  });

  it('offers three symmetric budgets', async () => {
    const { DUEL_BUDGETS, DUEL_BUDGET_IDS } = await import('../src/data/duel');
    expect(DUEL_BUDGET_IDS.length).toBe(3);
    for (const id of DUEL_BUDGET_IDS) {
      const b = DUEL_BUDGETS[id];
      expect((b.resources.wood ?? 0)).toBeGreaterThan(0);
      expect((b.resources.bread ?? 0)).toBeGreaterThan(0);
    }
  });
});

describe('clash-style duel (phase 14)', () => {
  it('depot income tops the AI budget back up', async () => {
    const { DuelAI } = await import('../src/systems/DuelAI');
    const ai = new DuelAI(
      {
        enemies: [],
        nextEntityId: () => 1,
        spawnTile: () => ({ x: 40, y: 24 }),
        playSound: () => {},
        onSquadSent: () => {},
      },
      {},
    );
    expect(ai.exhausted).toBe(true);
    ai.credit('bread', 3);
    expect(ai.exhausted).toBe(false);
    expect(ai.sendSquad()).toBe(1);
  });

  it('deploy costs and depots are defined consistently', async () => {
    const { DUEL_DEPLOY_COSTS, DUEL_NODES } = await import('../src/data/duel');
    expect((DUEL_DEPLOY_COSTS.soldier.bread ?? 0)).toBeGreaterThan(0);
    expect((DUEL_DEPLOY_COSTS.knight.weapons ?? 0)).toBeGreaterThan(0);
    expect(DUEL_NODES.length).toBeGreaterThan(0);
    for (const n of DUEL_NODES) {
      // West half only — the mirrored twin is derived at duel start.
      expect(n.x).toBeLessThan(24);
      expect(['bread', 'weapons', 'fish'].includes(n.resource)).toBe(true);
    }
  });
});

describe('duel expansion (phase 15)', () => {
  function fakeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
    const map = new Map<string, string>();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  }

  it('trophy rating tracks wins, losses and streaks per difficulty', async () => {
    const { loadDuelRating, recordDuel } = await import('../src/core/DuelRating');
    const storage = fakeStorage();
    expect(loadDuelRating(storage).trophies).toBe(0);
    const win = recordDuel(true, 'schwer', storage);
    expect(win.delta).toBe(45);
    const win2 = recordDuel(true, 'leicht', storage);
    expect(win2.rating.trophies).toBe(65);
    expect(win2.rating.streak).toBe(2);
    const loss = recordDuel(false, 'normal', storage);
    expect(loss.delta).toBe(-15);
    expect(loss.rating.streak).toBe(0);
    expect(loss.rating.bestStreak).toBe(2);
    expect(loss.rating.wins).toBe(2);
    expect(loss.rating.losses).toBe(1);
  });

  it('trophies never drop below zero', async () => {
    const { recordDuel } = await import('../src/core/DuelRating');
    const storage = fakeStorage();
    const loss = recordDuel(false, 'schwer', storage);
    expect(loss.rating.trophies).toBe(0);
    expect(loss.delta).toBe(0);
  });

  it('adds archer (ranged) and ram (siege) as duel-only cards', async () => {
    const { getSoldierType } = await import('../src/data/soldiers');
    const { DUEL_DEPLOY_IDS, DUEL_DEPLOY_COSTS } = await import('../src/data/duel');
    expect(DUEL_DEPLOY_IDS.length).toBe(4);
    const archer = getSoldierType('archer');
    expect(archer.range).toBeGreaterThan(1);
    expect(archer.duelOnly).toBe(true);
    const ram = getSoldierType('ram');
    expect(ram.siege).toBe(true);
    expect(ram.duelOnly).toBe(true);
    for (const id of DUEL_DEPLOY_IDS) {
      expect(Object.keys(DUEL_DEPLOY_COSTS[id]).length).toBeGreaterThan(0);
    }
  });

  it('harder AI levels attack faster with bigger squads', async () => {
    const { DUEL_AI_LEVELS } = await import('../src/data/duel');
    expect(DUEL_AI_LEVELS.schwer.attackInterval).toBeLessThan(DUEL_AI_LEVELS.leicht.attackInterval);
    expect(DUEL_AI_LEVELS.schwer.squadSize).toBeGreaterThan(DUEL_AI_LEVELS.leicht.squadSize);
    expect(DUEL_AI_LEVELS.schwer.trophiesWin).toBeGreaterThan(DUEL_AI_LEVELS.leicht.trophiesWin);
  });

  it('AI squads cap their rams and spend wood on them', async () => {
    const { DuelAI } = await import('../src/systems/DuelAI');
    const { Enemy } = await import('../src/entities/Enemy');
    const enemies: InstanceType<typeof Enemy>[] = [];
    let id = 1;
    const ai = new DuelAI(
      { enemies, nextEntityId: () => id++, spawnTile: () => ({ x: 40, y: 24 }), playSound: () => {}, onSquadSent: () => {} },
      { wood: 100 },
      'normal',
    );
    expect(ai.sendSquad()).toBe(1); // only rams affordable, capped at 1 per squad
    expect(enemies.filter((e) => e.defId === 'ram').length).toBe(1);
  });
});
