import type { ResourceId } from '../data/config';
import { Unit } from './Unit';

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
 * A carrier unit. Movement comes from `Unit`; job orchestration lives in
 * EconomySystem.
 */
export class Worker extends Unit {
  phase: WorkerPhase = 'idle';
  job: Job | null = null;
  carrying: ResourceId | null = null;
  /** Set when population shrinks; despawn once the current job finishes. */
  pendingDespawn = false;

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
