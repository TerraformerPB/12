import type { ResourceId } from '../data/config';
import { Unit } from './Unit';

/**
 * Carrier jobs. Every job moves goods between a production/consumer building
 * and a specific warehouse (local-storage model).
 * - pickup:   take output at building `buildingId`, store it in warehouse `warehouseId`.
 * - deliver:  take stock from warehouse `warehouseId`, bring it to consumer/site `buildingId`.
 * - transfer: take stock from warehouse `warehouseId`, bring it to warehouse `buildingId`.
 */
export interface Job {
  kind: 'pickup' | 'deliver' | 'transfer';
  /** Producer (pickup) / consumer or destination warehouse (deliver, transfer). */
  buildingId: number;
  /** The warehouse end: destination (pickup) or source (deliver, transfer). */
  warehouseId: number;
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
  /** Since save version 8 (ox carts haul several goods per trip). */
  isCart: boolean;
  carryingCount: number;
}

/**
 * A carrier unit. Movement comes from `Unit`; job orchestration lives in
 * EconomySystem.
 */
export class Worker extends Unit {
  phase: WorkerPhase = 'idle';
  job: Job | null = null;
  carrying: ResourceId | null = null;
  /** Units of `carrying` on board (carts haul up to CART_CAPACITY). */
  carryingCount = 0;
  /** Ox carts: slower, bigger loads, provided by stables (no population). */
  readonly isCart: boolean;
  /** Set when population shrinks; despawn once the current job finishes. */
  pendingDespawn = false;

  constructor(id: number, x: number, y: number, isCart = false) {
    super(id, x, y);
    this.isCart = isCart;
  }

  toSave(): WorkerSave {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      phase: this.phase,
      carrying: this.carrying,
      job: this.job ? { ...this.job } : null,
      isCart: this.isCart,
      carryingCount: this.carryingCount,
    };
  }

  static fromSave(s: WorkerSave): Worker {
    const w = new Worker(s.id, s.x, s.y, s.isCart);
    w.phase = s.phase;
    w.carrying = s.carrying;
    w.carryingCount = s.carryingCount;
    w.job = s.job ? { ...s.job } : null;
    return w;
  }
}
