import { describe, expect, it } from 'vitest';
import { SaveManager, migrateSave, type SaveData } from '../src/core/SaveManager';
import { SAVE_VERSION } from '../src/data/config';
import { Building } from '../src/entities/Building';
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
  soldier.state = 'moving';
  soldier.setPath([{ x: 19, y: 21 }, { x: 18, y: 21 }]);

  return {
    saveVersion: SAVE_VERSION,
    seed: 1234567,
    nextEntityId: 8,
    resources: { wood: 12, stone: 3, wheat: 0, flour: 4, bread: 9 },
    buildings: [new Building(1, 'warehouse', 23, 23, false).toSave(), mill.toSave()],
    workers: [worker.toSave()],
    soldiers: [soldier.toSave()],
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

  it('migrates v1 savegames by adding an empty soldier list', () => {
    // Build a v1 save: no soldiers field, version 1.
    const { soldiers: _soldiers, ...rest } = sampleData();
    const v1 = { ...rest, saveVersion: 1 };
    const migrated = migrateSave(v1 as SaveData);
    expect(migrated).not.toBeNull();
    expect(migrated!.saveVersion).toBe(SAVE_VERSION);
    expect(migrated!.soldiers).toEqual([]);
    expect(migrated!.buildings).toHaveLength(2);
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
