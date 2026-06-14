import { describe, expect, it } from 'vitest';
import { duelClearRects, duelNodes } from '../src/data/duel';
import { MAP_H, MAP_W } from '../src/data/config';
import { IsoGrid } from '../src/world/IsoGrid';
import { findPath } from '../src/world/Pathfinding';
import { generateTerrain, mirrorTerrainEastWest } from '../src/world/TerrainGenerator';

describe('duel map connectivity', () => {
  it('always leaves a route between the two castles, whatever the seed', () => {
    const cy = Math.floor(MAP_H / 2);
    const nodes = duelNodes(MAP_W, MAP_H);
    for (let i = 0; i < 30; i++) {
      const seed = (i * 2654435761) >>> 0;
      const grid = new IsoGrid(MAP_W, MAP_H);
      generateTerrain(grid, seed);
      mirrorTerrainEastWest(grid, duelClearRects(MAP_W, MAP_H));
      // Castle front (west) to castle front (east) — melee approach route.
      const path = findPath(grid, { x: 9, y: cy }, [{ x: MAP_W - 10, y: cy }]);
      expect(path, `seed ${seed} has no route between the castles`).not.toBeNull();
      // Depot lanes are reachable too.
      for (const n of nodes) {
        expect(
          findPath(grid, { x: 9, y: cy }, [{ x: n.x, y: n.y }]),
          `seed ${seed} depot y=${n.y}`,
        ).not.toBeNull();
      }
    }
  });
});
