import { beforeEach, describe, expect, it } from 'vitest';
import {
  blankTerrain,
  decodeMap,
  deleteMap,
  encodeMap,
  exportMapCode,
  importMapCode,
  listMaps,
  loadMap,
  saveMap,
} from '../src/core/MapStore';
import { MAP_H, MAP_W } from '../src/data/config';
import { Terrain } from '../src/world/IsoGrid';

/** Minimal in-memory localStorage for the persistence tests. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
});

describe('map encode/decode', () => {
  it('round-trips an arbitrary terrain grid', () => {
    const terrain = [
      Terrain.Grass, Terrain.Grass, Terrain.Water, Terrain.Forest,
      Terrain.Rock, Terrain.Ore, Terrain.Ore, Terrain.Grass,
    ];
    const code = encodeMap(4, 2, terrain);
    const back = decodeMap(code);
    expect(back).not.toBeNull();
    expect(back!.width).toBe(4);
    expect(back!.height).toBe(2);
    expect(back!.terrain).toEqual(terrain);
  });

  it('compresses runs (RLE keeps a flat map tiny)', () => {
    const code = encodeMap(MAP_W, MAP_H, blankTerrain());
    // One run for the whole map.
    expect(code).toBe(`${MAP_W}x${MAP_H}:0.${MAP_W * MAP_H}`);
  });

  it('rejects malformed or wrong-sized codes', () => {
    expect(decodeMap('garbage')).toBeNull();
    expect(decodeMap('4x2:0.3')).toBeNull(); // too few tiles
    expect(decodeMap('2x2:99.4')).toBeNull(); // invalid terrain id
  });

  it('blankTerrain is all grass at the right size', () => {
    const t = blankTerrain();
    expect(t.length).toBe(MAP_W * MAP_H);
    expect(t.every((v) => v === Terrain.Grass)).toBe(true);
  });
});

describe('map persistence', () => {
  it('saves, lists, loads and deletes named maps', () => {
    const terrain = blankTerrain();
    terrain[0] = Terrain.Water;
    expect(saveMap('Meine Burg', MAP_W, MAP_H, terrain)).toBe(true);
    expect(listMaps()).toContain('Meine Burg');
    const loaded = loadMap('Meine Burg');
    expect(loaded?.terrain[0]).toBe(Terrain.Water);
    expect(loaded?.terrain.length).toBe(MAP_W * MAP_H);
    deleteMap('Meine Burg');
    expect(listMaps()).not.toContain('Meine Burg');
  });

  it('overwrites a map of the same name (case-insensitive) instead of duplicating', () => {
    saveMap('Test', MAP_W, MAP_H, blankTerrain());
    const t2 = blankTerrain();
    t2[5] = Terrain.Rock;
    saveMap('test', MAP_W, MAP_H, t2);
    expect(listMaps().filter((n) => n.toLowerCase() === 'test')).toHaveLength(1);
    expect(loadMap('Test')?.terrain[5]).toBe(Terrain.Rock);
  });

  it('refuses empty names and size mismatches', () => {
    expect(saveMap('   ', MAP_W, MAP_H, blankTerrain())).toBe(false);
    expect(saveMap('Bad', MAP_W, MAP_H, [Terrain.Grass])).toBe(false);
  });
});

describe('shareable map codes', () => {
  it('round-trips through an export/import code', () => {
    const terrain = blankTerrain();
    terrain[10] = Terrain.Water;
    terrain[20] = Terrain.Ore;
    const code = exportMapCode(MAP_W, MAP_H, terrain);
    expect(code.startsWith('BURGMAP1.')).toBe(true);
    const back = importMapCode(code);
    expect(back?.terrain).toEqual(terrain);
  });

  it('rejects codes without the versioned prefix or with bad payloads', () => {
    expect(importMapCode('not a code')).toBeNull();
    expect(importMapCode(encodeMap(MAP_W, MAP_H, blankTerrain()))).toBeNull(); // no prefix
    expect(importMapCode('BURGMAP1.garbage')).toBeNull();
  });
});
