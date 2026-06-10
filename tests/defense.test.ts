import { describe, expect, it } from 'vitest';
import { getDef } from '../src/data/buildings';
import { checkPlacement } from '../src/systems/BuildSystem';
import { IsoGrid } from '../src/world/IsoGrid';
import { findPath } from '../src/world/Pathfinding';

/** A wall line across x=0..w-1 at row y, with an optional gate. */
function buildWallLine(grid: IsoGrid, y: number, gateX: number | null): void {
  let id = 100;
  for (let x = 0; x < grid.width; x++) {
    const isGate = x === gateX;
    grid.setOccupantRect(x, y, 1, 1, id++, isGate);
  }
}

describe('walls and gates', () => {
  it('a wall line blocks pathfinding completely', () => {
    const grid = new IsoGrid(9, 9);
    buildWallLine(grid, 4, null);
    expect(findPath(grid, { x: 4, y: 0 }, [{ x: 4, y: 8 }])).toBeNull();
  });

  it('a gate opens exactly one passage through the wall', () => {
    const grid = new IsoGrid(9, 9);
    buildWallLine(grid, 4, 6);
    const path = findPath(grid, { x: 4, y: 0 }, [{ x: 4, y: 8 }]);
    expect(path).not.toBeNull();
    const crossing = path!.find((p) => p.y === 4);
    expect(crossing).toEqual({ x: 6, y: 4 });
  });

  it('gate tiles stay unbuildable even though they are walkable', () => {
    const grid = new IsoGrid(9, 9);
    grid.setOccupantRect(3, 3, 1, 1, 55, true); // a gate
    expect(isFinite(grid.moveCost(3, 3))).toBe(true);
    expect(grid.isFree(3, 3)).toBe(false);
    expect(checkPlacement(grid, getDef('wall'), 3, 3, false).ok).toBe(false);
  });

  it('demolishing a gate clears the passable flag', () => {
    const grid = new IsoGrid(9, 9);
    grid.setOccupantRect(3, 3, 1, 1, 55, true);
    grid.setOccupantRect(3, 3, 1, 1, 0, false);
    expect(grid.isFree(3, 3)).toBe(true);
    expect(grid.moveCost(3, 3)).toBe(1);
  });

  it('defense buildings carry valid definitions', () => {
    for (const id of ['wall', 'gate', 'tower', 'barracks'] as const) {
      const def = getDef(id);
      expect(def.category).toBe('defense');
      expect(def.footprint.w).toBeGreaterThan(0);
    }
    expect(getDef('gate').passable).toBe(true);
    expect(getDef('wall').passable).toBeUndefined();
    expect(getDef('barracks').recruitsSoldiers).toBe(true);
  });
});
