import { describe, expect, it } from 'vitest';
import { duelClearRects } from '../src/data/duel';
import { IsoGrid } from '../src/world/IsoGrid';
import { findPath } from '../src/world/Pathfinding';
import { generateTerrain, mirrorTerrainEastWest } from '../src/world/TerrainGenerator';

describe('duel map connectivity', () => {
  it('always leaves a route between the two castles, whatever the seed', () => {
    const cy = 24;
    for (let i = 0; i < 30; i++) {
      const seed = (i * 2654435761) >>> 0;
      const grid = new IsoGrid(48, 48);
      generateTerrain(grid, seed);
      mirrorTerrainEastWest(grid, duelClearRects(48, 48));
      // Castle front (west) to castle front (east) — melee approach route.
      const path = findPath(grid, { x: 9, y: cy }, [{ x: 38, y: cy }]);
      expect(path, `seed ${seed} has no route between the castles`).not.toBeNull();
      // Depot lanes are reachable too.
      for (const y of [17, 31]) {
        expect(findPath(grid, { x: 9, y: cy }, [{ x: 21, y }]), `seed ${seed} depot y=${y}`).not.toBeNull();
      }
    }
  });
});
