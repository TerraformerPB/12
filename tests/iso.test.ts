import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W } from '../src/data/config';
import { gridToScreen, screenToGrid, screenToTile } from '../src/world/IsoGrid';

describe('iso coordinate conversion', () => {
  it('maps the origin tile to the world origin', () => {
    expect(gridToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('maps +gx to lower-right and +gy to lower-left', () => {
    expect(gridToScreen(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(gridToScreen(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
  });

  it('round-trips integer coordinates exactly', () => {
    for (let gx = -3; gx <= 10; gx += 1) {
      for (let gy = -3; gy <= 10; gy += 1) {
        const p = gridToScreen(gx, gy);
        const g = screenToGrid(p.x, p.y);
        expect(g.x).toBeCloseTo(gx, 10);
        expect(g.y).toBeCloseTo(gy, 10);
      }
    }
  });

  it('round-trips fractional positions (worker interpolation)', () => {
    const p = gridToScreen(2.25, 7.5);
    const g = screenToGrid(p.x, p.y);
    expect(g.x).toBeCloseTo(2.25, 10);
    expect(g.y).toBeCloseTo(7.5, 10);
  });

  it('screenToTile picks the tile whose diamond contains the point', () => {
    const center = gridToScreen(4, 6);
    expect(screenToTile(center.x, center.y)).toEqual({ x: 4, y: 6 });
    // Slightly off-center still inside the diamond.
    expect(screenToTile(center.x + TILE_W / 4 - 1, center.y)).toEqual({ x: 4, y: 6 });
    expect(screenToTile(center.x, center.y + TILE_H / 4)).toEqual({ x: 4, y: 6 });
    // Past the right corner → neighbouring tile.
    expect(screenToTile(center.x + TILE_W / 2 + 1, center.y + 1)).not.toEqual({ x: 4, y: 6 });
  });
});
