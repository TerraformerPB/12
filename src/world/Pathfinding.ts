import type { Point } from './IsoGrid';

/**
 * A* pathfinding on the tile grid, 8-directional without corner cutting.
 * Works against a minimal structural interface so it is trivially unit
 * testable and stays independent from rendering.
 *
 * Costs come from `moveCost(x, y)` (Infinity = blocked) — the hook for
 * cheaper road tiles and wall blocking in later phases.
 */
export interface PathGrid {
  readonly width: number;
  readonly height: number;
  moveCost(gx: number, gy: number): number;
}

const SQRT2 = Math.SQRT2;

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

/** Binary min-heap keyed by f. */
class Heap {
  private items: Node[] = [];

  get size(): number {
    return this.items.length;
  }

  push(n: Node): void {
    const items = this.items;
    items.push(n);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p].f <= items[i].f) break;
      [items[p], items[i]] = [items[i], items[p]];
      i = p;
    }
  }

  pop(): Node {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let min = i;
        if (l < items.length && items[l].f < items[min].f) min = l;
        if (r < items.length && items[r].f < items[min].f) min = r;
        if (min === i) break;
        [items[min], items[i]] = [items[i], items[min]];
        i = min;
      }
    }
    return top;
  }
}

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return Math.max(ax, ay) + (SQRT2 - 1) * Math.min(ax, ay);
}

/**
 * Find the cheapest path from `start` to ANY of `goals`.
 * Returns the tile sequence including start and goal, or null if unreachable.
 * The start tile itself may be blocked (a worker standing on a reserved
 * tile can still leave it); goal tiles must be walkable.
 */
export function findPath(grid: PathGrid, start: Point, goals: Point[]): Point[] | null {
  if (goals.length === 0) return null;

  const goalKeys = new Set(goals.map((g) => g.y * grid.width + g.x));
  if (goalKeys.has(start.y * grid.width + start.x)) return [start];

  const heuristic = (x: number, y: number): number => {
    let min = Infinity;
    for (const g of goals) {
      const h = octile(g.x - x, g.y - y);
      if (h < min) min = h;
    }
    return min;
  };

  const open = new Heap();
  const best = new Map<number, number>(); // key -> best g found
  const startNode: Node = { x: start.x, y: start.y, g: 0, f: heuristic(start.x, start.y), parent: null };
  open.push(startNode);
  best.set(start.y * grid.width + start.x, 0);

  while (open.size > 0) {
    const cur = open.pop();
    const curKey = cur.y * grid.width + cur.x;
    if (goalKeys.has(curKey)) {
      const path: Point[] = [];
      for (let n: Node | null = cur; n; n = n.parent) path.push({ x: n.x, y: n.y });
      return path.reverse();
    }
    if (best.get(curKey)! < cur.g) continue; // stale entry

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        const tileCost = grid.moveCost(nx, ny);
        if (!isFinite(tileCost)) continue;
        const diagonal = dx !== 0 && dy !== 0;
        // No corner cutting: both orthogonal neighbors must be walkable.
        if (diagonal) {
          if (!isFinite(grid.moveCost(cur.x + dx, cur.y)) || !isFinite(grid.moveCost(cur.x, cur.y + dy))) {
            continue;
          }
        }
        const g = cur.g + tileCost * (diagonal ? SQRT2 : 1);
        const key = ny * grid.width + nx;
        const known = best.get(key);
        if (known !== undefined && known <= g) continue;
        best.set(key, g);
        open.push({ x: nx, y: ny, g, f: g + heuristic(nx, ny), parent: cur });
      }
    }
  }
  return null;
}
