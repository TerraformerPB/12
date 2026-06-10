import { MAP_H, MAP_W, ROAD_MOVE_COST, TILE_H, TILE_W } from '../data/config';

/**
 * Coordinate conventions
 * ----------------------
 * Grid coordinates (gx, gy) are integer tile indices. On screen, the +gx axis
 * points to the lower-right and the +gy axis to the lower-left (classic
 * 2:1 isometric diamond).
 *
 * World coordinates are pixels in the un-zoomed world space. The world origin
 * (0, 0) is the CENTER of tile (0, 0). Each tile is a diamond of
 * TILE_W × TILE_H pixels around its center.
 *
 * Depth sorting: zIndex of an object standing on tile (gx, gy) is gx + gy.
 * Buildings with a footprint larger than 1×1 sort by their front corner:
 * (gx + w - 1) + (gy + h - 1).
 */

export interface Point {
  x: number;
  y: number;
}

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

/** Center of tile (gx, gy) in world pixels. Pure function. */
export function gridToScreen(gx: number, gy: number): Point {
  return {
    x: (gx - gy) * HALF_W,
    y: (gx + gy) * HALF_H,
  };
}

/** Inverse of gridToScreen; returns fractional grid coordinates. Pure function. */
export function screenToGrid(sx: number, sy: number): Point {
  const a = sx / HALF_W;
  const b = sy / HALF_H;
  return {
    x: (a + b) / 2,
    y: (b - a) / 2,
  };
}

/** The integer tile containing the world point (sx, sy). */
export function screenToTile(sx: number, sy: number): Point {
  const g = screenToGrid(sx, sy);
  return { x: Math.round(g.x), y: Math.round(g.y) };
}

// --- Terrain -----------------------------------------------------------------

export const Terrain = {
  Grass: 0,
  Rock: 1,
  Water: 2,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const NO_OCCUPANT = 0;

/** How an occupied tile treats walking units. */
export const PassMode = {
  /** Solid building: nobody walks through. */
  None: 0,
  /** Gate: own units pass, enemies must breach. */
  Gate: 1,
  /** Road: everyone passes; own units move cheaper/faster. */
  Road: 2,
} as const;
export type PassMode = (typeof PassMode)[keyof typeof PassMode];

/**
 * Tile data for the whole map: terrain plus building occupancy.
 * Pure data + queries; rendering lives elsewhere.
 */
export class IsoGrid {
  readonly width: number;
  readonly height: number;
  /** Cheapest tile cost (roads) — keeps the A* heuristic admissible. */
  readonly minMoveCost = ROAD_MOVE_COST;
  private terrain: Uint8Array;
  /** Building id occupying each tile, NO_OCCUPANT (0) if free. */
  private occupant: Int32Array;
  /** PassMode of the occupant on each tile. */
  private passable: Uint8Array;

  constructor(width: number = MAP_W, height: number = MAP_H) {
    this.width = width;
    this.height = height;
    this.terrain = new Uint8Array(width * height); // all grass
    this.occupant = new Int32Array(width * height);
    this.passable = new Uint8Array(width * height);
  }

  inBounds(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
  }

  private idx(gx: number, gy: number): number {
    return gy * this.width + gx;
  }

  terrainAt(gx: number, gy: number): Terrain {
    return this.terrain[this.idx(gx, gy)] as Terrain;
  }

  setTerrain(gx: number, gy: number, t: Terrain): void {
    this.terrain[this.idx(gx, gy)] = t;
  }

  occupantAt(gx: number, gy: number): number {
    return this.occupant[this.idx(gx, gy)];
  }

  setOccupantRect(
    gx: number,
    gy: number,
    w: number,
    h: number,
    id: number,
    pass: PassMode = PassMode.None,
  ): void {
    for (let y = gy; y < gy + h; y++) {
      for (let x = gx; x < gx + w; x++) {
        this.occupant[this.idx(x, y)] = id;
        this.passable[this.idx(x, y)] = id !== NO_OCCUPANT ? pass : PassMode.None;
      }
    }
  }

  isRoadAt(gx: number, gy: number): boolean {
    return this.inBounds(gx, gy) && this.passable[this.idx(gx, gy)] === PassMode.Road;
  }

  /** Buildable: in bounds, grass, no building. */
  isFree(gx: number, gy: number): boolean {
    return (
      this.inBounds(gx, gy) &&
      this.terrainAt(gx, gy) === Terrain.Grass &&
      this.occupantAt(gx, gy) === NO_OCCUPANT
    );
  }

  /**
   * Movement cost for OWN units entering a tile; Infinity = not walkable.
   * Gates cost like open ground, roads are cheaper (ROAD_MOVE_COST).
   */
  moveCost(gx: number, gy: number): number {
    if (!this.inBounds(gx, gy) || this.terrainAt(gx, gy) !== Terrain.Grass) return Infinity;
    if (this.occupant[this.idx(gx, gy)] === NO_OCCUPANT) return 1;
    switch (this.passable[this.idx(gx, gy)] as PassMode) {
      case PassMode.Road:
        return ROAD_MOVE_COST;
      case PassMode.Gate:
        return 1;
      case PassMode.None:
        return Infinity;
    }
  }

  /**
   * Movement cost for ENEMIES: roads are open ground, gates do NOT let
   * them through, and any other building tile is "walkable" at a high
   * virtual cost — the resulting path runs through the cheapest breach
   * point, and the enemy attacks the blocking building when it gets there.
   */
  enemyMoveCost(breachCost: number): (gx: number, gy: number) => number {
    return (gx, gy) => {
      if (!this.inBounds(gx, gy) || this.terrainAt(gx, gy) !== Terrain.Grass) return Infinity;
      if (this.occupant[this.idx(gx, gy)] === NO_OCCUPANT) return 1;
      return this.passable[this.idx(gx, gy)] === PassMode.Road ? 1 : breachCost;
    };
  }
}
