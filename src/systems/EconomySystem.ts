import { events } from '../core/EventBus';
import {
  RESOURCE_IDS,
  START_WORKERS,
  TICK_RATE,
  WORKER_SPEED,
  type ResourceId,
} from '../data/config';
import { Building } from '../entities/Building';
import { Worker, type Job } from '../entities/Worker';
import type { IsoGrid, Point } from '../world/IsoGrid';
import { findPath } from '../world/Pathfinding';

/** Global (warehouse) resource stock with reservations for pending jobs. */
export class ResourceStore {
  private amounts: Record<ResourceId, number>;
  private reserved: Record<ResourceId, number>;

  constructor(initial?: Partial<Record<ResourceId, number>>) {
    this.amounts = Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as Record<ResourceId, number>;
    this.reserved = Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as Record<ResourceId, number>;
    if (initial) {
      for (const r of RESOURCE_IDS) this.amounts[r] = initial[r] ?? 0;
    }
    // Note: no emit here — the game emits once everything is wired up.
  }

  get(resource: ResourceId): number {
    return this.amounts[resource];
  }

  snapshot(): Record<ResourceId, number> {
    return { ...this.amounts };
  }

  /** Units neither stocked out nor promised to a delivery job. */
  available(resource: ResourceId): number {
    return this.amounts[resource] - this.reserved[resource];
  }

  add(resource: ResourceId, n: number): void {
    this.amounts[resource] += n;
    this.emitChanged();
  }

  reserve(resource: ResourceId): void {
    this.reserved[resource]++;
  }

  releaseReservation(resource: ResourceId): void {
    this.reserved[resource] = Math.max(0, this.reserved[resource] - 1);
  }

  /** Consume one previously reserved unit (carrier picking up at warehouse). */
  takeReserved(resource: ResourceId): boolean {
    if (this.amounts[resource] <= 0) return false;
    this.amounts[resource]--;
    this.reserved[resource] = Math.max(0, this.reserved[resource] - 1);
    this.emitChanged();
    return true;
  }

  canAfford(cost: Partial<Record<ResourceId, number>>): boolean {
    return RESOURCE_IDS.every((r) => this.amounts[r] >= (cost[r] ?? 0));
  }

  pay(cost: Partial<Record<ResourceId, number>>): void {
    for (const r of RESOURCE_IDS) this.amounts[r] -= cost[r] ?? 0;
    this.emitChanged();
  }

  emitChanged(): void {
    events.emit('resources:changed', this.snapshot());
  }
}

/** What the economy needs from the game world. */
export interface EconomyContext {
  grid: IsoGrid;
  store: ResourceStore;
  buildings: Map<number, Building>;
  workers: Worker[];
  getWarehouse(): Building | null;
  nextEntityId(): number;
}

const SPEED_PER_TICK = WORKER_SPEED / TICK_RATE;
/** Ticks to wait before retrying a job whose path could not be found. */
const JOB_RETRY_TICKS = 2 * TICK_RATE;

interface QueuedJob {
  job: Job;
  notBefore: number;
}

/**
 * Production, carrier job queue (FIFO, deliveries before pickups) and
 * worker movement. All resource flow between buildings and the warehouse
 * passes through here.
 */
export class EconomySystem {
  private ctx: EconomyContext;
  private deliverQueue: QueuedJob[] = [];
  private pickupQueue: QueuedJob[] = [];
  private tickCount = 0;
  private lastPopUsed = -1;
  private lastPopTotal = -1;

  constructor(ctx: EconomyContext) {
    this.ctx = ctx;
  }

  populationTotal(): number {
    let total = START_WORKERS;
    for (const b of this.ctx.buildings.values()) {
      total += b.def.population ?? 0;
    }
    return total;
  }

  populationUsed(): number {
    return this.ctx.workers.filter((w) => w.job !== null).length;
  }

  tick(): void {
    this.tickCount++;
    for (const b of this.ctx.buildings.values()) b.tickProduction();
    this.syncWorkerCount();
    this.generateJobs();
    this.assignJobs();
    this.advanceWorkers();
    this.emitPopulationIfChanged();
  }

  /** Spawn/despawn carriers to match the hut-based population total. */
  private syncWorkerCount(): void {
    const { workers } = this.ctx;
    const total = this.populationTotal();
    const warehouse = this.ctx.getWarehouse();
    while (workers.length < total && warehouse) {
      // Spawn on the front-most access tiles so idle carriers stay visible.
      const tiles = warehouse.accessTiles(this.ctx.grid).sort((a, b) => b.x + b.y - (a.x + a.y));
      const spawn = tiles[workers.length % Math.max(1, tiles.length)] ?? tiles[0];
      if (!spawn) break;
      workers.push(new Worker(this.ctx.nextEntityId(), spawn.x, spawn.y));
    }
    let excess = workers.length - total;
    if (excess > 0) {
      for (const w of workers) {
        if (excess <= 0) break;
        if (w.job === null && !w.pendingDespawn) {
          w.pendingDespawn = true;
          excess--;
        }
      }
      // If all are busy, the flag is set once they finish their job.
      for (let i = workers.length - 1; i >= 0 && excess > 0; i--) {
        if (!workers[i].pendingDespawn && workers[i].job !== null) {
          workers[i].pendingDespawn = true;
          excess--;
        }
      }
    }
    for (let i = workers.length - 1; i >= 0; i--) {
      if (workers[i].pendingDespawn && workers[i].job === null) {
        workers.splice(i, 1);
      }
    }
  }

  /** Create jobs from building demand/supply, bounded by reservations. */
  private generateJobs(): void {
    const warehouse = this.ctx.getWarehouse();
    if (!warehouse) return;
    for (const b of this.ctx.buildings.values()) {
      if (b.def.isWarehouse) continue;
      // Pickups: bring finished output to the warehouse.
      while (b.unclaimedOutput() > 0) {
        const output = b.def.recipe?.output;
        if (!output) break;
        b.reservedOutput++;
        this.pickupQueue.push({
          job: { kind: 'pickup', buildingId: b.id, resource: output },
          notBefore: 0,
        });
      }
      // Deliveries: fill processor input from warehouse stock.
      const input = b.inputResource();
      if (input) {
        while (b.inputDemand() > 0 && this.ctx.store.available(input) > 0) {
          b.incomingInput++;
          this.ctx.store.reserve(input);
          this.deliverQueue.push({
            job: { kind: 'deliver', buildingId: b.id, resource: input },
            notBefore: 0,
          });
        }
      }
    }
  }

  /** Hand queued jobs to idle workers; deliveries have priority. */
  private assignJobs(): void {
    const idle = this.ctx.workers.filter(
      (w) => w.job === null && w.phase !== 'returning' && !w.pendingDespawn,
    );
    if (idle.length === 0) return;
    for (const queue of [this.deliverQueue, this.pickupQueue]) {
      for (let i = 0; i < queue.length && idle.length > 0; ) {
        const entry = queue[i];
        if (entry.notBefore > this.tickCount) {
          i++;
          continue;
        }
        const worker = idle[idle.length - 1];
        if (this.startJob(worker, entry.job)) {
          idle.pop();
          queue.splice(i, 1);
        } else {
          entry.notBefore = this.tickCount + JOB_RETRY_TICKS;
          i++;
        }
      }
    }
  }

  /** Route the worker to the job's first stop. Returns false if unreachable. */
  private startJob(worker: Worker, job: Job): boolean {
    const firstStop =
      job.kind === 'pickup' ? this.ctx.buildings.get(job.buildingId) : this.ctx.getWarehouse();
    if (!firstStop) return false;
    const path = this.pathTo(worker.tile, firstStop);
    if (!path) return false;
    worker.job = job;
    worker.phase = 'toPickup';
    worker.setPath(path);
    return true;
  }

  private pathTo(from: Point, building: Building): Point[] | null {
    return findPath(this.ctx.grid, from, building.accessTiles(this.ctx.grid));
  }

  private advanceWorkers(): void {
    for (const worker of this.ctx.workers) {
      if (worker.phase === 'idle') {
        worker.prevX = worker.x;
        worker.prevY = worker.y;
        continue;
      }
      const arrived = worker.step(SPEED_PER_TICK);
      if (!arrived) continue;
      this.onArrival(worker);
    }
  }

  private onArrival(worker: Worker): void {
    const warehouse = this.ctx.getWarehouse();
    switch (worker.phase) {
      case 'toPickup': {
        const job = worker.job;
        if (!job) {
          worker.phase = 'idle';
          return;
        }
        if (job.kind === 'pickup') {
          const source = this.ctx.buildings.get(job.buildingId);
          if (!source || source.outputStore <= 0) {
            // Building vanished or output gone — abandon the job.
            if (source) source.reservedOutput = Math.max(0, source.reservedOutput - 1);
            this.finishJob(worker);
            return;
          }
          source.outputStore--;
          source.reservedOutput = Math.max(0, source.reservedOutput - 1);
          worker.carrying = job.resource;
          if (!warehouse) {
            this.finishJob(worker);
            return;
          }
          const path = this.pathTo(worker.tile, warehouse);
          if (!path) {
            // Stranded: drop the goods (lost) and go idle in place.
            worker.carrying = null;
            this.finishJob(worker);
            return;
          }
          worker.phase = 'toDropoff';
          worker.setPath(path);
        } else {
          // Delivery: take the reserved unit from the warehouse.
          const target = this.ctx.buildings.get(job.buildingId);
          if (!target || !this.ctx.store.takeReserved(job.resource)) {
            if (target) target.incomingInput = Math.max(0, target.incomingInput - 1);
            else this.ctx.store.releaseReservation(job.resource);
            this.finishJob(worker);
            return;
          }
          worker.carrying = job.resource;
          const path = this.pathTo(worker.tile, target);
          if (!path) {
            // Target unreachable: return the unit to stock.
            this.ctx.store.add(job.resource, 1);
            target.incomingInput = Math.max(0, target.incomingInput - 1);
            worker.carrying = null;
            this.finishJob(worker);
            return;
          }
          worker.phase = 'toDropoff';
          worker.setPath(path);
        }
        return;
      }
      case 'toDropoff': {
        const job = worker.job;
        if (job?.kind === 'pickup') {
          if (worker.carrying) this.ctx.store.add(worker.carrying, 1);
          worker.carrying = null;
          worker.job = null;
          worker.phase = 'idle'; // already at the warehouse
        } else if (job) {
          const target = this.ctx.buildings.get(job.buildingId);
          if (target) {
            target.inputStore++;
            target.incomingInput = Math.max(0, target.incomingInput - 1);
            worker.carrying = null;
          } else if (worker.carrying) {
            // Target demolished mid-delivery: carry the unit back.
            worker.job = null;
            this.finishJob(worker);
            return;
          }
          worker.job = null;
          this.finishJob(worker);
          return;
        }
        return;
      }
      case 'returning': {
        // Arrived back at the warehouse; deposit anything still carried.
        if (worker.carrying) {
          this.ctx.store.add(worker.carrying, 1);
          worker.carrying = null;
        }
        worker.phase = 'idle';
        return;
      }
      case 'idle':
        return;
    }
  }

  /** Clear the job and send the worker home to the warehouse. */
  private finishJob(worker: Worker): void {
    worker.job = null;
    const warehouse = this.ctx.getWarehouse();
    if (!warehouse) {
      worker.phase = 'idle';
      return;
    }
    const path = this.pathTo(worker.tile, warehouse);
    if (path && path.length > 1) {
      worker.phase = 'returning';
      worker.setPath(path);
    } else {
      if (worker.carrying) {
        this.ctx.store.add(worker.carrying, 1);
        worker.carrying = null;
      }
      worker.phase = 'idle';
    }
  }

  /** Cancel queued and in-flight jobs touching a demolished building. */
  onBuildingRemoved(buildingId: number): void {
    const drop = (queue: QueuedJob[]): void => {
      for (let i = queue.length - 1; i >= 0; i--) {
        const { job } = queue[i];
        if (job.buildingId !== buildingId) continue;
        if (job.kind === 'deliver') this.ctx.store.releaseReservation(job.resource);
        queue.splice(i, 1);
      }
    };
    drop(this.deliverQueue);
    drop(this.pickupQueue);

    for (const worker of this.ctx.workers) {
      const job = worker.job;
      if (!job || job.buildingId !== buildingId) continue;
      if (worker.phase === 'toPickup') {
        // Not carrying yet; release the warehouse reservation for deliveries.
        if (job.kind === 'deliver') this.ctx.store.releaseReservation(job.resource);
        this.finishJob(worker);
      }
      // toDropoff with a pickup job targets the warehouse — unaffected.
      // toDropoff with a delivery job is handled on arrival (target gone →
      // worker carries the unit back to the warehouse).
    }
  }

  /** Rebuild reservations and paths after loading a savegame. */
  restoreAfterLoad(): void {
    const warehouse = this.ctx.getWarehouse();
    for (const worker of this.ctx.workers) {
      const job = worker.job;
      if (job) {
        const building = this.ctx.buildings.get(job.buildingId);
        if (!building) {
          worker.job = null;
          worker.phase = worker.carrying ? 'returning' : 'idle';
        } else if (job.kind === 'pickup') {
          if (worker.phase === 'toPickup') building.reservedOutput++;
        } else {
          building.incomingInput++;
          if (worker.phase === 'toPickup') this.ctx.store.reserve(job.resource);
        }
      }
      // Recompute the path toward the current phase target.
      const target = this.phaseTarget(worker);
      if (target) {
        const path = this.pathTo(worker.tile, target);
        if (path) worker.setPath(path);
        else this.finishJob(worker);
      } else if (worker.phase !== 'idle' && warehouse) {
        this.finishJob(worker);
      }
    }
    this.emitPopulationIfChanged();
  }

  private phaseTarget(worker: Worker): Building | null {
    const warehouse = this.ctx.getWarehouse();
    const job = worker.job;
    switch (worker.phase) {
      case 'toPickup':
        if (!job) return null;
        return job.kind === 'pickup' ? (this.ctx.buildings.get(job.buildingId) ?? null) : warehouse;
      case 'toDropoff':
        if (!job) return null;
        return job.kind === 'pickup' ? warehouse : (this.ctx.buildings.get(job.buildingId) ?? null);
      case 'returning':
        return warehouse;
      case 'idle':
        return null;
    }
  }

  private emitPopulationIfChanged(): void {
    const used = this.populationUsed();
    const total = this.populationTotal();
    if (used !== this.lastPopUsed || total !== this.lastPopTotal) {
      this.lastPopUsed = used;
      this.lastPopTotal = total;
      events.emit('population:changed', { used, total });
    }
  }
}
