import { events } from '../core/EventBus';
import {
  CARTS_PER_STABLE,
  CART_CAPACITY,
  CART_SPEED,
  FOREST_WOOD_PER_TILE,
  LUMBERJACK_RANGE,
  ORE_PER_TILE,
  RESOURCE_IDS,
  START_WORKERS,
  TICK_RATE,
  WOODCUTTER_CHOP_SECONDS,
  WORKER_SPEED,
  type ResourceId,
} from '../data/config';
import { Building } from '../entities/Building';
import { Woodcutter } from '../entities/Woodcutter';
import { Worker, type Job } from '../entities/Worker';
import { Terrain, type IsoGrid, type Point } from '../world/IsoGrid';
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
  /** Woodcutters out felling forest for the lumberjack huts. */
  gatherers: Woodcutter[];
  getWarehouse(): Building | null;
  nextEntityId(): number;
  /** Soldiers occupy population slots that carriers can no longer use. */
  getSoldierCount(): number;
  /** Global carrier speed multiplier (research). */
  getSpeedFactor(): number;
  /** A lumberjack consumed enough wood — fell one adjacent forest tile. */
  fellForestTile(building: Building): void;
  /** A woodcutter exhausted a specific forest tile — turn it to grass. */
  fellTileAt(tile: Point): void;
  /** A mine extracted enough ore — deplete one adjacent vein tile. */
  depleteOreTile(building: Building): void;
  /** Seasonal farm multiplier (autumn boost, winter standstill). */
  getFarmFactor(): number;
  onConstructionFinished(building: Building): void;
}

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
      if (b.owner !== 'player') continue;
      total += b.populationBonus;
    }
    return total;
  }

  populationUsed(): number {
    return (
      this.ctx.workers.filter((w) => w.job !== null).length +
      this.ctx.getSoldierCount() +
      this.assignedTotal()
    );
  }

  /** Population assigned as building staff. */
  assignedTotal(): number {
    let total = 0;
    for (const b of this.ctx.buildings.values()) {
      if (b.owner === 'player') total += b.assignedWorkers;
    }
    return total;
  }

  /** Carrier head count: population minus soldiers and building staff. */
  workerTarget(): number {
    return Math.max(0, this.populationTotal() - this.ctx.getSoldierCount() - this.assignedTotal());
  }

  tick(): void {
    this.tickCount++;
    for (const b of this.ctx.buildings.values()) {
      // The duel opponent's castle has no economy of its own.
      if (b.owner !== 'player') continue;
      // Lumberjacks need standing forest within their woodcutter's range.
      if (b.def.placement === 'adjacentForest' && b.def.recipe) {
        b.productionHalted =
          b.nearestTerrainTile(this.ctx.grid, Terrain.Forest, LUMBERJACK_RANGE) === null;
      }
      // Mines need an ore vein and deplete it (phase 20).
      if (b.def.placement === 'adjacentOre' && b.def.recipe) {
        b.productionHalted = b.adjacentTerrainTile(this.ctx.grid, Terrain.Ore) === null;
      }
      // Construction sites: build up once all materials arrived.
      if (b.underConstruction) {
        if (b.materialsMissing() === 0) {
          b.buildTicks--;
          if (b.buildTicks <= 0) {
            b.underConstruction = false;
            this.ctx.onConstructionFinished(b);
          }
        }
        continue;
      }
      // Lumberjacks don't produce passively — their woodcutter hauls the wood
      // in (see syncGatherers/advanceGatherers).
      if (b.def.placement === 'adjacentForest') continue;
      const before = b.outputStore;
      b.tickProduction(b.defId === 'farm' ? this.ctx.getFarmFactor() : 1);
      if (b.outputStore > before && b.def.placement === 'adjacentOre') {
        b.harvestProgress++;
        if (b.harvestProgress >= ORE_PER_TILE) {
          b.harvestProgress = 0;
          this.ctx.depleteOreTile(b);
        }
      }
    }
    this.syncWorkerCount();
    this.syncCartCount();
    this.syncGatherers();
    this.generateJobs();
    this.assignJobs();
    this.advanceWorkers();
    this.advanceGatherers();
    this.emitPopulationIfChanged();
  }

  /** Spawn/despawn carriers to match the hut-based population total. */
  private syncWorkerCount(): void {
    const { workers } = this.ctx;
    const total = this.workerTarget();
    const warehouse = this.ctx.getWarehouse();
    const footCount = (): number => workers.filter((w) => !w.isCart).length;
    while (footCount() < total && warehouse) {
      // Spawn on the front-most access tiles so idle carriers stay visible.
      const tiles = warehouse.accessTiles(this.ctx.grid).sort((a, b) => b.x + b.y - (a.x + a.y));
      const spawn = tiles[workers.length % Math.max(1, tiles.length)] ?? tiles[0];
      if (!spawn) break;
      workers.push(new Worker(this.ctx.nextEntityId(), spawn.x, spawn.y));
    }
    let excess = footCount() - total;
    if (excess > 0) {
      for (const w of workers) {
        if (excess <= 0) break;
        if (w.isCart) continue;
        if (w.job === null && !w.pendingDespawn) {
          w.pendingDespawn = true;
          excess--;
        }
      }
      // If all are busy, the flag is set once they finish their job.
      for (let i = workers.length - 1; i >= 0 && excess > 0; i--) {
        if (workers[i].isCart) continue;
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

  /** Ox carts come from stables; they cost no population. */
  private syncCartCount(): void {
    const { workers } = this.ctx;
    let stables = 0;
    for (const b of this.ctx.buildings.values()) {
      if (b.defId === 'stable' && b.owner === 'player') stables++;
    }
    const target = stables * CARTS_PER_STABLE;
    const carts = workers.filter((w) => w.isCart);
    if (carts.length < target) {
      const stable = [...this.ctx.buildings.values()].find((b) => b.defId === 'stable');
      const spawn = stable
        ?.accessTiles(this.ctx.grid)
        .sort((a, b) => b.x + b.y - (a.x + a.y))[0];
      if (spawn) workers.push(new Worker(this.ctx.nextEntityId(), spawn.x, spawn.y, true));
    } else if (carts.length > target) {
      for (const cart of carts) {
        if (carts.length - workers.filter((w) => w.isCart && w.pendingDespawn).length <= target) break;
        if (!cart.pendingDespawn && cart.job === null) {
          cart.pendingDespawn = true;
          break;
        }
      }
    }
  }

  /** One woodcutter per staffed lumberjack hut; despawn when the hut is gone. */
  private syncGatherers(): void {
    const { gatherers } = this.ctx;
    const staffedHuts = new Set<number>();
    for (const b of this.ctx.buildings.values()) {
      if (b.owner !== 'player') continue;
      if (b.def.placement !== 'adjacentForest' || !b.def.recipe) continue;
      if (b.underConstruction || b.assignedWorkers < b.workersRequired) continue;
      staffedHuts.add(b.id);
    }
    const existing = new Set(gatherers.map((g) => g.homeId));
    for (const id of staffedHuts) {
      if (existing.has(id)) continue;
      const hut = this.ctx.buildings.get(id);
      const spawn = hut?.accessTiles(this.ctx.grid)[0];
      if (spawn) gatherers.push(new Woodcutter(this.ctx.nextEntityId(), spawn.x, spawn.y, id));
    }
    // Drop woodcutters whose hut is gone or no longer staffed.
    for (let i = gatherers.length - 1; i >= 0; i--) {
      if (!staffedHuts.has(gatherers[i].homeId)) gatherers.splice(i, 1);
    }
  }

  /** Walk woodcutters between their hut and the forest, felling and hauling. */
  private advanceGatherers(): void {
    for (const g of this.ctx.gatherers) {
      const hut = this.ctx.buildings.get(g.homeId);
      if (!hut) continue;
      switch (g.phase) {
        case 'idle': {
          g.rest();
          // Wait while the hut's local store is full (carriers will free it).
          if (hut.outputStore >= hut.localCap) break;
          const target = hut.nearestTerrainTile(this.ctx.grid, Terrain.Forest, LUMBERJACK_RANGE);
          if (!target) break;
          const path = findPath(this.ctx.grid, g.tile, [target]);
          if (!path) break;
          g.target = target;
          g.setPath(path);
          g.phase = 'toTree';
          break;
        }
        case 'toTree': {
          if (this.stepGatherer(g)) {
            g.phase = 'chopping';
            g.chopTicks = Math.max(1, Math.round((WOODCUTTER_CHOP_SECONDS * TICK_RATE) / hut.levelFactor));
          }
          break;
        }
        case 'chopping': {
          g.rest();
          // The tree may have been felled by regrowth/another cause meanwhile.
          if (!g.target || this.ctx.grid.terrainAt(g.target.x, g.target.y) !== Terrain.Forest) {
            g.phase = 'idle';
            g.target = null;
            break;
          }
          if (--g.chopTicks > 0) break;
          // Chop done: one wood gathered; fell the tile once exhausted.
          g.carrying = true;
          hut.harvestProgress++;
          if (hut.harvestProgress >= FOREST_WOOD_PER_TILE) {
            hut.harvestProgress = 0;
            this.ctx.fellTileAt(g.target);
          }
          g.target = null;
          this.sendGathererHome(g, hut);
          break;
        }
        case 'returning': {
          if (this.stepGatherer(g)) {
            if (g.carrying) {
              hut.outputStore++;
              g.carrying = false;
            }
            g.phase = 'idle';
          }
          break;
        }
      }
    }
  }

  /** Path a woodcutter back to its hut; deposit on the spot if unreachable. */
  private sendGathererHome(g: Woodcutter, hut: Building): void {
    const path = findPath(this.ctx.grid, g.tile, hut.accessTiles(this.ctx.grid));
    if (path) {
      g.setPath(path);
      g.phase = 'returning';
    } else {
      if (g.carrying) {
        hut.outputStore++;
        g.carrying = false;
      }
      g.phase = 'idle';
    }
  }

  private stepGatherer(g: Woodcutter): boolean {
    const tile = g.tile;
    const roadBonus = this.ctx.grid.speedFactorAt(tile.x, tile.y);
    const base = WORKER_SPEED / TICK_RATE;
    return g.step(base * roadBonus * this.ctx.getSpeedFactor());
  }

  /** Create jobs from building demand/supply, bounded by reservations. */
  private generateJobs(): void {
    const warehouse = this.ctx.getWarehouse();
    if (!warehouse) return;
    for (const b of this.ctx.buildings.values()) {
      if (b.def.isWarehouse || b.owner !== 'player') continue;
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
      // Construction materials are hauled from the warehouse stock.
      if (b.underConstruction) {
        for (const res of Object.keys(b.materialsRemaining) as (keyof typeof b.materialsRemaining)[]) {
          while (
            (b.materialsRemaining[res] ?? 0) > 0 &&
            this.outstandingMaterials(b, res) < (b.materialsRemaining[res] ?? 0) &&
            this.ctx.store.available(res) > 0
          ) {
            b.incomingMaterials++;
            this.ctx.store.reserve(res);
            this.deliverQueue.push({
              job: { kind: 'deliver', buildingId: b.id, resource: res },
              notBefore: 0,
            });
          }
        }
        continue;
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

  /** Material units already promised to a site for one resource. */
  private outstandingMaterials(b: Building, res: string): number {
    let n = 0;
    for (const q of this.deliverQueue) {
      if (q.job.buildingId === b.id && q.job.resource === res) n++;
    }
    for (const w of this.ctx.workers) {
      if (w.job?.kind === 'deliver' && w.job.buildingId === b.id && w.job.resource === res) n++;
    }
    return n;
  }

  /** Hand queued jobs to idle workers; deliveries have priority. */
  private assignJobs(): void {
    const free = this.ctx.workers.filter(
      (w) => w.job === null && w.phase !== 'returning' && !w.pendingDespawn,
    );
    // Carts only haul warehouse pickups (their capacity shines there);
    // foot carriers do deliveries first, then help with pickups.
    const idleCarriers = free.filter((w) => !w.isCart);
    const idleCarts = free.filter((w) => w.isCart);
    const assign = (queue: QueuedJob[], pool: Worker[]): void => {
      for (let i = 0; i < queue.length && pool.length > 0; ) {
        const entry = queue[i];
        if (entry.notBefore > this.tickCount) {
          i++;
          continue;
        }
        const worker = pool[pool.length - 1];
        if (this.startJob(worker, entry.job)) {
          pool.pop();
          queue.splice(i, 1);
        } else {
          entry.notBefore = this.tickCount + JOB_RETRY_TICKS;
          i++;
        }
      }
    };
    assign(this.deliverQueue, idleCarriers);
    assign(this.pickupQueue, idleCarts);
    assign(this.pickupQueue, idleCarriers);
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
        worker.rest();
        continue;
      }
      const tile = worker.tile;
      const roadBonus = this.ctx.grid.speedFactorAt(tile.x, tile.y);
      const base = (worker.isCart ? CART_SPEED : WORKER_SPEED) / TICK_RATE;
      const arrived = worker.step(base * roadBonus * this.ctx.getSpeedFactor());
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
          // Carts opportunistically top up with unreserved output.
          const extra = worker.isCart
            ? Math.min(CART_CAPACITY - 1, Math.max(0, source.unclaimedOutput() - 1))
            : 0;
          source.outputStore -= 1 + extra;
          source.reservedOutput = Math.max(0, source.reservedOutput - 1);
          worker.carrying = job.resource;
          worker.carryingCount = 1 + extra;
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
          worker.carryingCount = 1;
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
          if (worker.carrying) this.ctx.store.add(worker.carrying, Math.max(1, worker.carryingCount));
          worker.carrying = null;
          worker.carryingCount = 0;
          worker.job = null;
          worker.phase = 'idle'; // already at the warehouse
        } else if (job) {
          const target = this.ctx.buildings.get(job.buildingId);
          if (target) {
            if (target.underConstruction) {
              const left = target.materialsRemaining[job.resource] ?? 0;
              if (left > 0) target.materialsRemaining[job.resource] = left - 1;
              target.incomingMaterials = Math.max(0, target.incomingMaterials - 1);
            } else {
              target.inputStore++;
              target.incomingInput = Math.max(0, target.incomingInput - 1);
            }
            worker.carrying = null;
            worker.carryingCount = 0;
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
          this.ctx.store.add(worker.carrying, Math.max(1, worker.carryingCount));
          worker.carrying = null;
          worker.carryingCount = 0;
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
        } else if (building.underConstruction) {
          building.incomingMaterials++;
          if (worker.phase === 'toPickup') this.ctx.store.reserve(job.resource);
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
