import type { ResourceId } from '../data/config';
import type { Point } from '../world/IsoGrid';

/**
 * Carrier jobs.
 * - pickup:  walk to a building, take 1 output unit, bring it to the warehouse.
 * - deliver: walk to the warehouse, take 1 reserved unit, bring it to a building.
 */
export interface Job {
  kind: 'pickup' | 'deliver';
  buildingId: number;
  resource: ResourceId;
}

/**
 * Worker movement phases.
 * toPickup:  walking to where the goods are taken (building or warehouse).
 * toDropoff: walking to where the goods go, while carrying.
 * returning: walking back to the warehouse without a job.
 */
export type WorkerPhase = 'idle' | 'toPickup' | 'toDropoff' | 'returning';

export interface WorkerSave {
  id: number;
  x: number;
  y: number;
  phase: WorkerPhase;
  carrying: ResourceId | null;
  job: Job | null;
}

/**
 * A carrier unit. Holds position (fractional grid coordinates) and movement
 * state; job orchestration lives in EconomySystem. Rendering interpolates
 * between prevX/prevY and x/y.
 */
export class Worker {
  readonly id: number;
  /** Position in fractional grid coordinates. */
  x: number;
  y: number;
  /** Position at the previous logic tick (render interpolation). */
  prevX: number;
  prevY: number;

  phase: WorkerPhase = 'idle';
  job: Job | null = null;
  carrying: ResourceId | null = null;
  /** Set when population shrinks; despawn once the current job finishes. */
  pendingDespawn = false;

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

  hasPath(): boolean {
    return this.pathIndex < this.path.length;
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

  toSave(): WorkerSave {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      phase: this.phase,
      carrying: this.carrying,
      job: this.job ? { ...this.job } : null,
    };
  }

  static fromSave(s: WorkerSave): Worker {
    const w = new Worker(s.id, s.x, s.y);
    w.phase = s.phase;
    w.carrying = s.carrying;
    w.job = s.job ? { ...s.job } : null;
    return w;
  }
}
