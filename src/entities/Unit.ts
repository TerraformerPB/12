import type { Point } from '../world/IsoGrid';

/**
 * Base class for mobile units (carriers, soldiers; enemies in phase 3).
 * Holds position in fractional grid coordinates plus path-following.
 * Rendering interpolates between prevX/prevY and x/y.
 */
export abstract class Unit {
  readonly id: number;
  /** Position in fractional grid coordinates. */
  x: number;
  y: number;
  /** Position at the previous logic tick (render interpolation). */
  prevX: number;
  prevY: number;

  private path: Point[] = [];
  private pathIndex = 0;

  constructor(id: number, x: number, y: number) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
  }

  get tile(): Point {
    return { x: Math.round(this.x), y: Math.round(this.y) };
  }

  setPath(path: Point[]): void {
    this.path = path;
    this.pathIndex = 0;
  }

  clearPath(): void {
    this.path = [];
    this.pathIndex = 0;
  }

  hasPath(): boolean {
    return this.pathIndex < this.path.length;
  }

  /** Final tile of the current path, or null. */
  pathTarget(): Point | null {
    return this.path.length > 0 ? this.path[this.path.length - 1] : null;
  }

  /** The waypoint the unit is currently heading for, or null. */
  nextWaypoint(): Point | null {
    return this.pathIndex < this.path.length ? this.path[this.pathIndex] : null;
  }

  /** Freeze interpolation when standing still. */
  rest(): void {
    this.prevX = this.x;
    this.prevY = this.y;
  }

  /**
   * Move along the current path. `speed` is tiles per tick.
   * Returns true when the path is finished after this step.
   */
  step(speed: number): boolean {
    this.prevX = this.x;
    this.prevY = this.y;
    let budget = speed;
    while (budget > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        this.x = target.x;
        this.y = target.y;
        budget -= dist;
        this.pathIndex++;
      } else {
        this.x += (dx / dist) * budget;
        this.y += (dy / dist) * budget;
        budget = 0;
      }
    }
    return this.pathIndex >= this.path.length;
  }
}
