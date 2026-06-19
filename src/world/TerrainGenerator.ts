import {
  TERRAIN_FOREST_CLUSTERS,
  TERRAIN_FOREST_CLUSTER_MAX,
  TERRAIN_FOREST_CLUSTER_MIN,
  TERRAIN_RIVER_WIDTH,
  TERRAIN_ROCK_CLUSTERS,
  TERRAIN_ROCK_CLUSTER_MAX,
  TERRAIN_ROCK_CLUSTER_MIN,
  TERRAIN_SAFE_RADIUS,
} from '../data/config';
import { IsoGrid, Terrain } from './IsoGrid';

/** Deterministic PRNG (mulberry32). The seed fully defines the terrain. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inSafeZone(grid: IsoGrid, x: number, y: number): boolean {
  const cx = Math.floor(grid.width / 2);
  const cy = Math.floor(grid.height / 2);
  return Math.abs(x - cx) <= TERRAIN_SAFE_RADIUS && Math.abs(y - cy) <= TERRAIN_SAFE_RADIUS;
}

/**
 * Fills the grid terrain from a seed: one winding river band plus a few
 * rock clusters. The area around the map center stays clear so the starting
 * warehouse always fits.
 */
export function generateTerrain(grid: IsoGrid, seed: number): void {
  const rng = createRng(seed);

  // River: vertical band winding along gy via two sine waves.
  const riverBaseX = Math.floor(grid.width * (0.15 + rng() * 0.2));
  const amp = 3 + rng() * 4;
  const freq = 0.08 + rng() * 0.08;
  const phase = rng() * Math.PI * 2;
  for (let gy = 0; gy < grid.height; gy++) {
    const center = riverBaseX + Math.sin(gy * freq + phase) * amp;
    for (let dx = 0; dx < TERRAIN_RIVER_WIDTH + 1; dx++) {
      const gx = Math.round(center) + dx;
      if (grid.inBounds(gx, gy) && !inSafeZone(grid, gx, gy)) {
        grid.setTerrain(gx, gy, Terrain.Water);
      }
    }
  }

  const blob = (startX: number, startY: number, size: number, terrain: Terrain): void => {
    let x = startX;
    let y = startY;
    for (let i = 0; i < size; i++) {
      if (grid.inBounds(x, y) && !inSafeZone(grid, x, y) && grid.terrainAt(x, y) === Terrain.Grass) {
        grid.setTerrain(x, y, terrain);
      }
      x += Math.floor(rng() * 3) - 1;
      y += Math.floor(rng() * 3) - 1;
    }
  };

  const clusterSize = (min: number, max: number): number =>
    min + Math.floor(rng() * (max - min + 1));

  // Rock clusters: random-walk blobs.
  for (let c = 0; c < TERRAIN_ROCK_CLUSTERS; c++) {
    blob(
      Math.floor(rng() * grid.width),
      Math.floor(rng() * grid.height),
      clusterSize(TERRAIN_ROCK_CLUSTER_MIN, TERRAIN_ROCK_CLUSTER_MAX),
      Terrain.Rock,
    );
  }

  // Forest clusters (lumberjacks must be built next to trees).
  for (let c = 0; c < TERRAIN_FOREST_CLUSTERS; c++) {
    blob(
      Math.floor(rng() * grid.width),
      Math.floor(rng() * grid.height),
      clusterSize(TERRAIN_FOREST_CLUSTER_MIN, TERRAIN_FOREST_CLUSTER_MAX),
      Terrain.Forest,
    );
  }

  // Guaranteed starter resources just outside the safe zone, on the side
  // away from the river, so the first lumberjack/quarry always have a spot.
  const cx = Math.floor(grid.width / 2);
  const cy = Math.floor(grid.height / 2);
  const ring = TERRAIN_SAFE_RADIUS + 2;
  blob(cx + ring, cy - 2, TERRAIN_FOREST_CLUSTER_MAX, Terrain.Forest);
  blob(cx + 2, cy + ring, TERRAIN_ROCK_CLUSTER_MAX, Terrain.Rock);

  seedOreDeposits(grid, rng);
}

/**
 * Ore veins (phase 20): the cores of rock clusters turn into ore — a rock
 * tile whose orthogonal neighbours are all rock/ore is deep enough to hold
 * a vein. Mines must be built next to ore and deplete it back to rock.
 * Only rock becomes ore (both blocked), so older saves keep loading.
 */
function seedOreDeposits(grid: IsoGrid, rng: () => number): void {
  const isHard = (x: number, y: number): boolean => {
    if (!grid.inBounds(x, y)) return false;
    const t = grid.terrainAt(x, y);
    return t === Terrain.Rock || t === Terrain.Ore;
  };
  const cores: { x: number; y: number }[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (
        grid.terrainAt(x, y) === Terrain.Rock &&
        isHard(x - 1, y) && isHard(x + 1, y) && isHard(x, y - 1) && isHard(x, y + 1)
      ) {
        cores.push({ x, y });
      }
    }
  }
  for (const c of cores) grid.setTerrain(c.x, c.y, Terrain.Ore);
  if (cores.length >= 8) return;
  // Sparse map: promote a few random rock tiles with at least two hard
  // neighbours so every map has mineable veins.
  const candidates: { x: number; y: number }[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.terrainAt(x, y) !== Terrain.Rock) continue;
      const n = [isHard(x - 1, y), isHard(x + 1, y), isHard(x, y - 1), isHard(x, y + 1)]
        .filter(Boolean).length;
      if (n >= 2) candidates.push({ x, y });
    }
  }
  for (let i = cores.length; i < 8 && candidates.length > 0; i++) {
    const pick = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
    grid.setTerrain(pick.x, pick.y, Terrain.Ore);
  }
}

/**
 * Mirror the west half onto the east half (duel maps): both players face
 * identical terrain. The given rects are forced to grass afterwards so
 * each side's castle has a guaranteed clear building site.
 */
export function mirrorTerrainEastWest(
  grid: IsoGrid,
  clearRects: { x: number; y: number; w: number; h: number }[] = [],
): void {
  const half = Math.floor(grid.width / 2);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < half; x++) {
      grid.setTerrain(grid.width - 1 - x, y, grid.terrainAt(x, y));
    }
  }
  for (const r of clearRects) {
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        if (grid.inBounds(r.x + dx, r.y + dy)) grid.setTerrain(r.x + dx, r.y + dy, Terrain.Grass);
      }
    }
  }
}
