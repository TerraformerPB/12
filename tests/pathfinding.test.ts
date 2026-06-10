import { describe, expect, it } from 'vitest';
import { findPath, type PathGrid } from '../src/world/Pathfinding';

/** Builds a grid from an ASCII map: '.' walkable, '#' blocked. */
function gridFrom(rows: string[]): PathGrid {
  return {
    width: rows[0].length,
    height: rows.length,
    moveCost: (x, y) => (rows[y]?.[x] === '.' ? 1 : Infinity),
  };
}

describe('A* pathfinding', () => {
  it('finds a straight path', () => {
    const grid = gridFrom(['.....', '.....', '.....']);
    const path = findPath(grid, { x: 0, y: 1 }, [{ x: 4, y: 1 }]);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 1 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 1 });
    expect(path!.length).toBe(5);
  });

  it('walks around obstacles', () => {
    const grid = gridFrom(['.....', '.###.', '.....']);
    const path = findPath(grid, { x: 0, y: 1 }, [{ x: 4, y: 1 }]);
    expect(path).not.toBeNull();
    for (const step of path!) {
      expect(grid.moveCost(step.x, step.y)).toBe(1);
    }
  });

  it('returns null when the goal is unreachable', () => {
    const grid = gridFrom(['..#..', '..#..', '..#..']);
    expect(findPath(grid, { x: 0, y: 1 }, [{ x: 4, y: 1 }])).toBeNull();
  });

  it('reaches the nearest of multiple goals', () => {
    const grid = gridFrom(['.....', '.....', '.....']);
    const path = findPath(
      grid,
      { x: 0, y: 0 },
      [
        { x: 4, y: 2 },
        { x: 1, y: 0 },
      ],
    );
    expect(path![path!.length - 1]).toEqual({ x: 1, y: 0 });
  });

  it('returns the start tile when already standing on a goal', () => {
    const grid = gridFrom(['...']);
    expect(findPath(grid, { x: 1, y: 0 }, [{ x: 1, y: 0 }])).toEqual([{ x: 1, y: 0 }]);
  });

  it('never cuts corners diagonally', () => {
    const grid = gridFrom(['.#.', '...']);
    const path = findPath(grid, { x: 0, y: 0 }, [{ x: 2, y: 0 }])!;
    // Direct diagonal hops past the blocked tile are forbidden, so the path
    // must drop to row 1 and come back up: strictly longer than 3 nodes.
    expect(path.length).toBeGreaterThan(3);
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      if (dx !== 0 && dy !== 0) {
        expect(grid.moveCost(path[i - 1].x + dx, path[i - 1].y)).toBe(1);
        expect(grid.moveCost(path[i - 1].x, path[i - 1].y + dy)).toBe(1);
      }
    }
  });

  it('respects the cost map (cheaper tiles win)', () => {
    // Road row (cost 0.3) below a normal row: the path should detour onto it.
    const cost = (x: number, y: number): number => {
      if (y < 0 || y > 1 || x < 0 || x > 6) return Infinity;
      return y === 1 ? 0.3 : 1;
    };
    const grid: PathGrid = { width: 7, height: 2, moveCost: cost };
    const path = findPath(grid, { x: 0, y: 0 }, [{ x: 6, y: 0 }])!;
    expect(path.some((p) => p.y === 1)).toBe(true);
  });
});
