import { describe, expect, it } from 'vitest';
import { migrateSave, type SaveData } from '../src/core/SaveManager';
import {
  CONSTRUCTION_TIME_PER_TILE,
  MORALE_START,
  SAVE_VERSION,
  TICK_RATE,
  VETERAN_BONUS,
  VETERAN_THRESHOLDS,
  ORE_PER_TILE,
} from '../src/data/config';
import { getDef } from '../src/data/buildings';
import { SELL_PRICE } from '../src/data/market';
import { SCENARIO_IDS, getScenario } from '../src/data/scenarios';
import { TECH_IDS, getTechDef } from '../src/data/techs';
import { Building } from '../src/entities/Building';
import { Soldier } from '../src/entities/Soldier';

describe('construction sites (phase 12)', () => {
  /** A mill set up the way Game.addBuilding creates a site. */
  function site(): Building {
    const b = new Building(1, 'mill', 5, 5, false);
    b.underConstruction = true;
    b.materialsRemaining = { ...getDef('mill').cost };
    b.buildTicks = b.totalBuildTicks;
    return b;
  }

  it('derives the build time from the footprint area', () => {
    const b = site();
    expect(b.totalBuildTicks).toBe(
      Math.round(b.w * b.h * CONSTRUCTION_TIME_PER_TILE * TICK_RATE),
    );
  });

  it('does not produce, request input or house anyone while building', () => {
    const b = site();
    b.inputStore = 3;
    for (let i = 0; i < 100; i++) b.tickProduction();
    expect(b.active).toBe(false);
    expect(b.outputStore).toBe(0);
    expect(b.inputDemand()).toBe(0);

    const hut = new Building(2, 'hut', 8, 8, false);
    hut.underConstruction = true;
    expect(hut.populationBonus).toBe(0);
    hut.underConstruction = false;
    expect(hut.populationBonus).toBeGreaterThan(0);
  });

  it('tracks missing materials and survives a save roundtrip', () => {
    const b = site();
    expect(b.materialsMissing()).toBeGreaterThan(0);
    const restored = Building.fromSave(b.toSave());
    expect(restored.underConstruction).toBe(true);
    expect(restored.materialsRemaining).toEqual(b.materialsRemaining);
    expect(restored.buildTicks).toBe(b.buildTicks);
  });
});

describe('veteran ranks (phase 12)', () => {
  it('promotes soldiers at the kill thresholds', () => {
    const s = new Soldier(1, 0, 0);
    expect(s.rank).toBe(0);
    s.kills = VETERAN_THRESHOLDS[0];
    expect(s.rank).toBe(1);
    s.kills = VETERAN_THRESHOLDS[2];
    expect(s.rank).toBe(VETERAN_THRESHOLDS.length);
  });

  it('scales hp and damage with the rank', () => {
    const s = new Soldier(1, 0, 0);
    const baseHp = s.def.hp;
    const baseDamage = s.def.damage;
    s.kills = VETERAN_THRESHOLDS[1];
    expect(s.maxHp).toBe(Math.round(baseHp * (1 + VETERAN_BONUS * 2)));
    expect(s.attackDamage).toBeCloseTo(baseDamage * (1 + VETERAN_BONUS * 2));
  });

  it('keeps kills across save/load', () => {
    const s = new Soldier(1, 4, 4);
    s.kills = 9;
    const { soldier } = Soldier.fromSave(s.toSave());
    expect(soldier.kills).toBe(9);
    expect(soldier.rank).toBe(2);
  });
});

describe('scenarios (phase 12)', () => {
  it('endless has no win condition', () => {
    expect(getScenario('endless').isWon).toBeNull();
  });

  it('survive10 is won after ten survived waves', () => {
    const isWon = getScenario('survive10').isWon!;
    expect(isWon({ wavesSurvived: 9, gold: 0, prestige: 0 })).toBe(false);
    expect(isWon({ wavesSurvived: 10, gold: 0, prestige: 0 })).toBe(true);
  });

  it('goldRush is won at 300 gold', () => {
    const isWon = getScenario('goldRush').isWon!;
    expect(isWon({ wavesSurvived: 0, gold: 299, prestige: 0 })).toBe(false);
    expect(isWon({ wavesSurvived: 0, gold: 300, prestige: 0 })).toBe(true);
  });

  it('every scenario id resolves to a definition', () => {
    for (const id of SCENARIO_IDS) {
      expect(getScenario(id).name.length).toBeGreaterThan(0);
    }
  });
});

describe('market & tech branches (phase 12)', () => {
  it('prices every producible good except gold itself', () => {
    for (const r of ['wood', 'stone', 'ore', 'weapons', 'bread', 'fish', 'beer'] as const) {
      expect(SELL_PRICE[r] ?? 0).toBeGreaterThan(0);
    }
    expect(SELL_PRICE.gold).toBeUndefined();
  });

  it('tier-2 techs reference valid prerequisites and rivals', () => {
    const ids = new Set<string>(TECH_IDS);
    for (const id of TECH_IDS) {
      const def = getTechDef(id);
      if (def.requires) expect(ids.has(def.requires)).toBe(true);
      if (def.excludes) {
        expect(ids.has(def.excludes)).toBe(true);
        // Exclusion must be mutual, otherwise one order of research cheats.
        expect(getTechDef(def.excludes as (typeof TECH_IDS)[number]).excludes).toBe(id);
      }
    }
  });
});

describe('savegame migration v8 → v9 (phase 12)', () => {
  it('fills morale, gold, construction and veteran defaults', () => {
    const v8 = {
      saveVersion: 8,
      seed: 42,
      nextEntityId: 3,
      resources: { wood: 5, stone: 2, ore: 0, weapons: 0, wheat: 0, flour: 0, bread: 1, fish: 0, beer: 0 },
      buildings: [new Building(1, 'warehouse', 23, 23, false).toSave()],
      workers: [],
      soldiers: [new Soldier(2, 20, 21).toSave()],
      enemies: [],
      wave: { number: 1, nextInSeconds: 60, kills: 0 },
      techs: [],
      tutorialStep: 0,
      terrainOverrides: [],
    } as unknown as SaveData;
    delete (v8.buildings[0] as Partial<(typeof v8.buildings)[0]>).underConstruction;
    delete (v8.soldiers[0] as Partial<(typeof v8.soldiers)[0]>).kills;

    const migrated = migrateSave(v8);
    expect(migrated).not.toBeNull();
    expect(migrated!.saveVersion).toBe(SAVE_VERSION);
    expect(migrated!.morale).toBe(MORALE_START);
    expect(migrated!.taxLevel).toBe(0);
    expect(migrated!.seasonTicks).toBe(0);
    expect(migrated!.scenarioId).toBe('endless');
    expect(migrated!.resources.gold).toBe(0);
    expect(migrated!.buildings[0].underConstruction).toBe(false);
    expect(migrated!.soldiers[0].kills).toBe(0);
  });
});

describe('empire scenario (phase 18)', () => {
  it('ranks unlock with prestige and stay ordered', async () => {
    const { RANKS, nextRank, rankFor } = await import('../src/data/ranks');
    expect(rankFor(0).name).toBe('Bauer');
    expect(rankFor(60).name).toBe('Bürger');
    expect(rankFor(99999).name).toBe('Herzog');
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].prestige).toBeGreaterThan(RANKS[i - 1].prestige);
      expect(RANKS[i].index).toBe(i);
    }
    expect(nextRank(0)!.name).toBe('Bürger');
    expect(nextRank(99999)).toBeNull();
  });

  it('every rank-gated building references an existing rank', async () => {
    const { BUILDING_DEFS } = await import('../src/data/buildings');
    const { RANKS } = await import('../src/data/ranks');
    for (const def of Object.values(BUILDING_DEFS)) {
      const rank = (def as { requiredRank?: number }).requiredRank ?? 0;
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThan(RANKS.length);
    }
  });

  it('faction prices premium their cravings and discount their own goods', async () => {
    const { factionPrice, bestExport, relationStatus } = await import('../src/data/factions');
    const { SELL_PRICE } = await import('../src/data/market');
    expect(factionPrice('seestadt', 'cloth')).toBeGreaterThan(SELL_PRICE.cloth!);
    expect(factionPrice('seestadt', 'fish')).toBeLessThan(SELL_PRICE.fish!);
    expect(bestExport('seestadt')).toBe('cloth');
    expect(relationStatus(10)).toContain('Krieg');
    expect(relationStatus(80)).toContain('Verbündet');
  });

  it('diplomacy: gifts raise relations, decay pulls them down, war raids and peace works', async () => {
    const { DiplomacySystem } = await import('../src/systems/DiplomacySystem');
    const { ResourceStore } = await import('../src/systems/EconomySystem');
    const { TICK_RATE, RELATION_START, GIFT_RELATION_GAIN } = await import('../src/data/config');
    const store = new ResourceStore();
    store.setLoose({ gold: 500, bread: 100 });
    let raids = 0;
    const diplo = new DiplomacySystem({
      store,
      spawnRaid: (s) => { raids++; return s; },
      onCaravanReturned: () => {},
      onContractFulfilled: () => {},
    });
    // gift
    expect(diplo.sendGift('eichwald')).toBe(true);
    expect(diplo.relations.eichwald).toBe(RELATION_START + GIFT_RELATION_GAIN);
    // decay after a minute
    for (let i = 0; i < 60 * TICK_RATE; i++) diplo.tick();
    expect(diplo.relations.eichwald).toBeLessThan(RELATION_START + GIFT_RELATION_GAIN);
    // war: drop below threshold → prompt raid
    diplo.adjustRelation('steinfaust', -45);
    expect(diplo.atWar('steinfaust')).toBe(true);
    diplo.tick();
    expect(raids).toBe(1);
    // no caravans while at war
    expect(diplo.sendCaravan('steinfaust', 'bread')).toBe(false);
    // peace restores relations and stops raids
    expect(diplo.offerPeace('steinfaust')).toBe(true);
    expect(diplo.atWar('steinfaust')).toBe(false);
  });

  it('caravans return with faction-priced gold and better relations', async () => {
    const { DiplomacySystem } = await import('../src/systems/DiplomacySystem');
    const { ResourceStore } = await import('../src/systems/EconomySystem');
    const { CARAVAN_BATCH, CARAVAN_TRAVEL_SECONDS, TICK_RATE } = await import('../src/data/config');
    const { factionPrice } = await import('../src/data/factions');
    const store = new ResourceStore();
    store.setLoose({ bread: 50 });
    let prestige = 0;
    const diplo = new DiplomacySystem({
      store,
      spawnRaid: () => 0,
      onCaravanReturned: () => { prestige++; },
      onContractFulfilled: () => {},
    });
    expect(diplo.sendCaravan('eichwald', 'bread')).toBe(true);
    expect(store.get('bread')).toBe(50 - CARAVAN_BATCH);
    const before = diplo.relations.eichwald;
    for (let i = 0; i <= CARAVAN_TRAVEL_SECONDS * TICK_RATE; i++) diplo.tick();
    expect(store.get('gold')).toBe(Math.round(CARAVAN_BATCH * factionPrice('eichwald', 'bread')));
    expect(diplo.relations.eichwald).toBeGreaterThan(before);
    expect(prestige).toBe(1);
    expect(diplo.caravans.length).toBe(0);
  });

  it('migrates v9 saves: wool/cloth and empire defaults', async () => {
    const { migrateSave } = await import('../src/core/SaveManager');
    // minimal v9 record
    const data = {
      saveVersion: 9, seed: 1, nextEntityId: 1,
      resources: { wood: 1, stone: 0, ore: 0, weapons: 0, wheat: 0, flour: 0, bread: 0, fish: 0, beer: 0, gold: 0 },
      buildings: [], workers: [], soldiers: [], enemies: [],
      wave: { number: 0, nextInSeconds: 60, kills: 0 },
      techs: [], tutorialStep: 0, terrainOverrides: [],
      morale: 70, taxLevel: 0, seasonTicks: 0, scenarioId: 'endless',
    } as never;
    const migrated = migrateSave(data);
    expect(migrated).not.toBeNull();
    expect(migrated!.resources.wool).toBe(0);
    expect(migrated!.resources.cloth).toBe(0);
    expect(migrated!.prestige).toBe(0);
    expect(migrated!.diplomacy).toBeNull();
  });
});

describe('empire depth (phase 19)', () => {
  async function makeDiplo(initial: Partial<Record<string, number>> = {}) {
    const { DiplomacySystem } = await import('../src/systems/DiplomacySystem');
    const { ResourceStore } = await import('../src/systems/EconomySystem');
    const store = new ResourceStore();
    store.setLoose(initial as never);
    let contracts = 0;
    const diplo = new DiplomacySystem({
      store,
      spawnRaid: () => 0,
      onCaravanReturned: () => {},
      onContractFulfilled: () => { contracts++; },
    });
    return { diplo, store, fulfilled: () => contracts };
  }

  it('selling saturates the market and prices recover over time', async () => {
    const { TICK_RATE, CARAVAN_TRAVEL_SECONDS, PRICE_SATURATION_PER_BATCH } =
      await import('../src/data/config');
    const { diplo, store } = await makeDiplo({ bread: 100 });
    const fresh = diplo.effectivePrice('eichwald', 'bread');
    diplo.sendCaravan('eichwald', 'bread');
    for (let i = 0; i <= CARAVAN_TRAVEL_SECONDS * TICK_RATE; i++) diplo.tick();
    const saturated = diplo.effectivePrice('eichwald', 'bread');
    expect(saturated).toBeCloseTo(fresh / (1 + PRICE_SATURATION_PER_BATCH), 5);
    expect(store.get('gold')).toBeGreaterThan(0);
    // recovery: several minutes of ticking raise the price again
    for (let i = 0; i < 4 * 60 * TICK_RATE; i++) diplo.tick();
    expect(diplo.effectivePrice('eichwald', 'bread')).toBeGreaterThan(saturated);
  });

  it('allies pay a price premium', async () => {
    const { ALLY_PRICE_BONUS } = await import('../src/data/config');
    const { diplo } = await makeDiplo();
    const neutral = diplo.effectivePrice('seestadt', 'cloth');
    diplo.adjustRelation('seestadt', 40); // 90 → ally
    expect(diplo.effectivePrice('seestadt', 'cloth')).toBeCloseTo(neutral * ALLY_PRICE_BONUS, 5);
  });

  it('contracts pay out, lift relations and grant prestige', async () => {
    const { CONTRACT_RELATION_GAIN } = await import('../src/data/config');
    const { diplo, store, fulfilled } = await makeDiplo({ bread: 100 });
    // inject a deterministic contract instead of waiting for the random post
    diplo.contracts.push({ factionId: 'eichwald', resource: 'bread', amount: 20, reward: 70, ticksLeft: 1000 });
    const before = diplo.relations.eichwald;
    expect(diplo.fulfillContract('eichwald')).toBe(true);
    expect(store.get('gold')).toBe(70);
    expect(store.get('bread')).toBe(80);
    expect(diplo.relations.eichwald).toBe(before + CONTRACT_RELATION_GAIN);
    expect(fulfilled()).toBe(1);
    expect(diplo.contractOf('eichwald')).toBeNull();
  });

  it('expired contracts cost relation', async () => {
    const { CONTRACT_RELATION_PENALTY } = await import('../src/data/config');
    const { diplo } = await makeDiplo();
    diplo.contracts.push({ factionId: 'steinfaust', resource: 'bread', amount: 10, reward: 30, ticksLeft: 2 });
    const before = diplo.relations.steinfaust;
    diplo.tick();
    diplo.tick();
    expect(diplo.contractOf('steinfaust')).toBeNull();
    expect(diplo.relations.steinfaust).toBe(before - CONTRACT_RELATION_PENALTY);
  });

  it('saturation and contracts survive save/restore', async () => {
    const { TICK_RATE, CARAVAN_TRAVEL_SECONDS } = await import('../src/data/config');
    const a = await makeDiplo({ bread: 100 });
    a.diplo.sendCaravan('eichwald', 'bread');
    for (let i = 0; i <= CARAVAN_TRAVEL_SECONDS * TICK_RATE; i++) a.diplo.tick();
    a.diplo.contracts.push({ factionId: 'seestadt', resource: 'cloth', amount: 12, reward: 99, ticksLeft: 500 });
    const saved = a.diplo.toSave();
    const b = await makeDiplo();
    b.diplo.restore(saved);
    expect(b.diplo.effectivePrice('eichwald', 'bread')).toBeCloseTo(
      a.diplo.effectivePrice('eichwald', 'bread'), 5,
    );
    expect(b.diplo.contractOf('seestadt')?.reward).toBe(99);
    // old v10 saves without the new fields restore with defaults
    const legacy = { ...saved };
    delete (legacy as Partial<typeof legacy>).saturation;
    delete (legacy as Partial<typeof legacy>).contracts;
    const c = await makeDiplo();
    c.diplo.restore(legacy);
    expect(c.diplo.contracts.length).toBe(0);
  });
});

describe('ore, keep & level effects (phase 20)', () => {
  it('terrain generation seeds ore veins on every map', async () => {
    const { IsoGrid, Terrain } = await import('../src/world/IsoGrid');
    const { generateTerrain } = await import('../src/world/TerrainGenerator');
    for (let i = 0; i < 10; i++) {
      const grid = new IsoGrid(48, 48);
      generateTerrain(grid, (i * 7919 + 13) >>> 0);
      let ore = 0;
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        if (grid.terrainAt(x, y) === Terrain.Ore) ore++;
      }
      expect(ore, `seed ${i}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('mines must stand next to an ore vein', async () => {
    const { IsoGrid, Terrain } = await import('../src/world/IsoGrid');
    const { checkPlacement } = await import('../src/systems/BuildSystem');
    const { getDef } = await import('../src/data/buildings');
    const grid = new IsoGrid(12, 12);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) grid.setExplored(x, y, true);
    const mine = getDef('mine');
    expect(checkPlacement(grid, mine, 4, 4, false).ok).toBe(false);
    grid.setTerrain(3, 4, Terrain.Ore);
    expect(checkPlacement(grid, mine, 4, 4, false).ok).toBe(true);
    // plain rock no longer suffices
    grid.setTerrain(3, 4, Terrain.Rock);
    expect(checkPlacement(grid, mine, 4, 4, false).ok).toBe(false);
  });

  it('the warehouse upgrades into a shooting keep', async () => {
    const { getDef } = await import('../src/data/buildings');
    expect(getDef('warehouse').upgradesTo).toBe('keep');
    const keep = getDef('keep');
    expect(keep.isWarehouse).toBe(true);
    expect(keep.shoots).toBe(true);
    expect(keep.maxHp).toBeGreaterThan(getDef('warehouse').maxHp!);
  });

  it('def-swap upgrades deduct the demolition refund', async () => {
    const { getDef } = await import('../src/data/buildings');
    const { DEMOLISH_REFUND } = await import('../src/data/config');
    // wall → wallStrong: net stone = target − refund(base)
    const wall = getDef('wall');
    const strong = getDef('wallStrong');
    const refundStone = Math.floor((wall.cost.stone ?? 0) * DEMOLISH_REFUND);
    expect((strong.cost.stone ?? 0) - refundStone).toBeLessThan(strong.cost.stone ?? 0);
  });

  it('levels grow local storage', async () => {
    const { Building } = await import('../src/entities/Building');
    const { LOCAL_STORE_CAP, UPGRADE_LOCAL_STORE } = await import('../src/data/config');
    const b = new Building(1, 'mill', 5, 5, false);
    expect(b.localCap).toBe(LOCAL_STORE_CAP);
    b.level = 3;
    expect(b.localCap).toBe(LOCAL_STORE_CAP + 2 * UPGRADE_LOCAL_STORE);
  });
});

describe('ore depletion (phase 20)', () => {
  it('a producing mine consumes the adjacent vein and halts when empty', async () => {
    const { IsoGrid, Terrain } = await import('../src/world/IsoGrid');
    const { Building } = await import('../src/entities/Building');
    const { EconomySystem, ResourceStore } = await import('../src/systems/EconomySystem');
    const grid = new IsoGrid(12, 12);
    grid.setTerrain(3, 4, Terrain.Ore); // single vein next to the mine
    const mine = new Building(2, 'mine', 4, 4, false);
    mine.assignedWorkers = 1;
    const buildings = new Map([[mine.id, mine]]);
    let depleted = 0;
    const eco = new EconomySystem({
      grid,
      store: new ResourceStore(),
      buildings,
      workers: [],
      getWarehouse: () => null,
      nextEntityId: () => 99,
      getSoldierCount: () => 0,
      getSpeedFactor: () => 1,
      fellForestTile: () => {},
      depleteOreTile: (b) => {
        depleted++;
        const tile = b.adjacentTerrainTile(grid, Terrain.Ore);
        if (tile) grid.setTerrain(tile.x, tile.y, Terrain.Rock);
      },
      getFarmFactor: () => 1,
      onConstructionFinished: () => {},
    });
    // ORE_PER_TILE outputs deplete the vein; afterwards production halts.
    for (let t = 0; t < 20 * 7 * (ORE_PER_TILE + 1) + 40; t++) {
      eco.tick();
      mine.outputStore = 0; // drain so the local store never blocks
    }
    expect(depleted).toBe(1);
    expect(grid.terrainAt(3, 4)).toBe(Terrain.Rock);
    eco.tick();
    expect(mine.productionHalted).toBe(true);
  });
});
