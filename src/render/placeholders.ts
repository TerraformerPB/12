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
  treeDark: 0x2e5d2a,
  treeLight: 0x3f7a36,
  trunk: 0x5a4026,
  skin: 0xe8c39a,
  flag: 0xc23b3b,
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

/** Cheap deterministic per-tile hash for scattering decorations. */
function tileHash(gx: number, gy: number): number {
  return (((gx * 73856093) ^ (gy * 19349663)) >>> 0) % 997;
}

/** Draw one terrain tile into a (chunk) graphics object. */
export function drawTerrainTile(
  g: Graphics,
  cx: number,
  cy: number,
  terrain: Terrain,
  checker: boolean,
  gx = 0,
  gy = 0,
): void {
  const hash = tileHash(gx, gy);
  switch (terrain) {
    case Terrain.Grass: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.grassA : PALETTE.grassB);
      // Atmosphere: scattered flowers, bushes and pebbles.
      const ox = ((hash % 13) - 6) * 1.6;
      const oy = ((hash % 7) - 3) * 1.4;
      if (hash % 23 === 0) {
        g.circle(cx + ox, cy + oy, 1.6).fill(0xf2e9b0);
        g.circle(cx + ox + 4, cy + oy + 2, 1.3).fill(0xe8a8b8);
      } else if (hash % 19 === 0) {
        g.ellipse(cx + ox, cy + oy, 4.5, 3).fill(PALETTE.treeDark);
        g.ellipse(cx + ox - 3, cy + oy + 1.5, 3, 2).fill(PALETTE.treeLight);
      } else if (hash % 31 === 0) {
        g.circle(cx + ox, cy + oy, 2).fill(shade(PALETTE.rock, 1.1));
        g.circle(cx + ox + 3.5, cy + oy + 1.5, 1.4).fill(PALETTE.rock);
      }
      break;
    }
    case Terrain.Water: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.water : PALETTE.waterDeep);
      // Light streaks suggest current (fills are cheaper than strokes).
      if (hash % 5 < 2) {
        const sy = cy - 4 + (hash % 9);
        g.rect(cx - 12 + (hash % 6), sy, 16 + (hash % 8), 1.2).fill({
          color: 0x7ba6e0,
          alpha: 0.5,
        });
      }
      break;
    }
    case Terrain.Forest: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.grassA : PALETTE.grassB);
      // Two stylized firs per tile (offset for variety via checker).
      const tree = (tx: number, ty: number, s: number): void => {
        g.rect(tx - 1.5 * s, ty - 2 * s, 3 * s, 4 * s).fill(PALETTE.trunk);
        g.poly([tx, ty - 16 * s, tx + 7 * s, ty - 2 * s, tx - 7 * s, ty - 2 * s]).fill(
          checker ? PALETTE.treeDark : PALETTE.treeLight,
        );
        g.poly([tx, ty - 20 * s, tx + 5 * s, ty - 9 * s, tx - 5 * s, ty - 9 * s]).fill(
          checker ? PALETTE.treeLight : PALETTE.treeDark,
        );
      };
      if (checker) {
        tree(cx - 10, cy + 2, 0.9);
        tree(cx + 8, cy + 6, 1.1);
      } else {
        tree(cx + 9, cy + 1, 1.0);
        tree(cx - 7, cy + 7, 0.8);
      }
      break;
    }
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
    case Terrain.Ore: {
      // Rock lump with glinting ore speckles so veins stand out on the map.
      g.poly(diamond(cx, cy)).fill(shade(PALETTE.rock, 0.7));
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
      ]).fill(shade(PALETTE.rockTop, 0.85));
      for (const [dx, dy] of [[-8, -6], [5, -9], [-2, -2], [9, -3], [-11, 1]] as const) {
        g.circle(cx + dx, cy + dy - lift / 2, 1.7).fill(0xe3b341);
      }
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

  if (lift <= 6 || opts.colorOverride !== undefined) return; // ghosts/flat stay plain

  const lerp = (a: number[], b2: number[], t: number): [number, number] => [
    a[0] + (b2[0] - a[0]) * t,
    a[1] + (b2[1] - a[1]) * t,
  ];
  if (art.material === 'stone') {
    // Mortar courses on both wall faces.
    for (const tt of [0.33, 0.66]) {
      g.moveTo(wp[0], wp[1] - lift * tt)
        .lineTo(s[0], s[1] - lift * tt)
        .lineTo(e[0], e[1] - lift * tt)
        .stroke({ color: shade(color, 0.45), width: 1, alpha: 0.55 * alpha });
    }
    for (const tt of [0.25, 0.5, 0.75]) {
      const [bx, by] = lerp(s, e, tt);
      g.moveTo(bx, by).lineTo(bx, by - lift * 0.33).stroke({
        color: shade(color, 0.45),
        width: 1,
        alpha: 0.45 * alpha,
      });
      const [lx, ly] = lerp(wp, s, tt);
      g.moveTo(lx, ly - lift * 0.33).lineTo(lx, ly - lift * 0.66).stroke({
        color: shade(color, 0.5),
        width: 1,
        alpha: 0.4 * alpha,
      });
    }
  } else {
    // Vertical planks on the right wall.
    for (const tt of [0.25, 0.5, 0.75]) {
      const [bx, by] = lerp(s, e, tt);
      g.moveTo(bx, by).lineTo(bx, by - lift).stroke({
        color: shade(color, 0.42),
        width: 1,
        alpha: 0.45 * alpha,
      });
    }
  }
  // Roof shingle lines parallel to the north-east edge.
  for (const tt of [0.33, 0.66]) {
    const [ax, ay] = lerp([n[0], n[1] - lift], [wp[0], wp[1] - lift], tt);
    const [bx, by] = lerp([e[0], e[1] - lift], [s[0], s[1] - lift], tt);
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ color: shade(color, 0.95), width: 1, alpha: 0.5 * alpha });
  }
  // Sun-lit edge highlight along the roof's north-west rim.
  g.moveTo(wp[0], wp[1] - lift).lineTo(n[0], n[1] - lift).lineTo(e[0], e[1] - lift).stroke({
    color: shade(color, 1.35),
    width: 1.5,
    alpha: 0.8 * alpha,
  });
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
  level = 1,
): void {
  g.clear();
  if (def.roadTier !== undefined) {
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
  drawDecorations(g, def, w, h);
  drawLevelTrim(g, def, w, h, level);
  // Bar floats above the roof, centered over the footprint.
  const [n, , s] = footprintCorners(w, h);
  const cx = (n[0] + s[0]) / 2;
  drawHpBar(g, cx, n[1] - def.art.height - 10, Math.max(28, w * 18), hpRatio);
}

/** Visual upgrade markers: timber bracing at level 2, gold trim + banner at 3. */
function drawLevelTrim(g: Graphics, def: BuildingDef, w: number, h: number, level: number): void {
  if (level < 2) return;
  const lift = def.art.height;
  const [n, e, s, wp] = footprintCorners(w, h);
  // Timber corner posts on the two front edges.
  for (const c of [s, wp, e]) {
    g.moveTo(c[0], c[1]).lineTo(c[0], c[1] - lift).stroke({ color: 0x4a3826, width: 2.5 });
  }
  if (level >= 3) {
    // Gold trim along the roof edge + a banner above the roof.
    g.poly([n[0], n[1] - lift, e[0], e[1] - lift, s[0], s[1] - lift, wp[0], wp[1] - lift]).stroke({
      color: 0xe3b341,
      width: 2,
    });
    const cx = (n[0] + s[0]) / 2;
    const cy = (n[1] + s[1]) / 2 - lift;
    g.moveTo(cx, cy).lineTo(cx, cy - 12).stroke({ color: 0x4a3826, width: 2 });
    g.poly([cx, cy - 12, cx + 8, cy - 9.5, cx, cy - 7]).fill(0xe3b341);
  }
}

/** Per-building placeholder details (roofs, blades, flags, crates …). */
function drawDecorations(g: Graphics, def: BuildingDef, w: number, h: number): void {
  const lift = def.art.height;
  const [n, e, s, wp] = footprintCorners(w, h);
  // Roof-face corners.
  const rn = [n[0], n[1] - lift];
  const re = [e[0], e[1] - lift];
  const rs = [s[0], s[1] - lift];
  const rw = [wp[0], wp[1] - lift];
  const roofCx = (rn[0] + rs[0]) / 2;
  const roofCy = (rn[1] + rs[1]) / 2;

  switch (def.id) {
    case 'mill': {
      // Windmill cross on a short mast.
      const mx = roofCx;
      const my = roofCy - 8;
      g.moveTo(mx, roofCy).lineTo(mx, my).stroke({ color: 0x4a3b28, width: 2.5 });
      for (const a of [0.5, 2.07, 3.64, 5.21]) {
        g.moveTo(mx, my)
          .lineTo(mx + Math.cos(a) * 16, my + Math.sin(a) * 16)
          .stroke({ color: 0xf4eee0, width: 3.5 });
      }
      break;
    }
    case 'tower': {
      // Crenellations along the two front roof edges + flag.
      for (let i = 0; i < 4; i++) {
        const t = (i + 0.5) / 4;
        g.rect(rw[0] + (rs[0] - rw[0]) * t - 2.5, rw[1] + (rs[1] - rw[1]) * t - 6, 5, 6).fill(
          shade(def.art.color, 1.25),
        );
        g.rect(rs[0] + (re[0] - rs[0]) * t - 2.5, rs[1] + (re[1] - rs[1]) * t - 6, 5, 6).fill(
          shade(def.art.color, 1.25),
        );
      }
      g.moveTo(roofCx, roofCy).lineTo(roofCx, roofCy - 14).stroke({ color: 0x4a3b28, width: 2 });
      g.poly([roofCx, roofCy - 14, roofCx + 9, roofCy - 11, roofCx, roofCy - 8]).fill(PALETTE.flag);
      break;
    }
    case 'barracks': {
      g.moveTo(roofCx, roofCy).lineTo(roofCx, roofCy - 16).stroke({ color: 0x4a3b28, width: 2 });
      g.poly([roofCx, roofCy - 16, roofCx + 11, roofCy - 12.5, roofCx, roofCy - 9]).fill(
        PALETTE.flag,
      );
      break;
    }
    case 'warehouse': {
      // Two crates on the roof.
      g.rect(roofCx - 10, roofCy - 7, 9, 7).fill(shade(def.art.color, 0.8));
      g.rect(roofCx + 1, roofCy - 5, 7, 5).fill(shade(def.art.color, 0.65));
      break;
    }
    case 'bakery': {
      // Chimney with a bright opening.
      g.rect(rn[0] + 6, rn[1] + 2, 6, 10).fill(shade(def.art.color, 0.6));
      g.rect(rn[0] + 6, rn[1], 6, 3).fill(0xe8e3d4);
      break;
    }
    case 'farm': {
      // Crop rows on the flat roof face.
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        g.moveTo(rn[0] + (rw[0] - rn[0]) * t, rn[1] + (rw[1] - rn[1]) * t)
          .lineTo(re[0] + (rs[0] - re[0]) * t, re[1] + (rs[1] - re[1]) * t)
          .stroke({ color: shade(def.art.color, 1.3), width: 3, alpha: 0.8 });
      }
      break;
    }
    case 'lumberjack': {
      // Log pile at the front corner.
      for (const [ox, oy] of [[-6, -2], [0, -2], [-3, -7]]) {
        g.circle(s[0] + ox, s[1] + oy - 2, 3.2)
          .fill(PALETTE.trunk)
          .stroke({ color: shade(PALETTE.trunk, 1.4), width: 1 });
      }
      break;
    }
    case 'fishery': {
      // Fishing rod leaning over the front edge with a line.
      g.moveTo(s[0] - 2, s[1] - 6).lineTo(s[0] + 12, s[1] - 18).stroke({ color: PALETTE.trunk, width: 2 });
      g.moveTo(s[0] + 12, s[1] - 18).lineTo(s[0] + 12, s[1] - 4).stroke({ color: 0xd8d8d8, width: 1 });
      g.circle(s[0] + 12, s[1] - 3, 1.5).fill(0x7fb6d9);
      break;
    }
    case 'brewery': {
      // Barrel beside the entrance.
      const bx = (s[0] + e[0]) / 2 + 4;
      const by = (s[1] + e[1]) / 2 - 4;
      g.ellipse(bx, by, 4.5, 5.5).fill(0x9c7340).stroke({ color: 0x5a4026, width: 1.2 });
      g.moveTo(bx - 4.5, by - 1.5).lineTo(bx + 4.5, by - 1.5).stroke({ color: 0x5a4026, width: 1 });
      g.moveTo(bx - 4.5, by + 1.5).lineTo(bx + 4.5, by + 1.5).stroke({ color: 0x5a4026, width: 1 });
      break;
    }
    case 'mine': {
      // Dark adit with support beams on the right wall.
      const mx = (s[0] + e[0]) / 2;
      const my = (s[1] + e[1]) / 2;
      g.poly([mx, my - 1, mx + 8, my - 5, mx + 8, my - 14, mx, my - 10]).fill(0x1f1812);
      g.moveTo(mx, my - 1).lineTo(mx, my - 10).stroke({ color: PALETTE.trunk, width: 2 });
      g.moveTo(mx + 8, my - 5).lineTo(mx + 8, my - 14).stroke({ color: PALETTE.trunk, width: 2 });
      break;
    }
    case 'smithy': {
      // Anvil silhouette at the front + glowing forge window.
      g.poly([s[0] - 8, s[1] - 4, s[0] + 1, s[1] - 4, s[0] + 1, s[1] - 7, s[0] - 8, s[1] - 7]).fill(0x2a2a30);
      const fx = (s[0] + e[0]) / 2 + 2;
      const fy = (s[1] + e[1]) / 2 - 8;
      g.rect(fx, fy, 5, 5).fill(0xe07b30);
      break;
    }
    case 'hut': {
      // Door on the right wall.
      const dx = (s[0] + e[0]) / 2;
      const dy = (s[1] + e[1]) / 2;
      g.poly([dx, dy - 1, dx + 5, dy - 3.5, dx + 5, dy - 12, dx, dy - 9]).fill(0x4a3826);
      break;
    }
    case 'gate': {
      // Arch opening.
      const dx2 = (s[0] + e[0]) / 2;
      const dy2 = (s[1] + e[1]) / 2;
      g.poly([dx2, dy2, dx2 + 7, dy2 - 3.5, dx2 + 7, dy2 - 16, dx2, dy2 - 12]).fill(0x241b12);
      break;
    }
    default:
      break;
  }
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

/** Draw a soldier placeholder (tunic, helmet, spear and shield). */
export function drawSoldier(g: Graphics, selected: boolean, hpRatio = 1): void {
  g.clear();
  if (selected) {
    g.ellipse(0, 2, 12, 6).stroke({ color: PALETTE.selection, width: 2, alpha: 0.95 });
  }
  g.ellipse(0, 2, 7, 3.5).fill({ color: 0x000000, alpha: 0.3 });
  // Spear behind the body.
  g.moveTo(5, 1).lineTo(9, -20).stroke({ color: PALETTE.trunk, width: 1.8 });
  g.poly([9, -20, 11.5, -16.5, 7.5, -17]).fill(PALETTE.soldierHelmet);
  // Tunic body.
  g.poly([-5, 0, 5, 0, 3.5, -9, -3.5, -9])
    .fill(PALETTE.soldierBody)
    .stroke({ color: PALETTE.soldierOutline, width: 1.2 });
  // Head + helmet with nose guard.
  g.circle(0, -12, 3.8).fill(PALETTE.skin).stroke({ color: PALETTE.soldierOutline, width: 1 });
  g.poly([-4.2, -12.5, 4.2, -12.5, 3, -17, -3, -17]).fill(PALETTE.soldierHelmet);
  g.rect(-0.8, -12.5, 1.6, 3).fill(PALETTE.soldierHelmet);
  // Shield on the left arm.
  g.ellipse(-5.5, -6, 3.2, 4.2).fill(0x7a5230).stroke({ color: 0x3a2a18, width: 1 });
  drawHpBar(g, 0, -22, 18, hpRatio);
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
  // Tunic body.
  g.poly([-5, 0, 5, 0, 3.5, -9, -3.5, -9])
    .fill(PALETTE.workerBody)
    .stroke({ color: PALETTE.workerOutline, width: 1.2 });
  // Head with simple hood.
  g.circle(0, -12, 3.8).fill(PALETTE.skin).stroke({ color: PALETTE.workerOutline, width: 1 });
  g.poly([-4, -13, 4, -13, 0, -17.5]).fill(shade(PALETTE.workerBody, 0.8));
  if (carryingColor !== null) {
    // Crate on the shoulder.
    g.rect(2, -18, 7, 6)
      .fill(carryingColor)
      .stroke({ color: 0x000000, width: 1, alpha: 0.4 });
  }
}
