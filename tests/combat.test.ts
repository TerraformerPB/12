import { describe, expect, it } from 'vitest';
import {
  ENEMY_BREACH_COST,
  WAVE_BASE_COUNT,
  WAVE_COUNT_GROWTH,
  WAVE_MAX_COUNT,
} from '../src/data/config';
import { waveSize } from '../src/systems/WaveSystem';
import { getEnemyDef, waveComposition } from '../src/data/enemies';
import { IsoGrid, PassMode } from '../src/world/IsoGrid';
import { findPath } from '../src/world/Pathfinding';

function breachGrid(grid: IsoGrid): {
  width: number;
  height: number;
  moveCost: (x: number, y: number) => number;
} {
  return { width: grid.width, height: grid.height, moveCost: grid.enemyMoveCost(ENEMY_BREACH_COST) };
}

describe('enemy breach routing', () => {
  it('treats gates as blocked for enemies (high cost like walls)', () => {
    const grid = new IsoGrid(5, 5);
    grid.setOccupantRect(2, 2, 1, 1, 9, PassMode.Gate);
    expect(grid.moveCost(2, 2)).toBe(1); // own units pass
    expect(grid.enemyMoveCost(ENEMY_BREACH_COST)(2, 2)).toBe(ENEMY_BREACH_COST);
  });

  it('routes around walls when an open path exists', () => {
    const grid = new IsoGrid(9, 9);
    // Wall line with one open tile at x=8 (no gate, just unbuilt).
    for (let x = 0; x < 8; x++) grid.setOccupantRect(x, 4, 1, 1, 100 + x);
    const path = findPath(breachGrid(grid), { x: 4, y: 0 }, [{ x: 4, y: 8 }])!;
    expect(path).not.toBeNull();
    // The crossing of row 4 must use the open tile, not a wall tile.
    const crossing = path.find((p) => p.y === 4)!;
    expect(crossing.x).toBe(8);
  });

  it('plans straight through the cheapest wall when fully enclosed', () => {
    const grid = new IsoGrid(9, 9);
    for (let x = 0; x < 9; x++) grid.setOccupantRect(x, 4, 1, 1, 100 + x);
    const path = findPath(breachGrid(grid), { x: 4, y: 0 }, [{ x: 4, y: 8 }])!;
    expect(path).not.toBeNull();
    // Path contains exactly one wall tile — the breach point.
    const wallTiles = path.filter((p) => grid.occupantAt(p.x, p.y) !== 0);
    expect(wallTiles).toHaveLength(1);
  });
});

describe('roads', () => {
  it('are cheaper for own units and open ground for enemies', () => {
    const grid = new IsoGrid(5, 5);
    grid.setOccupantRect(2, 2, 1, 1, 7, PassMode.Road);
    expect(grid.moveCost(2, 2)).toBeLessThan(1);
    expect(grid.speedFactorAt(2, 2)).toBeGreaterThan(1);
    expect(grid.enemyMoveCost(ENEMY_BREACH_COST)(2, 2)).toBe(1);
    expect(grid.isFree(2, 2)).toBe(false); // still not buildable
  });

  it('attract worker paths along the cheap tiles', () => {
    const grid = new IsoGrid(7, 3);
    // Road row at y=2 parallel to the direct route at y=1.
    for (let x = 0; x < 7; x++) grid.setOccupantRect(x, 2, 1, 1, 50 + x, PassMode.Road);
    const path = findPath(grid, { x: 0, y: 1 }, [{ x: 6, y: 1 }])!;
    expect(path.some((p) => p.y === 2)).toBe(true);
  });
});

describe('wave composition', () => {
  it('adds skirmishers from wave 4 with a range stat', () => {
    const w3 = waveComposition(3, 6).map((p) => p.defId);
    const w4 = waveComposition(4, 8).map((p) => p.defId);
    expect(w3).not.toContain('skirmisher');
    expect(w4).toContain('skirmisher');
    expect(getEnemyDef('skirmisher').range).toBeGreaterThan(1);
  });
});

describe('wave scaling', () => {
  it('grows linearly and respects the cap', () => {
    expect(waveSize(1)).toBe(WAVE_BASE_COUNT);
    expect(waveSize(2)).toBe(WAVE_BASE_COUNT + WAVE_COUNT_GROWTH);
    expect(waveSize(999)).toBe(WAVE_MAX_COUNT);
  });
});
