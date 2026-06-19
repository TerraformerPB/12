import { MAP_H, MAP_W } from '../data/config';
import { ENEMY_DEFS } from '../data/enemies';
import { Terrain } from '../world/IsoGrid';

/** An enemy NPC placed in the editor. */
export interface EditorEnemy {
  x: number;
  y: number;
  defId: string;
}

const ENEMY_VALID = new Set<string>(Object.keys(ENEMY_DEFS));

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
  /** Pre-placed enemy NPCs. */
  enemies: EditorEnemy[];
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

/**
 * Run-length encode terrain into "WxH:v.count,…", optionally followed by an
 * enemy section "|defId,x,y;defId,x,y" (omitted when there are no enemies, so
 * old codes stay byte-for-byte identical).
 */
export function encodeMap(
  width: number,
  height: number,
  terrain: number[],
  enemies: EditorEnemy[] = [],
): string {
  const runs: string[] = [];
  let i = 0;
  while (i < terrain.length) {
    const v = terrain[i] & 0xff;
    let n = 1;
    while (i + n < terrain.length && (terrain[i + n] & 0xff) === v) n++;
    runs.push(`${v}.${n}`);
    i += n;
  }
  let code = `${width}x${height}:${runs.join(',')}`;
  if (enemies.length > 0) {
    code += '|' + enemies.map((e) => `${e.defId},${Math.round(e.x)},${Math.round(e.y)}`).join(';');
  }
  return code;
}

/** Inverse of encodeMap; returns null on malformed input. */
export function decodeMap(
  code: string,
): { width: number; height: number; terrain: number[]; enemies: EditorEnemy[] } | null {
  const [mapPart, enemyPart] = code.split('|');
  const head = mapPart.indexOf(':');
  if (head < 0) return null;
  const dims = mapPart.slice(0, head).split('x');
  const width = Number(dims[0]);
  const height = Number(dims[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const terrain: number[] = [];
  const body = mapPart.slice(head + 1);
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
  const enemies: EditorEnemy[] = [];
  if (enemyPart) {
    for (const tok of enemyPart.split(';')) {
      if (!tok) continue;
      const [defId, xs, ys] = tok.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (!ENEMY_VALID.has(defId) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
      enemies.push({ defId, x, y });
    }
  }
  return { width, height, terrain, enemies };
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
export function saveMap(
  name: string,
  width: number,
  height: number,
  terrain: number[],
  enemies: EditorEnemy[] = [],
): boolean {
  const clean = name.trim().slice(0, 40);
  if (!clean || terrain.length !== width * height) return false;
  const maps = readAll().filter((m) => m.name.toLowerCase() !== clean.toLowerCase());
  maps.push({ name: clean, code: encodeMap(width, height, terrain, enemies), updatedAt: Date.now() });
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

/** Versioned prefix for shareable map codes (copy/paste between players). */
const SHARE_PREFIX = 'BURGMAP1.';

/** A portable, shareable code for a terrain grid (with enemies). */
export function exportMapCode(
  width: number,
  height: number,
  terrain: number[],
  enemies: EditorEnemy[] = [],
): string {
  return SHARE_PREFIX + encodeMap(width, height, terrain, enemies);
}

/** Parse a shareable code back into a terrain grid; null if invalid. */
export function importMapCode(
  code: string,
): { width: number; height: number; terrain: number[]; enemies: EditorEnemy[] } | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) return null;
  return decodeMap(trimmed.slice(SHARE_PREFIX.length));
}
