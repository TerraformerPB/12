import { Graphics } from 'pixi.js';
import { TILE_H, TILE_W } from '../data/config';
import type { BuildingDef } from '../data/buildings';
import type { EnemyDef } from '../data/enemies';
import { Terrain } from '../world/IsoGrid';

/**
 * All placeholder vector art lives here. Phase 2+ swaps these factory
 * functions for sprite-atlas based views without touching game logic:
 * the renderer only calls these functions and positions the results.
 */

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

export const PALETTE = {
  background: 0x141821,
  grassA: 0x5d9c47,
  grassB: 0x569343,
  grassLine: 0x4c833b,
  rock: 0x787e8a,
  rockTop: 0x9298a4,
  water: 0x3a6fc4,
  waterDeep: 0x315ea8,
  ghostValid: 0x3ed35e,
  ghostInvalid: 0xe24a4a,
  selection: 0xffd966,
  workerBody: 0xf2e6c9,
  workerOutline: 0x4a3b28,
  soldierBody: 0xb5443c,
  soldierHelmet: 0xb9c0cc,
  soldierOutline: 0x3a1f1c,
  enemyBody: 0x47324d,
  enemyHorns: 0x1f1524,
  hpBack: 0x331111,
  hpFill: 0x57c454,
  projectile: 0xf5e9c8,
} as const;

/** Multiply an RGB color by a brightness factor. */
export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/** Diamond corner points of a single tile centered at (cx, cy). */
function diamond(cx: number, cy: number): number[] {
  return [cx, cy - HALF_H, cx + HALF_W, cy, cx, cy + HALF_H, cx - HALF_W, cy];
}

/** Draw one terrain tile into a (chunk) graphics object. */
export function drawTerrainTile(
  g: Graphics,
  cx: number,
  cy: number,
  terrain: Terrain,
  checker: boolean,
): void {
  switch (terrain) {
    case Terrain.Grass:
      g.poly(diamond(cx, cy))
        .fill(checker ? PALETTE.grassA : PALETTE.grassB)
        .stroke({ color: PALETTE.grassLine, width: 1, alpha: 0.35 });
      break;
    case Terrain.Water:
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.water : PALETTE.waterDeep);
      break;
    case Terrain.Rock: {
      g.poly(diamond(cx, cy)).fill(shade(PALETTE.rock, 0.8));
      // Small lump so rock reads as elevated.
      const lift = 7;
      g.poly([
        cx,
        cy - HALF_H / 2 - lift,
        cx + HALF_W / 2,
        cy - lift / 2,
        cx,
        cy + HALF_H / 2 - lift / 4,
        cx - HALF_W / 2,
        cy - lift / 2,
      ]).fill(PALETTE.rockTop);
      break;
    }
  }
}

/**
 * Footprint corner offsets relative to the anchor (center of top-left tile).
 * Order: north, east, south, west.
 */
export function footprintCorners(w: number, h: number): [number[], number[], number[], number[]] {
  const n = [0, -HALF_H];
  const e = [w * HALF_W, (w - 1) * HALF_H];
  const s = [(w - h) * HALF_W, (w + h - 1) * HALF_H];
  const wp = [-h * HALF_W, (h - 1) * HALF_H];
  return [n, e, s, wp];
}

export interface BlockOptions {
  /** Override color (ghost tinting). */
  colorOverride?: number;
  alpha?: number;
}

/**
 * Draw an extruded building block (placeholder for a sprite) into `g`,
 * anchored at the center of the footprint's top-left tile.
 */
export function drawBuildingBlock(
  g: Graphics,
  w: number,
  h: number,
  art: BuildingDef['art'],
  opts: BlockOptions = {},
): void {
  const color = opts.colorOverride ?? art.color;
  const alpha = opts.alpha ?? 1;
  const lift = art.height;
  const [n, e, s, wp] = footprintCorners(w, h);

  // Ground shadow under the block.
  g.poly([...n, ...e, ...s, ...wp]).fill({ color: 0x000000, alpha: 0.25 * alpha });
  // Left wall (west-south face).
  g.poly([wp[0], wp[1], s[0], s[1], s[0], s[1] - lift, wp[0], wp[1] - lift]).fill({
    color: shade(color, 0.72),
    alpha,
  });
  // Right wall (south-east face).
  g.poly([s[0], s[1], e[0], e[1], e[0], e[1] - lift, s[0], s[1] - lift]).fill({
    color: shade(color, 0.55),
    alpha,
  });
  // Roof.
  g.poly([n[0], n[1] - lift, e[0], e[1] - lift, s[0], s[1] - lift, wp[0], wp[1] - lift])
    .fill({ color: shade(color, 1.12), alpha });
}

/** Small health bar centered at (cx, cy); only drawn when damaged. */
export function drawHpBar(g: Graphics, cx: number, cy: number, width: number, ratio: number): void {
  if (ratio >= 1) return;
  const r = Math.max(0, ratio);
  g.rect(cx - width / 2, cy, width, 4).fill({ color: PALETTE.hpBack, alpha: 0.9 });
  g.rect(cx - width / 2, cy, width * r, 4).fill({ color: PALETTE.hpFill, alpha: 0.95 });
}

/** (Re)draw a placed building, with a health bar once damaged. */
export function drawBuildingView(
  g: Graphics,
  def: BuildingDef,
  w: number,
  h: number,
  hpRatio: number,
): void {
  g.clear();
  if (def.isRoad) {
    // Flat paving instead of an extruded block.
    const [rn, re, rs, rw] = footprintCorners(w, h);
    g.poly([...rn, ...re, ...rs, ...rw])
      .fill(def.art.color)
      .stroke({ color: shade(def.art.color, 0.75), width: 1.5, alpha: 0.8 });
    g.poly([rn[0], rn[1] + 5, re[0] - 10, re[1], rs[0], rs[1] - 5, rw[0] + 10, rw[1]]).fill({
      color: shade(def.art.color, 1.15),
      alpha: 0.5,
    });
    return;
  }
  drawBuildingBlock(g, w, h, def.art);
  // Bar floats above the roof, centered over the footprint.
  const [n, , s] = footprintCorners(w, h);
  const cx = (n[0] + s[0]) / 2;
  drawHpBar(g, cx, n[1] - def.art.height - 10, Math.max(28, w * 18), hpRatio);
}

/** Redraw the ghost preview into `g` (cleared first). */
export function drawGhost(g: Graphics, def: BuildingDef, w: number, h: number, valid: boolean): void {
  g.clear();
  const tint = valid ? PALETTE.ghostValid : PALETTE.ghostInvalid;
  const [n, e, s, wp] = footprintCorners(w, h);
  // Footprint marker on the ground.
  g.poly([...n, ...e, ...s, ...wp])
    .fill({ color: tint, alpha: 0.3 })
    .stroke({ color: tint, width: 2, alpha: 0.9 });
  drawBuildingBlock(g, w, h, def.art, { colorOverride: tint, alpha: 0.55 });
}

/** Redraw the selection outline for a footprint into `g`. */
export function drawSelection(g: Graphics, w: number, h: number): void {
  g.clear();
  const [n, e, s, wp] = footprintCorners(w, h);
  g.poly([...n, ...e, ...s, ...wp]).stroke({ color: PALETTE.selection, width: 3, alpha: 0.9 });
}

/** Draw a soldier placeholder (red body, steel helmet). */
export function drawSoldier(g: Graphics, selected: boolean, hpRatio = 1): void {
  g.clear();
  if (selected) {
    g.ellipse(0, 2, 12, 6).stroke({ color: PALETTE.selection, width: 2, alpha: 0.95 });
  }
  g.ellipse(0, 2, 7, 3.5).fill({ color: 0x000000, alpha: 0.3 });
  g.circle(0, -7, 6.5)
    .fill(PALETTE.soldierBody)
    .stroke({ color: PALETTE.soldierOutline, width: 1.5 });
  // Helmet cap.
  g.circle(0, -10, 4).fill(PALETTE.soldierHelmet);
  drawHpBar(g, 0, -20, 18, hpRatio);
}

/** Draw an enemy placeholder (dark body, horns); size/color from its def. */
export function drawEnemy(g: Graphics, art: EnemyDef['art'], hpRatio = 1): void {
  const r = art.radius;
  g.clear();
  g.ellipse(0, 2, r + 0.5, (r + 0.5) / 2).fill({ color: 0x000000, alpha: 0.3 });
  g.circle(0, -r, r).fill(art.color).stroke({ color: PALETTE.enemyHorns, width: 1.5 });
  // Horns.
  g.poly([-r + 1, -r - 4, -r - 2, -r - 10, -r + 3, -r - 6]).fill(PALETTE.enemyHorns);
  g.poly([r - 1, -r - 4, r + 2, -r - 10, r - 3, -r - 6]).fill(PALETTE.enemyHorns);
  drawHpBar(g, 0, -r * 2 - 9, 18, hpRatio);
}

/** Create the display object for a carrier. Redrawn when cargo changes. */
export function drawWorker(g: Graphics, carryingColor: number | null): void {
  g.clear();
  // Soft shadow.
  g.ellipse(0, 2, 7, 3.5).fill({ color: 0x000000, alpha: 0.3 });
  // Body.
  g.circle(0, -6, 6)
    .fill(PALETTE.workerBody)
    .stroke({ color: PALETTE.workerOutline, width: 1.5 });
  if (carryingColor !== null) {
    g.circle(0, -14, 4).fill(carryingColor).stroke({ color: 0x000000, width: 1, alpha: 0.4 });
  }
}
