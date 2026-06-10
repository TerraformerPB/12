import { describe, expect, it } from 'vitest';
import { getDef } from '../src/data/buildings';
import { checkPlacement, rotatedFootprint } from '../src/systems/BuildSystem';
import { IsoGrid, Terrain } from '../src/world/IsoGrid';

function makeGrid(): IsoGrid {
  return new IsoGrid(12, 12); // all grass
}

describe('placement validation', () => {
  it('allows a building on free grass', () => {
    const grid = makeGrid();
    expect(checkPlacement(grid, getDef('mill'), 2, 2, false).ok).toBe(true);
  });

  it('rejects placement outside the map', () => {
    const grid = makeGrid();
    expect(checkPlacement(grid, getDef('mill'), 11, 11, false).ok).toBe(false);
    expect(checkPlacement(grid, getDef('mill'), -1, 0, false).ok).toBe(false);
  });

  it('rejects water and rock tiles', () => {
    const grid = makeGrid();
    grid.setTerrain(3, 2, Terrain.Water);
    expect(checkPlacement(grid, getDef('mill'), 2, 2, false).ok).toBe(false);
    grid.setTerrain(3, 2, Terrain.Rock);
    expect(checkPlacement(grid, getDef('mill'), 2, 2, false).ok).toBe(false);
  });

  it('rejects overlap with existing buildings', () => {
    const grid = makeGrid();
    grid.setOccupantRect(2, 2, 2, 2, 7);
    expect(checkPlacement(grid, getDef('mill'), 3, 3, false).ok).toBe(false);
    expect(checkPlacement(grid, getDef('mill'), 4, 4, false).ok).toBe(true);
  });

  it('requires the quarry to touch rock orthogonally', () => {
    const grid = makeGrid();
    const quarry = getDef('quarry');
    expect(checkPlacement(grid, quarry, 4, 4, false).ok).toBe(false);
    // Rock diagonal to the footprint does not count.
    grid.setTerrain(3, 3, Terrain.Rock);
    expect(checkPlacement(grid, quarry, 4, 4, false).ok).toBe(false);
    // Orthogonally adjacent rock does.
    grid.setTerrain(4, 3, Terrain.Rock);
    expect(checkPlacement(grid, quarry, 4, 4, false).ok).toBe(true);
  });

  it('requires the lumberjack to touch forest orthogonally', () => {
    const grid = makeGrid();
    const lumberjack = getDef('lumberjack');
    expect(checkPlacement(grid, lumberjack, 4, 4, false).ok).toBe(false);
    grid.setTerrain(3, 3, Terrain.Forest); // diagonal does not count
    expect(checkPlacement(grid, lumberjack, 4, 4, false).ok).toBe(false);
    grid.setTerrain(4, 3, Terrain.Forest);
    expect(checkPlacement(grid, lumberjack, 4, 4, false).ok).toBe(true);
  });

  it('places bridges only on water', () => {
    const grid = makeGrid();
    const bridge = getDef('bridge');
    expect(checkPlacement(grid, bridge, 4, 4, false).ok).toBe(false);
    grid.setTerrain(4, 4, Terrain.Water);
    expect(checkPlacement(grid, bridge, 4, 4, false).ok).toBe(true);
    // Walkable for own units once placed, despite the water underneath.
    grid.setOccupantRect(4, 4, 1, 1, 9, 2); // PassMode.Road
    expect(isFinite(grid.moveCost(4, 4))).toBe(true);
  });

  it('applies the rotated footprint', () => {
    const def = {
      ...getDef('mill'),
      footprint: { w: 3, h: 1 },
    };
    const grid = makeGrid();
    grid.setTerrain(5, 3, Terrain.Water); // blocks the unrotated 3×1 strip
    expect(rotatedFootprint(def, true)).toEqual({ w: 1, h: 3 });
    expect(checkPlacement(grid, def, 3, 3, false).ok).toBe(false);
    expect(checkPlacement(grid, def, 3, 3, true).ok).toBe(true);
  });
});
