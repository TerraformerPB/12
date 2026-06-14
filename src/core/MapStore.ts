import { MAP_H, MAP_W } from '../data/config';
import { Terrain } from '../world/IsoGrid';

/**
 * Storage and (de)serialisation for player-made maps (the map editor).
 * A map is just a terrain grid; buildings/units are added when it is played.
 * Terrain is run-length encoded into a compact string so a whole 64×64 map
 * is a few hundred bytes in localStorage.
 */

export interface CustomMap {
  name: string;
  width: number;
  height: number;
  /** width*height terrain values (see Terrain enum). */
  terrain: number[];
}

const STORAGE_KEY = 'burgspiel.maps';
const VALID = new Set<number>(Object.values(Terrain));

/** Best-effort localStorage handle (tests/SSR may not have one). */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Run-length encode a terrain array into "WxH:v.count,v.count,…". */
export function encodeMap(width: number, height: number, terrain: number[]): string {
  const runs: string[] = [];
  let i = 0;
  while (i < terrain.length) {
    const v = terrain[i] & 0xff;
    let n = 1;
    while (i + n < terrain.length && (terrain[i + n] & 0xff) === v) n++;
    runs.push(`${v}.${n}`);
    i += n;
  }
  return `${width}x${height}:${runs.join(',')}`;
}

/** Inverse of encodeMap; returns null on malformed input. */
export function decodeMap(code: string): { width: number; height: number; terrain: number[] } | null {
  const head = code.indexOf(':');
  if (head < 0) return null;
  const dims = code.slice(0, head).split('x');
  const width = Number(dims[0]);
  const height = Number(dims[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const terrain: number[] = [];
  const body = code.slice(head + 1);
  if (body.length > 0) {
    for (const run of body.split(',')) {
      const [vs, ns] = run.split('.');
      const v = Number(vs);
      const n = Number(ns);
      if (!Number.isInteger(v) || !Number.isInteger(n) || n <= 0 || !VALID.has(v)) return null;
      for (let k = 0; k < n; k++) terrain.push(v);
    }
  }
  if (terrain.length !== width * height) return null;
  return { width, height, terrain };
}

/** A fresh all-grass terrain array for the default map size. */
export function blankTerrain(width = MAP_W, height = MAP_H): number[] {
  return new Array<number>(width * height).fill(Terrain.Grass);
}

interface StoredMap {
  name: string;
  code: string;
  updatedAt: number;
}

function readAll(): StoredMap[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredMap[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(maps: StoredMap[]): void {
  store()?.setItem(STORAGE_KEY, JSON.stringify(maps));
}

/** Saved map names, most recently updated first. */
export function listMaps(): string[] {
  return readAll()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((m) => m.name);
}

/** Save (or overwrite) a map under a trimmed name. Returns false if invalid. */
export function saveMap(name: string, width: number, height: number, terrain: number[]): boolean {
  const clean = name.trim().slice(0, 40);
  if (!clean || terrain.length !== width * height) return false;
  const maps = readAll().filter((m) => m.name.toLowerCase() !== clean.toLowerCase());
  maps.push({ name: clean, code: encodeMap(width, height, terrain), updatedAt: Date.now() });
  writeAll(maps);
  return true;
}

export function loadMap(name: string): CustomMap | null {
  const entry = readAll().find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
  if (!entry) return null;
  const decoded = decodeMap(entry.code);
  if (!decoded) return null;
  return { name: entry.name, ...decoded };
}

export function deleteMap(name: string): void {
  writeAll(readAll().filter((m) => m.name.toLowerCase() !== name.trim().toLowerCase()));
}
