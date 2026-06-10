import { describe, expect, it } from 'vitest';
import { SaveManager, migrateSave, type SaveData } from '../src/core/SaveManager';
import { SAVE_VERSION } from '../src/data/config';
import { Building } from '../src/entities/Building';
import { Enemy } from '../src/entities/Enemy';
import { Soldier } from '../src/entities/Soldier';
import { Worker } from '../src/entities/Worker';
import { IsoGrid } from '../src/world/IsoGrid';
import { generateTerrain } from '../src/world/TerrainGenerator';

function fakeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function sampleData(): SaveData {
  const mill = new Building(2, 'mill', 10, 12, false);
  mill.active = true;
  mill.progress = 33;
  mill.inputStore = 2;
  mill.outputStore = 1;

  const worker = new Worker(5, 24.5, 23);
  worker.phase = 'toDropoff';
  worker.carrying = 'wheat';
  worker.job = { kind: 'deliver', buildingId: 2, resource: 'wheat' };

  const soldier = new Soldier(7, 20, 21);
  soldier.mode = 'command';
  soldier.hp = 17;
  soldier.setPath([{ x: 19, y: 21 }, { x: 18, y: 21 }]);

  const enemy = new Enemy(9, 1.5, 40);
  enemy.hp = 11;

  return {
    saveVersion: SAVE_VERSION,
    seed: 1234567,
    nextEntityId: 10,
    resources: { wood: 12, stone: 3, ore: 2, weapons: 1, wheat: 0, flour: 4, bread: 9, fish: 5, beer: 1 },
    buildings: [new Building(1, 'warehouse', 23, 23, false).toSave(), mill.toSave()],
    workers: [worker.toSave()],
    soldiers: [soldier.toSave()],
    enemies: [enemy.toSave()],
    wave: { number: 4, nextInSeconds: 87, kills: 23 },
    techs: ['fastCarriers'],
    tutorialStep: 3,
  };
}

describe('save/load roundtrip', () => {
  it('persists and restores the full save data structure', () => {
    const manager = new SaveManager(fakeStorage(), 'test');
    const data = sampleData();
    expect(manager.save(data)).toBe(true);
    expect(manager.load()).toEqual(data);
  });

  it('returns null without a save', () => {
    expect(new SaveManager(fakeStorage(), 'test').load()).toBeNull();
  });

  it('rejects unknown save versions', () => {
    const storage = fakeStorage();
    const manager = new SaveManager(storage, 'test');
    manager.save({ ...sampleData(), saveVersion: SAVE_VERSION + 1 });
    expect(manager.load()).toBeNull();
  });

  it('round-trips building state including running production timers', () => {
    const original = sampleData().buildings[1];
    const restored = Building.fromSave(original);
    expect(restored.toSave()).toEqual(original);
    expect(restored.active).toBe(true);
    expect(restored.progress).toBe(33);
  });

  it('round-trips a soldier including its movement order', () => {
    const original = sampleData().soldiers[0];
    expect(original.target).toEqual({ x: 18, y: 21 });
    const { soldier, target } = Soldier.fromSave(original);
    expect(soldier.tile).toEqual({ x: 20, y: 21 });
    expect(target).toEqual({ x: 18, y: 21 });
  });

  it('migrates v5 savegames: buildings start at level 1', () => {
    const v5 = JSON.parse(JSON.stringify(sampleData())) as SaveData;
    v5.saveVersion = 5;
    for (const b of v5.buildings) delete (b as Partial<typeof b>).level;
    const migrated = migrateSave(v5);
    expect(migrated).not.toBeNull();
    expect(migrated!.saveVersion).toBe(SAVE_VERSION);
    expect(migrated!.buildings.every((b) => b.level === 1)).toBe(true);
  });

  it('rejects pre-v5 savegames (terrain generator changed)', () => {
    // Worlds from older versions cannot be reproduced from their seed.
    expect(migrateSave({ ...sampleData(), saveVersion: 4 })).toBeNull();
    expect(migrateSave({ ...sampleData(), saveVersion: 1 })).toBeNull();
  });

  it('round-trips enemies and wave state', () => {
    const data = sampleData();
    const restored = Enemy.fromSave(data.enemies[0]);
    expect(restored.hp).toBe(11);
    expect(restored.tile).toEqual({ x: 2, y: 40 });
    expect(data.wave).toEqual({ number: 4, nextInSeconds: 87, kills: 23 });
  });

  it('round-trips worker position, cargo and job', () => {
    const original = sampleData().workers[0];
    const restored = Worker.fromSave(original);
    expect(restored.toSave()).toEqual(original);
    expect(restored.tile).toEqual({ x: 25, y: 23 });
  });

  it('regenerates identical terrain from the saved seed', () => {
    const a = new IsoGrid(48, 48);
    const b = new IsoGrid(48, 48);
    generateTerrain(a, 99887766);
    generateTerrain(b, 99887766);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        expect(a.terrainAt(x, y)).toBe(b.terrainAt(x, y));
      }
    }
  });
});
