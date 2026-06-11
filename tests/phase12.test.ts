import { describe, expect, it } from 'vitest';
import { migrateSave, type SaveData } from '../src/core/SaveManager';
import {
  CONSTRUCTION_TIME_PER_TILE,
  MORALE_START,
  SAVE_VERSION,
  TICK_RATE,
  VETERAN_BONUS,
  VETERAN_THRESHOLDS,
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
    expect(isWon({ wavesSurvived: 9, gold: 0 })).toBe(false);
    expect(isWon({ wavesSurvived: 10, gold: 0 })).toBe(true);
  });

  it('goldRush is won at 300 gold', () => {
    const isWon = getScenario('goldRush').isWon!;
    expect(isWon({ wavesSurvived: 0, gold: 299 })).toBe(false);
    expect(isWon({ wavesSurvived: 0, gold: 300 })).toBe(true);
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
