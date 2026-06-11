/**
 * Generates the building sprites described in ASSETS.md as detailed SVG
 * vector art and renders them to transparent 2× PNGs via Playwright,
 * including public/sprites/manifest.json.
 *
 *   node scripts/generate-sprites.mjs
 *
 * Requires playwright with a Chromium install (npx playwright install chromium).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');
const HW = 32; // half tile width
const HH = 16; // half tile height
const MARGIN = 4;

// --- tiny SVG kit -------------------------------------------------------------

let gradCounter = 0;
function ctx() {
  return { defs: [], body: [] };
}
function P(pts) {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}
function poly(c, pts, fill, opts = {}) {
  const s = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.sw ?? 1.2}" stroke-linejoin="round"` : '';
  const o = opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : '';
  c.body.push(`<polygon points="${P(pts)}" fill="${fill}"${s}${o}/>`);
}
function line(c, a, b, stroke, w = 1.2, opacity = 1) {
  c.body.push(
    `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${stroke}" stroke-width="${w}" opacity="${opacity}" stroke-linecap="round"/>`,
  );
}
function circle(c, x, y, r, fill, opts = {}) {
  const s = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.sw ?? 1}"` : '';
  c.body.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"${s}/>`);
}
function ellipse(c, x, y, rx, ry, fill, opacity = 1) {
  c.body.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" opacity="${opacity}"/>`);
}
function rect(c, x, y, w, h, fill, opts = {}) {
  const s = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.sw ?? 1}"` : '';
  const rx = opts.rx ? ` rx="${opts.rx}"` : '';
  c.body.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${s}${rx}/>`);
}
/** Linear gradient; returns fill url. dir: [x1,y1,x2,y2] in 0..1 space. */
function grad(c, stops, dir = [0, 0, 0, 1]) {
  const id = `g${gradCounter++}`;
  const st = stops.map(([off, col]) => `<stop offset="${off}" stop-color="${col}"/>`).join('');
  c.defs.push(
    `<linearGradient id="${id}" x1="${dir[0]}" y1="${dir[1]}" x2="${dir[2]}" y2="${dir[3]}">${st}</linearGradient>`,
  );
  return `url(#${id})`;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (
    '#' +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')
  );
}

/** Footprint corners relative to the anchor (center of top-left tile). */
function corners(w, h) {
  return {
    N: [0, -HH],
    E: [w * HW, (w - 1) * HH],
    S: [(w - h) * HW, (w + h - 1) * HH],
    W: [-h * HW, (h - 1) * HH],
  };
}
const up = ([x, y], L) => [x, y - L];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

const OUTLINE = '#2b2018';

/** Ground shadow + two wall faces with gradients + outline. */
function prism(c, w, h, L, color, opts = {}) {
  const { N, E, S, W } = corners(w, h);
  ellipse(c, ...mid(up(mid(W, E), 0), S), (w + h) * HW * 0.52, (w + h) * HH * 0.5, '#000', 0.22);
  const left = grad(c, [[0, shade(color, 0.78)], [1, shade(color, 0.58)]]);
  const right = grad(c, [[0, shade(color, 0.6)], [1, shade(color, 0.42)]]);
  poly(c, [W, S, up(S, L), up(W, L)], left, { stroke: OUTLINE });
  poly(c, [S, E, up(E, L), up(S, L)], right, { stroke: OUTLINE });
  if (!opts.noTop) {
    poly(c, [up(N, L), up(E, L), up(S, L), up(W, L)], shade(color, 1.1), { stroke: OUTLINE });
  }
  return { N, E, S, W };
}

/** Hipped roof over the wall top, ridge from NW-mid to SE-mid. */
function hipRoof(c, w, h, L, rH, color, overhang = 4) {
  const { N, E, S, W } = corners(w, h);
  const o = overhang;
  const Nt = [N[0], N[1] - L - o * 0.5];
  const Et = [E[0] + o, E[1] - L];
  const St = [S[0], S[1] - L + o * 0.5];
  const Wt = [W[0] - o, W[1] - L];
  const R1 = up(mid(Wt, Nt), rH);
  const R2 = up(mid(St, Et), rH);
  const lit = grad(c, [[0, shade(color, 1.25)], [1, shade(color, 1.0)]]);
  const dark = grad(c, [[0, shade(color, 0.9)], [1, shade(color, 0.62)]]);
  poly(c, [Nt, Et, R2, R1], lit, { stroke: OUTLINE });
  poly(c, [Wt, St, R2, R1], dark, { stroke: OUTLINE });
  line(c, R1, R2, shade(color, 1.45), 2);
  return { Nt, Et, St, Wt, R1, R2 };
}

/** Timber frame strokes on both wall faces. */
function timber(c, w, h, L, color = '#54381f') {
  const { E, S, W } = corners(w, h);
  for (const t of [0, 0.5, 1]) {
    const a = lerp(W, S, t);
    line(c, a, up(a, L), color, 2);
    const b = lerp(S, E, t);
    line(c, b, up(b, L), color, 2);
  }
  line(c, up(W, L * 0.55), up(S, L * 0.55), color, 2);
  line(c, up(S, L * 0.55), up(E, L * 0.55), color, 2);
}

/** Small window with warm glow on the right (SE) face. */
function windowSE(c, w, h, L, t = 0.5, y = 0.45, size = 6) {
  const { E, S } = corners(w, h);
  const p = up(lerp(S, E, t), L * y);
  poly(c, [[p[0] - size / 2, p[1] + size * 0.3], [p[0] + size / 2, p[1]], [p[0] + size / 2, p[1] - size], [p[0] - size / 2, p[1] - size * 0.7]],
    '#f4c95d', { stroke: '#3a2a18', sw: 1 });
}
function doorSE(c, w, h, t = 0.5, dh = 13, dw = 8) {
  const { E, S } = corners(w, h);
  const p = lerp(S, E, t);
  poly(c, [[p[0] - dw / 2, p[1] + dw * 0.25 - 1], [p[0] + dw / 2, p[1] - 1], [p[0] + dw / 2, p[1] - dh], [p[0] - dw / 2, p[1] - dh + dw * 0.25]],
    '#3d2b1a', { stroke: OUTLINE, sw: 1 });
}

// --- buildings -----------------------------------------------------------------

/** Each returns { c, top } where top = highest point above anchor (positive px). */
const builders = {
  warehouse(c) {
    prism(c, 2, 2, 36, '#cdb38a', { noTop: true });
    timber(c, 2, 2, 36);
    const r = hipRoof(c, 2, 2, 36, 18, '#9e4a36');
    doorSE(c, 2, 2, 0.5, 15, 10);
    windowSE(c, 2, 2, 36, 0.82, 0.6);
    // crates by the entrance
    const { S } = corners(2, 2);
    rect(c, S[0] + 8, S[1] - 12, 9, 8, '#a8845a', { stroke: OUTLINE });
    rect(c, S[0] + 12, S[1] - 18, 7, 6, '#bb9668', { stroke: OUTLINE });
    return 36 + 18 + HH + 6;
  },
  lumberjack(c) {
    prism(c, 2, 2, 24, '#8a5d33', { noTop: true });
    // log courses
    const { E, S, W } = corners(2, 2);
    for (const t of [0.25, 0.5, 0.75]) {
      line(c, up(W, 24 * t), up(S, 24 * t), '#6b4322', 1.4, 0.8);
      line(c, up(S, 24 * t), up(E, 24 * t), '#5d3a1d', 1.4, 0.8);
    }
    hipRoof(c, 2, 2, 24, 13, '#4f7142');
    doorSE(c, 2, 2, 0.35);
    // log pile
    for (const [ox, oy] of [[14, -4], [22, -8], [18, -11]]) {
      circle(c, S[0] + ox, S[1] + oy, 4, '#7d5630', { stroke: OUTLINE });
      circle(c, S[0] + ox, S[1] + oy, 1.8, '#c9a061');
    }
    return 24 + 13 + HH + 6;
  },
  quarry(c) {
    prism(c, 2, 2, 20, '#8f959e', { noTop: true });
    const { N, E, S, W } = corners(2, 2);
    poly(c, [up(N, 20), up(E, 20), up(S, 20), up(W, 20)], '#7b818b', { stroke: OUTLINE });
    // mortar
    for (const t of [0.33, 0.66]) {
      line(c, up(W, 20 * t), up(S, 20 * t), '#5c626c', 1, 0.7);
      line(c, up(S, 20 * t), up(E, 20 * t), '#51565f', 1, 0.7);
    }
    // stone chunks on top + lifting beam
    circle(c, 0, -2 - 20, 5, '#a7adb6', { stroke: OUTLINE });
    circle(c, 9, 2 - 20, 4, '#969ca6', { stroke: OUTLINE });
    line(c, [-14, -20], [-14, -38], '#54381f', 2.5);
    line(c, [-14, -38], [6, -30], '#54381f', 2.5);
    line(c, [6, -30], [6, -24], '#3a2a18', 1.2);
    return 44 + HH + 4;
  },
  mine(c) {
    prism(c, 2, 2, 22, '#7a6a55', { noTop: true });
    hipRoof(c, 2, 2, 22, 10, '#6e645c', 3);
    // adit with timber frame on SE face
    const { E, S } = corners(2, 2);
    const p = lerp(S, E, 0.45);
    poly(c, [[p[0] - 7, p[1] + 1], [p[0] + 7, p[1] - 4], [p[0] + 7, p[1] - 17], [p[0] - 7, p[1] - 13]], '#191310', { stroke: OUTLINE });
    line(c, [p[0] - 7, p[1] + 1], [p[0] - 7, p[1] - 13], '#8a6a3d', 2.5);
    line(c, [p[0] + 7, p[1] - 4], [p[0] + 7, p[1] - 17], '#8a6a3d', 2.5);
    // cart with ore
    ellipse(c, p[0] + 16, p[1] - 2, 6, 3.4, '#4d4138');
    circle(c, p[0] + 14, p[1] - 4, 1.6, '#9b8b74');
    circle(c, p[0] + 18, p[1] - 4.5, 1.6, '#8d7d66');
    return 22 + 10 + HH + 4;
  },
  smithy(c) {
    prism(c, 2, 2, 26, '#5e5754', { noTop: true });
    hipRoof(c, 2, 2, 26, 12, '#46413f');
    // chimney + smoke
    rect(c, 8, -26 - 22, 7, 16, '#6e6663', { stroke: OUTLINE });
    circle(c, 12, -26 - 26, 4, '#9aa0a8', {});
    circle(c, 16, -26 - 31, 3, '#aab0b8', {});
    // glowing forge + anvil
    const { E, S } = corners(2, 2);
    const p = lerp(S, E, 0.4);
    poly(c, [[p[0] - 6, p[1]], [p[0] + 6, p[1] - 4], [p[0] + 6, p[1] - 13], [p[0] - 6, p[1] - 9]], '#e07b30', { stroke: OUTLINE });
    poly(c, [[p[0] - 4, p[1] - 2], [p[0] + 4, p[1] - 5], [p[0] + 4, p[1] - 10], [p[0] - 4, p[1] - 7]], '#f6b352');
    rect(c, S[0] + 10, S[1] - 10, 10, 3, '#34343c', { stroke: OUTLINE });
    rect(c, S[0] + 13, S[1] - 7, 4, 4, '#2c2c33');
    return 26 + 12 + 22 + HH;
  },
  fishery(c) {
    prism(c, 2, 1, 16, '#7d96a8', { noTop: true });
    hipRoof(c, 2, 1, 16, 10, '#3f6b8a');
    doorSE(c, 2, 1, 0.3, 11, 7);
    // pier posts + rod
    const { S, E } = corners(2, 1);
    line(c, [E[0] - 4, E[1] + 2], [E[0] + 10, E[1] - 26], '#54381f', 2);
    line(c, [E[0] + 10, E[1] - 26], [E[0] + 10, E[1] - 2], '#d8d8d8', 1);
    circle(c, E[0] + 10, E[1] - 1, 2, '#7fb6d9');
    ellipse(c, S[0] + 6, S[1] - 2, 5, 2.5, '#5d7d92');
    return 16 + 10 + HH + 4;
  },
  farm(c) {
    const { N, E, S, W } = corners(3, 3);
    ellipse(c, ...mid(N, S), 3 * HW + 8, 3 * HH + 4, '#000', 0.18);
    // field
    poly(c, [N, E, S, W], grad(c, [[0, '#c9a83c'], [1, '#a8862e']]), { stroke: OUTLINE });
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      line(c, lerp(N, W, t), lerp(E, S, t), '#8a6d24', 1.6, 0.75);
      line(c, lerp(N, W, t + 0.1), lerp(E, S, t + 0.1), '#e3c558', 1.6, 0.6);
    }
    // farmhouse on the back corner (1x1)
    const hc = ctx();
    prism(hc, 1, 1, 18, '#b08956', { noTop: true });
    hipRoof(hc, 1, 1, 18, 10, '#8a4a32');
    doorSE(hc, 1, 1, 0.5, 10, 6);
    c.defs.push(...hc.defs);
    c.body.push(`<g transform="translate(${0},${0})">${hc.body.join('')}</g>`);
    // haystack
    ellipse(c, S[0] + 4, S[1] - 8, 8, 5, '#d9b84f');
    ellipse(c, S[0] + 4, S[1] - 12, 5.5, 3.5, '#e7ca66');
    return 18 + 10 + HH + 6;
  },
  mill(c) {
    // tapered tower: draw as prism with slight inset top via two trapezoids
    const { N, E, S, W } = corners(2, 2);
    ellipse(c, ...mid(N, S), 2 * HW + 6, 2 * HH + 3, '#000', 0.2);
    const L = 42;
    const ins = 8;
    const Wt = [W[0] + ins, W[1] - L];
    const St = [S[0], S[1] - L - ins * 0.4];
    const Et = [E[0] - ins, E[1] - L];
    const Ntp = [N[0], N[1] - L + ins * 0.4];
    poly(c, [W, S, St, Wt], grad(c, [[0, '#ece4d2'], [1, '#c9bfa9']]), { stroke: OUTLINE });
    poly(c, [S, E, Et, St], grad(c, [[0, '#d8cfb8'], [1, '#a99f88']]), { stroke: OUTLINE });
    poly(c, [Ntp, Et, St, Wt], '#efe8d8', { stroke: OUTLINE });
    // cap
    const capC = mid(Wt, Et);
    ellipse(c, capC[0], capC[1] - 2, 22, 10, '#7a4a30');
    ellipse(c, capC[0], capC[1] - 5, 16, 7, '#8f5a3a');
    // blades
    const hub = [capC[0] + 6, capC[1] - 14];
    for (const a of [0.6, 2.17, 3.74, 5.31]) {
      const tip = [hub[0] + Math.cos(a) * 30, hub[1] + Math.sin(a) * 30 * 0.8];
      line(c, hub, tip, '#54381f', 2.5);
      const t1 = lerp(hub, tip, 0.25);
      poly(c, [t1, [t1[0] + 6, t1[1] + 3], [tip[0] + 6, tip[1] + 3], tip], '#f4eee0', { stroke: '#54381f', sw: 1 });
    }
    circle(c, hub[0], hub[1], 3, '#3a2a18');
    doorSE(c, 2, 2, 0.35, 14, 9);
    return 42 + 14 + 30 + HH;
  },
  bakery(c) {
    prism(c, 2, 2, 28, '#c98a5b', { noTop: true });
    timber(c, 2, 2, 28, '#7a4a2a');
    hipRoof(c, 2, 2, 28, 14, '#7a4a32');
    rect(c, -16, -28 - 18, 7, 14, '#9a6a4a', { stroke: OUTLINE });
    circle(c, -12, -28 - 22, 3.5, '#cdd3da');
    doorSE(c, 2, 2, 0.6, 13, 8);
    windowSE(c, 2, 2, 28, 0.25, 0.5);
    // bretzel sign
    circle(c, 22, -2, 5, '#e8b34c', { stroke: '#7a4a2a', sw: 1.4 });
    return 28 + 14 + 18 + HH;
  },
  brewery(c) {
    prism(c, 2, 2, 30, '#a07b46', { noTop: true });
    timber(c, 2, 2, 30);
    hipRoof(c, 2, 2, 30, 14, '#5d4a2e');
    // copper kettle dome through the roof
    ellipse(c, 10, -34, 9, 7, '#b87333');
    ellipse(c, 8, -36, 4, 3, '#dca05e');
    // barrels
    const { S } = corners(2, 2);
    for (const [ox, oy] of [[10, -5], [20, -9]]) {
      ellipse(c, S[0] + ox, S[1] + oy, 5, 6.2, '#9c7340');
      line(c, [S[0] + ox - 5, S[1] + oy - 2], [S[0] + ox + 5, S[1] + oy - 2], '#5a4026', 1.2);
      line(c, [S[0] + ox - 5, S[1] + oy + 2], [S[0] + ox + 5, S[1] + oy + 2], '#5a4026', 1.2);
    }
    doorSE(c, 2, 2, 0.3);
    return 30 + 14 + HH + 8;
  },
  hut(c) {
    prism(c, 1, 1, 18, '#a8835c', { noTop: true });
    hipRoof(c, 1, 1, 18, 11, '#6d6253');
    doorSE(c, 1, 1, 0.45, 11, 7);
    windowSE(c, 1, 1, 18, 0.85, 0.55, 4.5);
    return 18 + 11 + HH + 4;
  },
  wall(c) {
    const { N, E, S, W } = corners(1, 1);
    const L = 30;
    prism(c, 1, 1, L, '#8a8f99', { noTop: true });
    poly(c, [up(N, L), up(E, L), up(S, L), up(W, L)], '#9da3ad', { stroke: OUTLINE });
    for (const t of [0.35, 0.7]) {
      line(c, up(W, L * t), up(S, L * t), '#6a707a', 1, 0.8);
      line(c, up(S, L * t), up(E, L * t), '#5e636d', 1, 0.8);
    }
    // crenellations
    for (const t of [0.15, 0.55]) {
      const a = lerp(up(W, L), up(N, L), t);
      poly(c, [[a[0], a[1] + 3], [a[0] + 9, a[1] + 7.5], [a[0] + 9, a[1] - 1.5], [a[0], a[1] - 6]], '#aeb4be', { stroke: OUTLINE, sw: 1 });
    }
    return 30 + 10 + HH;
  },
  gate(c) {
    const L = 28;
    prism(c, 1, 1, L, '#9a8252', { noTop: true });
    poly(c, [up(corners(1, 1).N, L), up(corners(1, 1).E, L), up(corners(1, 1).S, L), up(corners(1, 1).W, L)], '#ab9362', { stroke: OUTLINE });
    // arch
    const { E, S } = corners(1, 1);
    const p = lerp(S, E, 0.5);
    c.body.push(`<path d="M ${p[0] - 8} ${p[1] + 1} L ${p[0] - 8} ${p[1] - 12} Q ${p[0]} ${p[1] - 22} ${p[0] + 8} ${p[1] - 16} L ${p[0] + 8} ${p[1] - 3} Z" fill="#241b12" stroke="${OUTLINE}"/>`);
    line(c, [p[0] - 3, p[1] - 1], [p[0] - 3, p[1] - 17], '#6a4f2c', 1.4);
    line(c, [p[0] + 2, p[1] - 2.5], [p[0] + 2, p[1] - 18], '#6a4f2c', 1.4);
    return 28 + 8 + HH;
  },
  tower(c) {
    const L = 54;
    prism(c, 2, 2, L, '#79808c', { noTop: true });
    const { N, E, S, W } = corners(2, 2);
    for (const t of [0.25, 0.5, 0.75]) {
      line(c, up(W, L * t), up(S, L * t), '#5a6068', 1, 0.7);
      line(c, up(S, L * t), up(E, L * t), '#4f545c', 1, 0.7);
    }
    poly(c, [up(N, L), up(E, L), up(S, L), up(W, L)], '#8b929e', { stroke: OUTLINE });
    // crenellations along front edges
    for (const tt of [0.1, 0.4, 0.7]) {
      const a = lerp(up(W, L), up(S, L), tt);
      poly(c, [[a[0], a[1] + 3], [a[0] + 8, a[1] + 7], [a[0] + 8, a[1] - 2], [a[0], a[1] - 6]], '#9ba2ae', { stroke: OUTLINE, sw: 1 });
      const b = lerp(up(S, L), up(E, L), tt + 0.05);
      poly(c, [[b[0], b[1] + 7], [b[0] + 8, b[1] + 3], [b[0] + 8, b[1] - 6], [b[0], b[1] - 2]], '#878e9a', { stroke: OUTLINE, sw: 1 });
    }
    // arrow slit + flag
    const p = lerp(S, E, 0.5);
    rect(c, p[0] - 1.5, p[1] - L * 0.62, 3, 12, '#22252a');
    const fc = mid(up(N, L), up(S, L));
    line(c, fc, [fc[0], fc[1] - 18], '#54381f', 2);
    poly(c, [[fc[0], fc[1] - 18], [fc[0] + 13, fc[1] - 14.5], [fc[0], fc[1] - 11]], '#c23b3b', { stroke: OUTLINE, sw: 1 });
    return 54 + 18 + HH + 2;
  },
  barracks(c) {
    prism(c, 3, 3, 30, '#8c6a72', { noTop: true });
    timber(c, 3, 3, 30, '#4a3340');
    hipRoof(c, 3, 3, 30, 16, '#5b4148');
    doorSE(c, 3, 3, 0.5, 16, 11);
    windowSE(c, 3, 3, 30, 0.2, 0.5);
    windowSE(c, 3, 3, 30, 0.8, 0.5);
    // banner + weapon rack
    const { S } = corners(3, 3);
    const fc = [0, -30 - 16 - 2];
    line(c, fc, [fc[0], fc[1] - 16], '#54381f', 2);
    poly(c, [[fc[0], fc[1] - 16], [fc[0] + 12, fc[1] - 12.5], [fc[0], fc[1] - 9]], '#c23b3b', { stroke: OUTLINE, sw: 1 });
    line(c, [S[0] + 12, S[1] - 4], [S[0] + 16, S[1] - 18], '#9aa1ab', 2);
    line(c, [S[0] + 18, S[1] - 6], [S[0] + 22, S[1] - 20], '#9aa1ab', 2);
    return 30 + 16 + 18 + HH;
  },
};

// footprints per def (must match src/data/buildings.ts)
const FOOTPRINTS = {
  warehouse: [2, 2], lumberjack: [2, 2], quarry: [2, 2], mine: [2, 2], smithy: [2, 2],
  fishery: [2, 1], farm: [3, 3], mill: [2, 2], bakery: [2, 2], brewery: [2, 2],
  hut: [1, 1], wall: [1, 1], gate: [1, 1], tower: [2, 2], barracks: [3, 3],
};

async function main() {
  const { chromium } = await import('playwright');
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 600, height: 600 } });

  const manifest = { buildings: {} };
  for (const [id, build] of Object.entries(builders)) {
    gradCounter = 0;
    const [w, h] = FOOTPRINTS[id];
    const c = ctx();
    const top = build(c);
    const minX = -h * HW - MARGIN;
    const width = (w + h) * HW + 2 * MARGIN;
    const minY = -top - MARGIN;
    const height = top + (w + h - 1) * HH + HH + 2 * MARGIN;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}"><defs>${c.defs.join('')}</defs>${c.body.join('')}</svg>`;
    await page.setContent(`<style>body{margin:0;display:inline-block}</style>${svg}`);
    const el = page.locator('svg');
    await el.screenshot({ omitBackground: true, path: join(OUT, `${id}.png`) });
    manifest.buildings[id] = {
      file: `${id}.png`,
      anchorX: (0 - minX) * 2,
      anchorY: (0 - minY) * 2,
      scale: 0.5,
    };
    console.log(`${id}.png (${width}x${height} @2x)`);
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log('manifest.json written');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
