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
  foam: 0xdcecfb,
  sand: 0xdcc89a,
  sandDark: 0xc9b176,
  path: 0xa07e54,
  pathDark: 0x856544,
  snow: 0xeef3f8,
  snowDark: 0xdbe4ee,
  meadow: 0x6bb04e,
  meadowDark: 0x61a347,
  marsh: 0x4f5e3a,
  marshDark: 0x44512f,
  gravel: 0x9a9690,
  gravelDark: 0x868179,
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
      const ox = ((hash % 13) - 6) * 1.6;
      const oy = ((hash % 7) - 3) * 1.4;
      // Draw grass blades
      const bladeColor = shade(checker ? PALETTE.grassA : PALETTE.grassB, 0.78);
      g.moveTo(cx + ox, cy + oy).lineTo(cx + ox - 1, cy + oy - 4)
       .moveTo(cx + ox + 2, cy + oy).lineTo(cx + ox + 3, cy + oy - 5)
       .stroke({ color: bladeColor, width: 1.2 });

      if (hash % 23 === 0) {
        // Red flower cluster with yellow centers
        g.circle(cx + ox, cy + oy, 2.0).fill(0xcc3333);
        g.circle(cx + ox, cy + oy, 0.8).fill(0xffd700);
        g.circle(cx + ox + 4, cy + oy + 2, 1.6).fill(0xcc3333);
        g.circle(cx + ox + 4, cy + oy + 2, 0.6).fill(0xffd700);
      } else if (hash % 19 === 0) {
        // Bush cluster with highlight
        g.ellipse(cx + ox, cy + oy, 5, 3.5).fill(PALETTE.treeDark);
        g.ellipse(cx + ox - 2, cy + oy - 1, 3.5, 2.2).fill(PALETTE.treeLight);
      } else if (hash % 31 === 0) {
        // Pebbles
        g.circle(cx + ox, cy + oy + 1, 2.5).fill({ color: 0x000000, alpha: 0.15 }); // pebble shadow
        g.circle(cx + ox, cy + oy, 2.2).fill(shade(PALETTE.rock, 1.15));
        g.circle(cx + ox + 3.5, cy + oy + 1.5, 1.5).fill(PALETTE.rock);
      }
      break;
    }
    case Terrain.Water: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.water : PALETTE.waterDeep);
      // Shoreline wet sand effect on the border
      if (hash % 4 === 0) {
        g.poly([cx, cy - HALF_H, cx + 12, cy - HALF_H + 6, cx, cy - HALF_H + 2, cx - 12, cy - HALF_H + 6]).fill({
          color: 0x8fbdf5,
          alpha: 0.45
        });
      }
      // Light ripples
      if (hash % 5 < 2) {
        const sy = cy - 4 + (hash % 9);
        g.ellipse(cx - 4 + (hash % 9), sy, 10 + (hash % 5), 1.8).stroke({
          color: 0x82b2e8,
          width: 1.0,
          alpha: 0.35,
        });
      }
      break;
    }
    case Terrain.Forest: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.grassA : PALETTE.grassB);
      // Detailed pine trees with trunk, multi-layered foliage, and ground drop shadows.
      const tree = (tx: number, ty: number, s: number): void => {
        // Drop shadow
        g.ellipse(tx, ty + 2, 7 * s, 3.5 * s).fill({ color: 0x000000, alpha: 0.22 });
        // Trunk
        g.rect(tx - 1.5 * s, ty - 3 * s, 3 * s, 5 * s).fill(PALETTE.trunk);
        // Foliage bottom
        g.poly([tx, ty - 15 * s, tx + 8 * s, ty - 3 * s, tx - 8 * s, ty - 3 * s]).fill(
          checker ? PALETTE.treeDark : PALETTE.treeLight,
        );
        // Foliage middle
        g.poly([tx, ty - 20 * s, tx + 6 * s, ty - 9 * s, tx - 6 * s, ty - 9 * s]).fill(
          checker ? PALETTE.treeLight : PALETTE.treeDark,
        );
        // Foliage top
        g.poly([tx, ty - 24 * s, tx + 4 * s, ty - 14 * s, tx - 4 * s, ty - 14 * s]).fill(
          shade(checker ? PALETTE.treeLight : PALETTE.treeDark, 1.25),
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
      // Ground shadow
      g.ellipse(cx, cy + 2, HALF_W, HALF_H).fill({ color: 0x000000, alpha: 0.15 });
      const lift = 8;
      // Main rock face
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
      // Rock cracks/layers
      g.moveTo(cx - 6, cy - lift / 2).lineTo(cx + 3, cy - lift).stroke({ color: shade(PALETTE.rock, 0.55), width: 1.2 });
      g.moveTo(cx, cy - lift / 2).lineTo(cx - 4, cy + 2).stroke({ color: shade(PALETTE.rock, 0.55), width: 1.2 });
      break;
    }
    case Terrain.Ore: {
      g.poly(diamond(cx, cy)).fill(shade(PALETTE.rock, 0.7));
      // Ground shadow
      g.ellipse(cx, cy + 2, HALF_W, HALF_H).fill({ color: 0x000000, alpha: 0.15 });
      const lift = 8;
      // Main rock face
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
      // Rock cracks
      g.moveTo(cx - 4, cy - lift / 2).lineTo(cx + 5, cy - lift).stroke({ color: shade(PALETTE.rock, 0.5), width: 1.2 });
      // Glinting gold veins
      for (const [dx, dy] of [[-8, -6], [5, -9], [-2, -2], [9, -3], [-11, 1]] as const) {
        g.circle(cx + dx, cy + dy - lift / 2, 2.0).fill(0xffd700);
        g.circle(cx + dx + 0.8, cy + dy - lift / 2 - 0.8, 0.8).fill(0xffffff);
      }
      break;
    }
    case Terrain.Sand: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.sand : PALETTE.sandDark);
      const ox = ((hash % 13) - 6) * 1.6;
      const oy = ((hash % 7) - 3) * 1.4;
      // Scattered grains / small shells.
      g.circle(cx + ox, cy + oy, 1.1).fill({ color: shade(PALETTE.sandDark, 0.8), alpha: 0.6 });
      g.circle(cx + ox + 4, cy + oy + 2, 0.8).fill({ color: shade(PALETTE.sandDark, 0.8), alpha: 0.5 });
      if (hash % 17 === 0) g.circle(cx - ox, cy - oy, 1.6).fill({ color: 0xf2ead0, alpha: 0.7 });
      break;
    }
    case Terrain.Path: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.path : PALETTE.pathDark);
      const ox = ((hash % 13) - 6) * 1.4;
      const oy = ((hash % 7) - 3) * 1.2;
      // Pressed-earth ruts and pebbles.
      g.moveTo(cx - HALF_W * 0.5, cy).lineTo(cx + HALF_W * 0.5, cy)
        .stroke({ color: shade(PALETTE.pathDark, 0.85), width: 1, alpha: 0.5 });
      g.circle(cx + ox, cy + oy, 1.2).fill({ color: shade(PALETTE.pathDark, 0.7), alpha: 0.6 });
      if (hash % 11 === 0) g.circle(cx - ox, cy + oy, 1.4).fill({ color: PALETTE.rock, alpha: 0.7 });
      break;
    }
    case Terrain.Snow: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.snow : PALETTE.snowDark);
      const ox = ((hash % 13) - 6) * 1.5;
      const oy = ((hash % 7) - 3) * 1.3;
      // Sparkle + a faint bluish drift shadow.
      g.ellipse(cx + ox, cy + oy + 2, 6, 2).fill({ color: 0xc8d6e6, alpha: 0.4 });
      if (hash % 9 === 0) g.circle(cx - ox, cy - oy, 0.9).fill({ color: 0xffffff, alpha: 0.9 });
      break;
    }
    case Terrain.Meadow: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.meadow : PALETTE.meadowDark);
      const ox = ((hash % 13) - 6) * 1.6;
      const oy = ((hash % 7) - 3) * 1.4;
      // Dense little flowers.
      const cols = [0xffd34d, 0xff7eb0, 0xffffff, 0x9a6cff];
      for (let i = 0; i < 3; i++) {
        const fx = cx + ox + ((hash >> (i * 2)) % 7) - 3;
        const fy = cy + oy + ((hash >> (i * 3)) % 5) - 2;
        g.circle(fx, fy, 1.1).fill(cols[(hash + i) % cols.length]);
        g.circle(fx, fy, 0.4).fill(0xfff2c0);
      }
      break;
    }
    case Terrain.Marsh: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.marsh : PALETTE.marshDark);
      const ox = ((hash % 13) - 6) * 1.4;
      const oy = ((hash % 7) - 3) * 1.2;
      // Murky water puddles + reeds.
      g.ellipse(cx + ox, cy + oy, 5, 2.4).fill({ color: 0x35506a, alpha: 0.55 });
      if (hash % 6 < 2) {
        g.moveTo(cx - ox, cy - oy + 2).lineTo(cx - ox - 1, cy - oy - 5)
          .stroke({ color: 0x6f7d4a, width: 1.1 });
        g.moveTo(cx - ox + 2, cy - oy + 2).lineTo(cx - ox + 3, cy - oy - 4)
          .stroke({ color: 0x6f7d4a, width: 1.1 });
      }
      break;
    }
    case Terrain.Gravel: {
      g.poly(diamond(cx, cy)).fill(checker ? PALETTE.gravel : PALETTE.gravelDark);
      // Scattered pebbles.
      for (let i = 0; i < 4; i++) {
        const px = cx + ((hash >> (i * 2)) % 13) - 6;
        const py = cy + ((hash >> (i * 3)) % 9) - 4;
        g.circle(px, py, 1 + (i % 2) * 0.6).fill(shade(PALETTE.gravelDark, i % 2 ? 0.8 : 1.2));
      }
      break;
    }
  }
}

/**
 * Neighbour-aware edge transitions, drawn on top of a baked tile. `nN/nE/nS/nW`
 * are the terrains of the four orthogonal grid neighbours. Produces a foam rim
 * where land meets water (plus a faint waterline on the water side) and soft
 * sandy seams where grass meets sand/path.
 */
export function drawTerrainEdges(
  g: Graphics,
  cx: number,
  cy: number,
  self: Terrain,
  nN: Terrain,
  nE: Terrain,
  nS: Terrain,
  nW: Terrain,
): void {
  const n = [cx, cy - HALF_H];
  const e = [cx + HALF_W, cy];
  const s = [cx, cy + HALF_H];
  const w = [cx - HALF_W, cy];
  const edges: [number[], number[], Terrain][] = [
    [n, e, nN], // north neighbour
    [e, s, nE], // east neighbour
    [s, w, nS], // south neighbour
    [w, n, nW], // west neighbour
  ];
  const inset = (a: number[], k: number): number[] => [a[0] + (cx - a[0]) * k, a[1] + (cy - a[1]) * k];
  const band = (a: number[], b: number[], k: number, color: number, alpha: number): void => {
    const a2 = inset(a, k);
    const b2 = inset(b, k);
    g.poly([a[0], a[1], b[0], b[1], b2[0], b2[1], a2[0], a2[1]]).fill({ color, alpha });
  };
  const isWater = (t: Terrain): boolean => t === Terrain.Water;
  for (const [a, b, nt] of edges) {
    if (!isWater(self) && isWater(nt)) {
      band(a, b, 0.34, PALETTE.foam, 0.5);
      band(a, b, 0.16, PALETTE.foam, 0.28);
    } else if (isWater(self) && !isWater(nt)) {
      band(a, b, 0.22, 0x2a4f8f, 0.35);
    } else if (self === Terrain.Grass && (nt === Terrain.Sand || nt === Terrain.Path)) {
      band(a, b, 0.18, nt === Terrain.Sand ? PALETTE.sand : PALETTE.path, 0.3);
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

  // Soft drop shadow (light from the north-west → shadow cast to south-east).
  const sox = 5;
  const soy = 3;
  g.poly([
    n[0] + sox, n[1] + soy,
    e[0] + sox, e[1] + soy,
    s[0] + sox, s[1] + soy,
    wp[0] + sox, wp[1] + soy,
  ]).fill({ color: 0x000000, alpha: 0.22 * alpha });
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

/**
 * A raised wooden bridge: a plank deck with thickness, cross-planks and two
 * side railings — replaces the old flat 1×1 plate.
 */
function drawBridge(g: Graphics, w: number, h: number, rotated = false): void {
  const [n, e, s, wp] = footprintCorners(w, h);
  const deck = 0x9b7340;
  const lift = 5; // deck thickness above the water
  const railH = 9; // railing height above the deck
  const up = (p: number[], dy: number): number[] => [p[0], p[1] - dy];
  const lerp = (a: number[], b: number[], t: number): number[] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];

  // Soft shadow on the water below the deck.
  g.poly([...n, ...e, ...s, ...wp]).fill({ color: 0x000000, alpha: 0.18 });

  const nt = up(n, lift);
  const et = up(e, lift);
  const st = up(s, lift);
  const wt = up(wp, lift);

  // Deck side faces give the slab some height (always the iso front faces).
  g.poly([...e, ...s, ...st, ...et]).fill(shade(deck, 0.7));
  g.poly([...s, ...wp, ...wt, ...st]).fill(shade(deck, 0.6));

  // Deck top.
  g.poly([...nt, ...et, ...st, ...wt])
    .fill(deck)
    .stroke({ color: shade(deck, 0.6), width: 1.2 });

  const rail = (a: number[], b: number[]): void => {
    for (const t of [0, 0.5, 1]) {
      const p = lerp(a, b, t);
      const pt = up(p, railH);
      g.moveTo(p[0], p[1]).lineTo(pt[0], pt[1]).stroke({ color: 0x4a3320, width: 2 });
    }
    const aTop = up(a, railH);
    const bTop = up(b, railH);
    g.moveTo(aTop[0], aTop[1]).lineTo(bTop[0], bTop[1]).stroke({ color: shade(deck, 0.9), width: 2 });
  };

  // Railings run along the two edges parallel to the travel direction; planks
  // cross them. Rotating the bridge swaps which diagonal it spans.
  const [plankA1, plankA2, plankB1, plankB2, rail1a, rail1b, rail2a, rail2b] = rotated
    ? [nt, et, wt, st, nt, et, wt, st] // span NW↔SE: rails on NE & SW edges
    : [nt, wt, et, st, nt, wt, et, st]; // span NE↔SW: rails on NW & SE edges
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const a = lerp(plankA1, plankA2, t);
    const b = lerp(plankB1, plankB2, t);
    g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ color: shade(deck, 0.78), width: 1 });
  }
  rail(rail1a, rail1b);
  rail(rail2a, rail2b);
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
  rotated = false,
): void {
  g.clear();
  if (def.id === 'bridge') {
    drawBridge(g, w, h, rotated);
    return;
  }
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

  let art = def.art;
  if (def.id === 'hut') {
    if (level === 1) {
      art = { color: 0xd8af84, height: 18, material: 'wood' };
    } else if (level === 2) {
      art = { color: 0xe8e2d8, height: 22, material: 'wood' };
    } else if (level === 3) {
      art = { color: 0x7a828a, height: 26, material: 'stone' };
    }
  }
  const targetDef = def.id === 'hut' ? { ...def, art } : def;

  drawBuildingBlock(g, w, h, targetDef.art);
  drawDecorations(g, targetDef, w, h, level);
  drawLevelTrim(g, targetDef, w, h, level);
  // Bar floats above the roof, centered over the footprint.
  const [n, , s] = footprintCorners(w, h);
  const cx = (n[0] + s[0]) / 2;
  drawHpBar(g, cx, n[1] - targetDef.art.height - 10, Math.max(28, w * 18), hpRatio);
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
function drawDecorations(g: Graphics, def: BuildingDef, w: number, h: number, level = 1): void {
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
      // Windmill short mast only (sails are added dynamically).
      const mx = roofCx;
      g.moveTo(mx, roofCy).lineTo(mx, roofCy - 8).stroke({ color: 0x4a3b28, width: 2.5 });
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
    case 'smallWarehouse': {
      // One crate on the roof.
      g.rect(roofCx - 5, roofCy - 6, 8, 6).fill(shade(def.art.color, 0.75));
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
      // 1. Sloped Roof (hipRoof equivalent)
      let roofColor = 0xb89f68; // Lvl 1: Straw thatch
      let rH = 11;
      if (level === 2) {
        roofColor = 0xa84832; // Lvl 2: Red clay
        rH = 12;
      } else if (level === 3) {
        roofColor = 0x3f5a7a; // Lvl 3: Slate blue
        rH = 13;
      }

      // Roof ridge points R1 and R2
      const r1 = [(rw[0] + rn[0]) / 2, (rw[1] + rn[1]) / 2 - rH];
      const r2 = [(rs[0] + re[0]) / 2, (rs[1] + re[1]) / 2 - rH];

      // Left sloped roof face (darker shade)
      g.poly([rw[0], rw[1], rs[0], rs[1], r2[0], r2[1], r1[0], r1[1]])
        .fill({ color: shade(roofColor, 0.72) });

      // Right sloped roof face (lighter shade)
      g.poly([rn[0], rn[1], re[0], re[1], r2[0], r2[1], r1[0], r1[1]])
        .fill({ color: shade(roofColor, 1.12) });

      // Ridge line highlight
      g.moveTo(r1[0], r1[1]).lineTo(r2[0], r2[1]).stroke({ color: shade(roofColor, 1.35), width: 1.5 });

      // 2. Level-specific wall framing / doors / windows
      if (level === 1) {
        // Door on the right wall
        const dx = (s[0] + e[0]) / 2;
        const dy = (s[1] + e[1]) / 2;
        g.poly([dx - 3, dy + 1, dx + 3, dy - 2, dx + 3, dy - 10, dx - 3, dy - 7]).fill(0x3d2b1a);
        
        // Window on the right wall
        const wx = s[0] + (e[0] - s[0]) * 0.8;
        const wy = s[1] + (e[1] - s[1]) * 0.8 - lift * 0.5;
        g.poly([wx - 2, wy + 0.5, wx + 2, wy - 0.5, wx + 2, wy - 5, wx - 2, wy - 4])
          .fill(0xf4c95d)
          .stroke({ color: 0x3a2a18, width: 0.8 });
      } else if (level === 2) {
        // Timber framing on left wall (wp -> s)
        for (const t of [0, 0.5, 1]) {
          const a = [wp[0] + (s[0] - wp[0]) * t, wp[1] + (s[1] - wp[1]) * t];
          g.moveTo(a[0], a[1]).lineTo(a[0], a[1] - lift).stroke({ color: 0x4a301a, width: 1.5 });
        }
        // Timber framing on right wall (s -> e)
        for (const t of [0, 0.5, 1]) {
          const b = [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t];
          g.moveTo(b[0], b[1]).lineTo(b[0], b[1] - lift).stroke({ color: 0x4a301a, width: 1.5 });
        }
        // Horizontal timber beam
        g.moveTo(wp[0], wp[1] - lift * 0.555).lineTo(s[0], s[1] - lift * 0.555).stroke({ color: 0x4a301a, width: 1.5 });
        g.moveTo(s[0], s[1] - lift * 0.555).lineTo(e[0], e[1] - lift * 0.555).stroke({ color: 0x4a301a, width: 1.5 });

        // Door on right wall
        const dx = (s[0] + e[0]) / 2;
        const dy = (s[1] + e[1]) / 2;
        g.poly([dx - 3, dy + 1, dx + 3, dy - 2, dx + 3, dy - 11, dx - 3, dy - 8]).fill(0x3d2b1a);

        // Windows on left & right walls
        const wlx = wp[0] + (s[0] - wp[0]) * 0.55;
        const wly = wp[1] + (s[1] - wp[1]) * 0.55 - lift * 0.7;
        g.poly([wlx - 2.5, wly + 0.5, wlx + 2.5, wly - 0.5, wlx + 2.5, wly - 5.5, wlx - 2.5, wly - 4.5])
          .fill(0xf4c95d)
          .stroke({ color: 0x3a2a18, width: 0.8 });

        const wrx = s[0] + (e[0] - s[0]) * 0.8;
        const wry = s[1] + (e[1] - s[1]) * 0.8 - lift * 0.7;
        g.poly([wrx - 2.5, wry + 0.5, wrx + 2.5, wry - 0.5, wrx + 2.5, wry - 5.5, wrx - 2.5, wry - 4.5])
          .fill(0xf4c95d)
          .stroke({ color: 0x3a2a18, width: 0.8 });
      } else {
        // Door on right wall (arched stone door, gold highlight trim)
        const dx = (s[0] + e[0]) / 2;
        const dy = (s[1] + e[1]) / 2;
        g.poly([dx - 4, dy + 1.5, dx + 4, dy - 2.5, dx + 4, dy - 12, dx - 4, dy - 8]).fill(0xe3b341);
        g.poly([dx - 3, dy + 1, dx + 3, dy - 2, dx + 3, dy - 11, dx - 3, dy - 8]).fill(0x2a1d12);

        // Windows with gold frames
        const wlx = wp[0] + (s[0] - wp[0]) * 0.5;
        const wly = wp[1] + (s[1] - wp[1]) * 0.5 - lift * 0.6;
        g.poly([wlx - 3, wly + 0.5, wlx + 3, wly - 0.5, wlx + 3, wly - 7, wlx - 3, wly - 6])
          .fill(0xf4c95d)
          .stroke({ color: 0xe3b341, width: 1 });

        const wrx = s[0] + (e[0] - s[0]) * 0.75;
        const wry = s[1] + (e[1] - s[1]) * 0.75 - lift * 0.6;
        g.poly([wrx - 3, wry + 0.5, wrx + 3, wry - 0.5, wrx + 3, wry - 7, wrx - 3, wry - 6])
          .fill(0xf4c95d)
          .stroke({ color: 0xe3b341, width: 1 });
      }
      break;
    }
    case 'gate': {
      // Arch opening.
      const dx2 = (s[0] + e[0]) / 2;
      const dy2 = (s[1] + e[1]) / 2;
      g.poly([dx2, dy2, dx2 + 7, dy2 - 3.5, dx2 + 7, dy2 - 16, dx2, dy2 - 12]).fill(0x241b12);
      break;
    }
    case 'quarry': {
      // Stone piles at the front corner.
      g.ellipse(s[0] - 6, s[1] - 4, 5, 2.5).fill(0x9298a4);
      g.ellipse(s[0] + 4, s[1] - 5, 4, 2).fill(0x787e8a);
      break;
    }
    case 'keep': {
      // Big red flag.
      g.moveTo(roofCx, roofCy).lineTo(roofCx, roofCy - 20).stroke({ color: 0x4a3b28, width: 2 });
      g.poly([roofCx, roofCy - 20, roofCx + 12, roofCy - 17, roofCx, roofCy - 14]).fill(PALETTE.flag);
      // Large arched door on the front-right.
      const dx = (s[0] + e[0]) / 2;
      const dy = (s[1] + e[1]) / 2;
      g.poly([dx - 4, dy - 1, dx + 4, dy - 4, dx + 4, dy - 14, dx - 4, dy - 11]).fill(0x4a3826);
      break;
    }
    case 'market': {
      // Colorful striped awnings on the roof.
      g.rect(roofCx - 10, roofCy - 6, 8, 5).fill(0xc23b3b); // Red tent
      g.rect(roofCx + 2, roofCy - 4, 7, 4).fill(0x3a6fc4); // Blue tent
      break;
    }
    case 'sheepFarm': {
      // White puffs representing sheep on the pasture.
      g.circle(s[0] - 8, s[1] - 4, 3).fill(0xffffff);
      g.circle(s[0] + 6, s[1] - 5, 2.5).fill(0xf0f0f0);
      break;
    }
    case 'weavery': {
      // Fabric hanging from window.
      const dx = (s[0] + e[0]) / 2;
      const dy = (s[1] + e[1]) / 2;
      g.rect(dx - 2, dy - 8, 4, 9).fill(0x9a5a74);
      break;
    }
    case 'stable': {
      // Open paddock entrance.
      const dx = (s[0] + e[0]) / 2;
      const dy = (s[1] + e[1]) / 2;
      g.poly([dx - 3, dy - 1, dx + 3, dy - 3, dx + 3, dy - 11, dx - 3, dy - 9]).fill(0x241b12);
      break;
    }
    case 'gateIron': {
      // Arched opening with iron grid spikes.
      const dx = (s[0] + e[0]) / 2;
      const dy = (s[1] + e[1]) / 2;
      g.poly([dx, dy, dx + 7, dy - 3.5, dx + 7, dy - 16, dx, dy - 12]).fill(0x1a1510);
      // Spikes
      g.moveTo(dx + 2, dy - 6).lineTo(dx + 2, dy - 13).stroke({ color: 0x4a4a4a, width: 1.2 });
      g.moveTo(dx + 5, dy - 7.5).lineTo(dx + 5, dy - 14.5).stroke({ color: 0x4a4a4a, width: 1.2 });
      break;
    }
    case 'wall':
    case 'wallStrong': {
      // Battlements: merlons along the two front roof edges.
      const merlon = shade(def.art.color, 1.22);
      const gap = shade(def.art.color, 0.85);
      const mh = def.id === 'wallStrong' ? 8 : 6;
      for (let i = 0; i < 3; i++) {
        const t = (i + 0.5) / 3;
        // South-west edge (w → s)
        g.rect(rw[0] + (rs[0] - rw[0]) * t - 2.5, rw[1] + (rs[1] - rw[1]) * t - mh, 5, mh).fill(merlon);
        // South-east edge (s → e)
        g.rect(rs[0] + (re[0] - rs[0]) * t - 2.5, rs[1] + (re[1] - rs[1]) * t - mh, 5, mh).fill(merlon);
      }
      // Walkway shadow line between the merlon rows.
      g.moveTo(rw[0], rw[1]).lineTo(rs[0], rs[1]).lineTo(re[0], re[1]).stroke({
        color: gap,
        width: 1.5,
        alpha: 0.6,
      });
      break;
    }
    case 'imkerei': {
      // Two woven straw beehives on the roof, with a few bees.
      const hive = (hx: number, hy: number, sc: number): void => {
        for (let r = 0; r < 3; r++) {
          g.ellipse(hx, hy - r * 3 * sc, (6 - r * 1.6) * sc, 2.4 * sc).fill(
            shade(0xd9a441, 1 - r * 0.08),
          );
        }
        g.circle(hx, hy + 1.5 * sc, 1.2 * sc).fill(0x3a2a14); // entrance
      };
      hive(roofCx - 7, roofCy + 1, 1);
      hive(roofCx + 6, roofCy - 1, 0.85);
      for (const [bx, by] of [[roofCx + 1, roofCy - 12], [roofCx - 3, roofCy - 9]] as const) {
        g.circle(bx, by, 1).fill(0x2a2a2a);
      }
      break;
    }
    case 'methaus': {
      // Stacked mead barrels on the roof.
      const barrel = (bx: number, by: number): void => {
        g.ellipse(bx, by, 5, 6).fill(shade(0x8a5a2c, 1.0));
        g.ellipse(bx, by, 5, 6).stroke({ color: 0x5a3a1c, width: 1 });
        g.moveTo(bx - 5, by).lineTo(bx + 5, by).stroke({ color: 0x3a2410, width: 1 });
        g.rect(bx - 5.5, by - 1.5, 11, 3).fill({ color: 0xb8b8b8, alpha: 0.5 }); // hoop
      };
      barrel(roofCx - 6, roofCy);
      barrel(roofCx + 6, roofCy - 1);
      break;
    }
    case 'goldschmiede': {
      // Anvil + glinting gold ingots on the roof.
      g.rect(roofCx - 8, roofCy - 4, 10, 4).fill(0x33373d); // anvil base
      g.rect(roofCx - 9, roofCy - 7, 13, 3).fill(0x44484f); // anvil top
      for (const [ix, iy] of [[roofCx + 5, roofCy], [roofCx + 8, roofCy - 2]] as const) {
        g.rect(ix, iy, 6, 3).fill(0xe3b341);
        g.rect(ix + 0.6, iy + 0.4, 2, 0.8).fill(0xfff2c0); // glint
      }
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
  g.ellipse(0, 2.5, 8.5, 4.5).fill({ color: 0x000000, alpha: 0.28 });
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
  g.ellipse(0, 2.5, 8.5, 4.5).fill({ color: 0x000000, alpha: 0.28 });
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

/** Draw a fishery boat on water. */
export function drawFisheryBoat(g: Graphics, bobTimer: number): void {
  g.clear();
  // Soft shadow on water
  g.ellipse(0, 4, 12, 5).fill({ color: 0x000000, alpha: 0.2 });
  // Wooden boat hull
  g.poly([-14, -2, 14, -6, 10, 4, -10, 6])
    .fill(0x8a5a36)
    .stroke({ color: 0x4a2a16, width: 1.5 });
  // Inside of boat (darker)
  g.poly([-11, -2, 11, -5, 8, 2, -8, 3]).fill(0x5a3a1d);
  // Seat plank
  g.rect(-4, -2, 8, 3).fill(0x9a6b3f);
  // Fishing rod (shaking/bobbing slightly)
  const angle = Math.sin(bobTimer * 4) * 0.08;
  const rx = 6;
  const ry = -2;
  const length = 16;
  const tipX = rx + Math.cos(-0.6 + angle) * length;
  const tipY = ry + Math.sin(-0.6 + angle) * length * 0.8;
  g.moveTo(rx, ry).lineTo(tipX, tipY).stroke({ color: 0xc8a27c, width: 1.5 });
  // Fishing line going down into water
  g.moveTo(tipX, tipY).lineTo(tipX + 2, tipY + 12 + Math.sin(bobTimer * 2) * 2).stroke({ color: 0xdcdcdc, width: 0.8 });
}

/** Draw a decorative worker NPC with matching tools (going/working) or cargo (returning). */
export function drawDecorativeNPC(
  g: Graphics,
  type: 'lumberjack' | 'miner' | 'quarryman' | 'farmer',
  phase: 'toTarget' | 'working' | 'returning' | 'idle',
  hasSprite: boolean
): void {
  g.clear();
  if (hasSprite) {
    // Just draw overlay (axe/pickaxe/scythe/hoe or log/ore/stone/wheat)
    if (phase === 'returning') {
      if (type === 'lumberjack') {
        // Log on shoulder
        g.rect(2, -21, 10, 5)
          .fill(0x9a6b3f)
          .stroke({ color: 0x000000, width: 1, alpha: 0.4 });
      } else if (type === 'miner') {
        // Ore chunk on shoulder
        g.rect(2, -21, 8, 6)
          .fill(0x47494f)
          .stroke({ color: 0x000000, width: 1, alpha: 0.4 });
        g.circle(4, -18, 1.2).fill(0xe3b341); // gold glint
        g.circle(7, -19, 1).fill(0xe3b341);
      } else if (type === 'quarryman') {
        // Stone block on shoulder
        g.rect(2, -22, 8, 8)
          .fill(0xa5aab5)
          .stroke({ color: 0x000000, width: 1, alpha: 0.4 });
      } else if (type === 'farmer') {
        // Wheat sheaf
        g.ellipse(5, -19, 4, 7).fill(0xe3c558);
        g.moveTo(2, -21).lineTo(8, -17).stroke({ color: 0xc8a27c, width: 1 });
      }
    } else if (phase === 'toTarget' || phase === 'working') {
      // Draw tool in hand
      if (type === 'lumberjack') {
        // Axe handle
        g.moveTo(2, -12).lineTo(8, -20).stroke({ color: 0x5a4632, width: 1.5 });
        // Axe head
        g.poly([8, -20, 12, -22, 10, -17]).fill(0x777777).stroke({ color: 0x333333, width: 0.8 });
      } else if (type === 'miner') {
        // Pickaxe handle
        g.moveTo(2, -10).lineTo(8, -19).stroke({ color: 0x5a4632, width: 1.5 });
        // Pickaxe curved head
        g.moveTo(5, -21).quadraticCurveTo(8, -19, 11, -15).stroke({ color: 0x6e7480, width: 2 });
      } else if (type === 'quarryman') {
        // Hammer handle
        g.moveTo(2, -10).lineTo(8, -19).stroke({ color: 0x5a4632, width: 1.5 });
        // Hammer head (blocky)
        g.rect(6, -21, 5, 4).fill(0x555c69).stroke({ color: 0x222222, width: 0.8 });
      } else if (type === 'farmer') {
        // Scythe/hoe handle
        g.moveTo(1, -7).lineTo(8, -22).stroke({ color: 0x5a4632, width: 1.5 });
        // Curved scythe blade
        g.moveTo(8, -22).quadraticCurveTo(14, -23, 13, -16).stroke({ color: 0xdcdcdc, width: 1.2 });
      }
    }
  } else {
    // Draw entire worker
    // Soft shadow
    g.ellipse(0, 2, 7, 3.5).fill({ color: 0x000000, alpha: 0.3 });
    // Draw body
    g.poly([-5, 0, 5, 0, 3.5, -9, -3.5, -9])
      .fill(PALETTE.workerBody)
      .stroke({ color: PALETTE.workerOutline, width: 1.2 });
    // Draw head
    g.circle(0, -12, 3.8).fill(PALETTE.skin).stroke({ color: PALETTE.workerOutline, width: 1 });
    // Draw hat/hood
    g.poly([-4, -13, 4, -13, 0, -17.5]).fill(shade(PALETTE.workerBody, 0.8));

    if (phase === 'returning') {
      if (type === 'lumberjack') {
        g.rect(-6, -18, 12, 5)
          .fill(0x9a6b3f)
          .stroke({ color: PALETTE.workerOutline, width: 1 });
      } else if (type === 'miner') {
        g.rect(-5, -18, 10, 6)
          .fill(0x47494f)
          .stroke({ color: PALETTE.workerOutline, width: 1 });
        g.circle(-2, -15, 1).fill(0xe3b341);
      } else if (type === 'quarryman') {
        g.rect(-5, -19, 10, 7)
          .fill(0xa5aab5)
          .stroke({ color: PALETTE.workerOutline, width: 1 });
      } else if (type === 'farmer') {
        g.ellipse(0, -17, 4, 6).fill(0xe3c558).stroke({ color: PALETTE.workerOutline, width: 1 });
      }
    } else if (phase === 'toTarget' || phase === 'working') {
      if (type === 'lumberjack') {
        g.moveTo(3, -7).lineTo(9, -15).stroke({ color: 0x5a4632, width: 1.5 });
        g.poly([9, -15, 13, -17, 11, -12]).fill(0xa8adb8).stroke({ color: PALETTE.workerOutline, width: 0.8 });
      } else if (type === 'miner') {
        g.moveTo(3, -7).lineTo(9, -15).stroke({ color: 0x5a4632, width: 1.5 });
        g.moveTo(6, -17).quadraticCurveTo(9, -15, 12, -11).stroke({ color: 0xa8adb8, width: 2 });
      } else if (type === 'quarryman') {
        g.moveTo(3, -7).lineTo(9, -15).stroke({ color: 0x5a4632, width: 1.5 });
        g.rect(7, -17, 4, 3).fill(0x6e7480).stroke({ color: PALETTE.workerOutline, width: 0.8 });
      } else if (type === 'farmer') {
        g.moveTo(2, -5).lineTo(8, -17).stroke({ color: 0x5a4632, width: 1.5 });
        g.moveTo(8, -17).quadraticCurveTo(13, -18, 12, -12).stroke({ color: 0xa8adb8, width: 1.2 });
      }
    }
  }
}

