import { events } from '../core/EventBus';
import {
  CARTS_PER_STABLE,
  CART_CAPACITY,
  CART_SPEED,
  FOREST_WOOD_PER_TILE,
  ORE_PER_TILE,
  RESOURCE_IDS,
  START_WORKERS,
  TICK_RATE,
  WORKER_SPEED,
  type ResourceId,
} from '../data/config';
import { Building } from '../entities/Building';
import { Worker, type Job } from '../entities/Worker';
import { Terrain, type IsoGrid, type Point } from '../world/IsoGrid';
import { findPath } from '../world/Pathfinding';

/**
 * Network-wide resource view (the "stockpile" the player sees). Goods are
 * physically held in individual warehouses (Building.stock); this facade just
 * sums them so costs, the HUD, the market and saves keep working unchanged.
 * A small `loose` pool catches goods that have nowhere physical to go (e.g.
 * no warehouse standing) so nothing is ever lost.
 */
export class ResourceStore {
  private getWarehouses: () => Building[];
  private getMain: () => Building | null;
  private loose: Record<ResourceId, number>;

  constructor(getWarehouses?: () => Building[], getMain?: () => Building | null) {
    // Without warehouse accessors the store is "detached": it operates purely
    // on the loose pool (used by duels and unit tests).
    this.getWarehouses = getWarehouses ?? (() => []);
    this.getMain = getMain ?? (() => null);
    this.loose = Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as Record<ResourceId, number>;
  }

  get(resource: ResourceId): number {
    let n = this.loose[resource];
    for (const w of this.getWarehouses()) n += w.stock[resource];
    return n;
  }

  snapshot(): Record<ResourceId, number> {
    return Object.fromEntries(RESOURCE_IDS.map((r) => [r, this.get(r)])) as Record<ResourceId, number>;
  }

  /** Units not promised to an outgoing carrier job. */
  available(resource: ResourceId): number {
    let n = this.loose[resource];
    for (const w of this.getWarehouses()) n += w.availableStock(resource);
    return n;
  }

  canAfford(cost: Partial<Record<ResourceId, number>>): boolean {
    return RESOURCE_IDS.every((r) => this.get(r) >= (cost[r] ?? 0));
  }

  /** Consume goods from the network (loose pool first, then warehouses). */
  pay(cost: Partial<Record<ResourceId, number>>): void {
    for (const r of RESOURCE_IDS) {
      let need = cost[r] ?? 0;
      if (need <= 0) continue;
      const fromLoose = Math.min(this.loose[r], need);
      this.loose[r] -= fromLoose;
      need -= fromLoose;
      for (const w of this.getWarehouses()) {
        if (need <= 0) break;
        const take = Math.min(w.stock[r], need);
        w.stock[r] -= take;
        if (w.reservedStock[r] > w.stock[r]) w.reservedStock[r] = w.stock[r];
        need -= take;
      }
    }
    this.emitChanged();
  }

  /** Add goods to the network (market/diplomacy/refunds): main warehouse first. */
  add(resource: ResourceId, n: number): void {
    if (n <= 0) return;
    let left = n;
    const ordered = this.warehousesMainFirst();
    for (const w of ordered) {
      if (left <= 0) break;
      const space = Math.max(0, w.storageCapacity - w.totalStored());
      const put = Math.min(space, left);
      w.stock[resource] += put;
      left -= put;
    }
    if (left > 0) this.loose[resource] += left;
    this.emitChanged();
  }

  /** Goods stranded with no warehouse (rarely used). */
  looseSnapshot(): Record<ResourceId, number> {
    return { ...this.loose };
  }

  setLoose(values: Partial<Record<ResourceId, number>>): void {
    for (const r of RESOURCE_IDS) this.loose[r] = values[r] ?? 0;
  }

  private warehousesMainFirst(): Building[] {
    const main = this.getMain();
    const list = this.getWarehouses();
    if (!main) return list;
    return [main, ...list.filter((w) => w.id !== main.id)];
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
  /** Soldiers occupy population slots that carriers can no longer use. */
  getSoldierCount(): number;
  /** Global carrier speed multiplier (research). */
  getSpeedFactor(): number;
  /** A lumberjack consumed enough wood — fell one adjacent forest tile. */
  fellForestTile(building: Building): void;
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
 * Production, carrier job queue and worker movement. All resource flow between
 * buildings and the (now multiple, capacity-limited) warehouses passes here.
 */
export class EconomySystem {
  private ctx: EconomyContext;
  private deliverQueue: QueuedJob[] = [];
  private pickupQueue: QueuedJob[] = [];
  private transferQueue: QueuedJob[] = [];
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

  /** All standing player warehouses that can hold goods. */
  private warehouses(): Building[] {
    const list: Building[] = [];
    for (const b of this.ctx.buildings.values()) {
      if (b.isWarehouse && b.owner === 'player' && !b.underConstruction) list.push(b);
    }
    return list;
  }

  tick(): void {
    this.tickCount++;
    for (const b of this.ctx.buildings.values()) {
      // The duel opponent's castle has no economy of its own.
      if (b.owner !== 'player') continue;
      // Lumberjacks need standing forest and slowly consume it.
      if (b.defId === 'lumberjack' && b.def.recipe) {
        b.productionHalted = b.terrainTileInRange(this.ctx.grid, Terrain.Forest, 4) === null;
      } else if (b.def.placement === 'adjacentForest' && b.def.recipe) {
        b.productionHalted = b.adjacentTerrainTile(this.ctx.grid, Terrain.Forest) === null;
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
      const before = b.outputStore;
      b.tickProduction(b.defId === 'farm' ? this.ctx.getFarmFactor() : 1);
      if (b.outputStore > before && b.def.placement === 'adjacentForest') {
        b.harvestProgress++;
        if (b.harvestProgress >= FOREST_WOOD_PER_TILE) {
          b.harvestProgress = 0;
          this.ctx.fellForestTile(b);
        }
      }
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
    this.generateJobs();
    this.assignJobs();
    this.advanceWorkers();
    this.emitPopulationIfChanged();
  }

  /** Spawn/despawn carriers to match the hut-based population total. */
  private syncWorkerCount(): void {
    const { workers } = this.ctx;
    const total = this.workerTarget();
    const warehouse = this.ctx.getWarehouse();
    const footCount = (): number => workers.filter((w) => !w.isCart).length;
    while (footCount() < total && warehouse) {
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
      if (b.defId === 'stable' && b.owner === 'player' && !b.underConstruction) stables++;
    }
    const target = stables * CARTS_PER_STABLE;
    const carts = workers.filter((w) => w.isCart);
    if (carts.length < target) {
      const stable = [...this.ctx.buildings.values()].find(
        (b) => b.defId === 'stable' && b.owner === 'player' && !b.underConstruction,
      );
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

  // --- warehouse selection -------------------------------------------------

  private dist(b: Building, p: Point): number {
    return Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
  }

  /** Nearest warehouse that still has free capacity for an incoming unit. */
  private nearestDepot(point: Point): Building | null {
    let best: Building | null = null;
    let min = Infinity;
    for (const w of this.warehouses()) {
      if (w.freeCapacity() <= 0) continue;
      const d = this.dist(w, point);
      if (d < min) {
        min = d;
        best = w;
      }
    }
    return best;
  }

  /** Nearest warehouse holding an unreserved unit of the resource. */
  private nearestSource(point: Point, r: ResourceId): Building | null {
    let best: Building | null = null;
    let min = Infinity;
    for (const w of this.warehouses()) {
      if (w.availableStock(r) <= 0) continue;
      const d = this.dist(w, point);
      if (d < min) {
        min = d;
        best = w;
      }
    }
    return best;
  }

  /** Units of a resource already heading into a warehouse (pickups/transfers). */
  private incomingResource(whId: number, r: ResourceId): number {
    let n = 0;
    const count = (j: Job): void => {
      if (j.resource !== r) return;
      if (j.kind === 'pickup' && j.warehouseId === whId) n++;
      else if (j.kind === 'transfer' && j.buildingId === whId) n++;
    };
    for (const q of this.pickupQueue) count(q.job);
    for (const q of this.transferQueue) count(q.job);
    for (const w of this.ctx.workers) if (w.job) count(w.job);
    return n;
  }

  /** Create jobs from building demand/supply, bounded by reservations. */
  private generateJobs(): void {
    if (this.warehouses().length === 0) return;
    for (const b of this.ctx.buildings.values()) {
      if (b.owner !== 'player') continue;
      if (b.isWarehouse && !b.underConstruction) continue;

      // Pickups: bring finished output to the nearest warehouse with space.
      while (b.unclaimedOutput() > 0) {
        const output = b.def.recipe?.output;
        if (!output) break;
        const depot = this.nearestDepot(b);
        if (!depot) break; // all warehouses full — output backs up at the producer
        b.reservedOutput++;
        depot.incomingStock++;
        this.pickupQueue.push({
          job: { kind: 'pickup', buildingId: b.id, warehouseId: depot.id, resource: output },
          notBefore: 0,
        });
      }

      // Construction materials are hauled from warehouse stock.
      if (b.underConstruction) {
        for (const res of Object.keys(b.materialsRemaining) as ResourceId[]) {
          while (
            (b.materialsRemaining[res] ?? 0) > 0 &&
            this.outstandingMaterials(b, res) < (b.materialsRemaining[res] ?? 0)
          ) {
            const source = this.nearestSource(b, res);
            if (!source) break;
            b.incomingMaterials++;
            source.reservedStock[res]++;
            this.deliverQueue.push({
              job: { kind: 'deliver', buildingId: b.id, warehouseId: source.id, resource: res },
              notBefore: 0,
            });
          }
        }
        continue;
      }

      // Deliveries: fill processor input from warehouse stock.
      const input = b.inputResource();
      if (input) {
        while (b.inputDemand() > 0) {
          const source = this.nearestSource(b, input);
          if (!source) break;
          b.incomingInput++;
          source.reservedStock[input]++;
          this.deliverQueue.push({
            job: { kind: 'deliver', buildingId: b.id, warehouseId: source.id, resource: input },
            notBefore: 0,
          });
        }
      }
    }

    this.generateTransfers();
  }

  /** Queue one transfer of `r` from `src` to `dest`, reserving both ends. */
  private queueTransfer(src: Building, dest: Building, r: ResourceId): void {
    src.reservedStock[r]++;
    dest.incomingStock++;
    this.transferQueue.push({
      job: { kind: 'transfer', buildingId: dest.id, warehouseId: src.id, resource: r },
      notBefore: 0,
    });
  }

  /**
   * Semi-automatic balancing. Two passes, both throttled per tick:
   *  1. Pull goods toward any warehouse below its target (Sollwert).
   *  2. Drain leftover surplus into the main warehouse, so outlying stores act
   *     as short-haul buffers and the hub stays the default collection point.
   */
  private generateTransfers(): void {
    const PER_TICK = 6;
    const all = this.warehouses();
    const main = this.ctx.getWarehouse();

    // 1) fill targets
    for (const dest of all) {
      for (const r of RESOURCE_IDS) {
        if (dest.targetFor(r) <= 0) continue;
        let deficit =
          dest.targetFor(r) - dest.availableStock(r) - this.incomingResource(dest.id, r);
        deficit = Math.min(deficit, dest.freeCapacity(), PER_TICK);
        for (const src of all) {
          if (deficit <= 0) break;
          if (src.id === dest.id) continue;
          let surplus = src.availableStock(r) - src.targetFor(r);
          while (deficit > 0 && surplus > 0) {
            this.queueTransfer(src, dest, r);
            deficit--;
            surplus--;
          }
        }
      }
    }

    // 2) collect surplus into the main hub
    if (main && main.isWarehouse && !main.underConstruction) {
      for (const src of all) {
        if (src.id === main.id) continue;
        for (const r of RESOURCE_IDS) {
          let move = Math.min(
            src.availableStock(r) - src.targetFor(r),
            main.freeCapacity(),
            PER_TICK,
          );
          while (move > 0) {
            this.queueTransfer(src, main, r);
            move--;
          }
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
    // Foot carriers run deliveries first; carts shine at bulk pickups/transfers.
    assign(this.deliverQueue, idleCarriers);
    assign(this.pickupQueue, idleCarts);
    assign(this.transferQueue, idleCarts);
    assign(this.pickupQueue, idleCarriers);
    assign(this.transferQueue, idleCarriers);
  }

  /** First stop of a job: producer (pickup) or the source warehouse otherwise. */
  private startJob(worker: Worker, job: Job): boolean {
    const firstStop =
      job.kind === 'pickup'
        ? this.ctx.buildings.get(job.buildingId)
        : this.ctx.buildings.get(job.warehouseId);
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

  private getNearestWarehouse(point: Point): Building | null {
    let nearest: Building | null = null;
    let minDist = Infinity;
    for (const b of this.warehouses()) {
      const dist = this.dist(b, point);
      if (dist < minDist) {
        minDist = dist;
        nearest = b;
      }
    }
    return nearest ?? this.ctx.getWarehouse();
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
    switch (worker.phase) {
      case 'toPickup':
        this.onPickupArrival(worker);
        return;
      case 'toDropoff':
        this.onDropoffArrival(worker);
        return;
      case 'returning': {
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

  private onPickupArrival(worker: Worker): void {
    const job = worker.job;
    if (!job) {
      worker.phase = 'idle';
      return;
    }
    if (job.kind === 'pickup') {
      const source = this.ctx.buildings.get(job.buildingId);
      const depot = this.ctx.buildings.get(job.warehouseId);
      if (!source || source.outputStore <= 0) {
        if (source) source.reservedOutput = Math.max(0, source.reservedOutput - 1);
        if (depot) depot.incomingStock = Math.max(0, depot.incomingStock - 1);
        this.finishJob(worker);
        return;
      }
      // Carts top up with spare output, capped by the depot's free capacity.
      const spareDepot = depot ? Math.max(0, depot.freeCapacity()) : 0;
      const extra = worker.isCart
        ? Math.min(CART_CAPACITY - 1, Math.max(0, source.unclaimedOutput() - 1), spareDepot)
        : 0;
      source.outputStore -= 1 + extra;
      source.reservedOutput = Math.max(0, source.reservedOutput - 1);
      if (depot && extra > 0) depot.incomingStock += extra; // reserve the extra capacity
      worker.carrying = job.resource;
      worker.carryingCount = 1 + extra;
      const target = depot ?? this.nearestDepot(worker.tile) ?? this.getNearestWarehouse(worker.tile);
      if (!target) {
        this.finishJob(worker);
        return;
      }
      const path = this.pathTo(worker.tile, target);
      if (!path) {
        worker.carrying = null;
        worker.carryingCount = 0;
        if (depot) depot.incomingStock = Math.max(0, depot.incomingStock - (1 + extra));
        this.finishJob(worker);
        return;
      }
      worker.job = { ...job, warehouseId: target.id };
      worker.phase = 'toDropoff';
      worker.setPath(path);
      return;
    }

    // deliver / transfer: take a reserved unit from the source warehouse.
    const source = this.ctx.buildings.get(job.warehouseId);
    if (!source || source.stock[job.resource] <= 0) {
      if (source) source.reservedStock[job.resource] = Math.max(0, source.reservedStock[job.resource] - 1);
      this.releaseDest(job);
      this.finishJob(worker);
      return;
    }
    source.stock[job.resource]--;
    source.reservedStock[job.resource] = Math.max(0, source.reservedStock[job.resource] - 1);
    this.ctx.store.emitChanged();
    worker.carrying = job.resource;
    worker.carryingCount = 1;
    const target =
      job.kind === 'transfer' ? this.ctx.buildings.get(job.buildingId) : this.ctx.buildings.get(job.buildingId);
    if (!target) {
      // Destination gone: put the unit back into the network.
      this.releaseDest(job);
      worker.carrying = null;
      this.ctx.store.add(job.resource, 1);
      this.finishJob(worker);
      return;
    }
    const path = this.pathTo(worker.tile, target);
    if (!path) {
      this.releaseDest(job);
      worker.carrying = null;
      this.ctx.store.add(job.resource, 1);
      this.finishJob(worker);
      return;
    }
    worker.phase = 'toDropoff';
    worker.setPath(path);
  }

  private onDropoffArrival(worker: Worker): void {
    const job = worker.job;
    if (!job) {
      worker.phase = 'idle';
      return;
    }
    const count = Math.max(1, worker.carryingCount);
    if (job.kind === 'pickup' || job.kind === 'transfer') {
      const depot = this.ctx.buildings.get(job.kind === 'pickup' ? job.warehouseId : job.buildingId);
      if (depot && depot.isWarehouse) {
        depot.stock[job.resource] += count;
        depot.incomingStock = Math.max(0, depot.incomingStock - count);
        this.ctx.store.emitChanged();
      } else if (worker.carrying) {
        // Warehouse vanished mid-haul — keep the goods in the network.
        this.ctx.store.add(worker.carrying, count);
      }
      worker.carrying = null;
      worker.carryingCount = 0;
      worker.job = null;
      worker.phase = 'idle';
      return;
    }

    // deliver to a consumer / construction site
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
      worker.job = null;
      this.finishJob(worker);
      return;
    }
    worker.job = null;
    this.finishJob(worker);
  }

  /** Release the destination-side reservation of a deliver/transfer job. */
  private releaseDest(job: Job): void {
    const dest = this.ctx.buildings.get(job.buildingId);
    if (!dest) return;
    if (job.kind === 'transfer') {
      dest.incomingStock = Math.max(0, dest.incomingStock - 1);
    } else if (dest.underConstruction) {
      dest.incomingMaterials = Math.max(0, dest.incomingMaterials - 1);
    } else {
      dest.incomingInput = Math.max(0, dest.incomingInput - 1);
    }
  }

  /** Clear the job and send the worker home to the nearest warehouse. */
  private finishJob(worker: Worker): void {
    worker.job = null;
    const wh = this.getNearestWarehouse(worker.tile);
    if (!wh) {
      worker.phase = 'idle';
      return;
    }
    const path = this.pathTo(worker.tile, wh);
    if (path && path.length > 1) {
      worker.phase = 'returning';
      worker.setPath(path);
    } else {
      if (worker.carrying) {
        this.ctx.store.add(worker.carrying, Math.max(1, worker.carryingCount));
        worker.carrying = null;
        worker.carryingCount = 0;
      }
      worker.phase = 'idle';
    }
  }

  /** Cancel queued and in-flight jobs touching a demolished building. */
  onBuildingRemoved(buildingId: number): void {
    const drop = (queue: QueuedJob[]): void => {
      for (let i = queue.length - 1; i >= 0; i--) {
        const { job } = queue[i];
        if (job.buildingId !== buildingId && job.warehouseId !== buildingId) continue;
        this.releaseQueuedReservations(job);
        queue.splice(i, 1);
      }
    };
    drop(this.deliverQueue);
    drop(this.pickupQueue);
    drop(this.transferQueue);

    for (const worker of this.ctx.workers) {
      const job = worker.job;
      if (!job) continue;
      if (job.buildingId !== buildingId && job.warehouseId !== buildingId) continue;
      if (worker.phase === 'toPickup') {
        this.releaseQueuedReservations(job);
        this.finishJob(worker);
      }
      // toDropoff is resolved on arrival (missing target → goods returned to network).
    }
  }

  /** Undo the reservations a still-pending job holds on both ends. */
  private releaseQueuedReservations(job: Job): void {
    if (job.kind === 'pickup') {
      const producer = this.ctx.buildings.get(job.buildingId);
      if (producer) producer.reservedOutput = Math.max(0, producer.reservedOutput - 1);
      const depot = this.ctx.buildings.get(job.warehouseId);
      if (depot) depot.incomingStock = Math.max(0, depot.incomingStock - 1);
    } else {
      const source = this.ctx.buildings.get(job.warehouseId);
      if (source) source.reservedStock[job.resource] = Math.max(0, source.reservedStock[job.resource] - 1);
      this.releaseDest(job);
    }
  }

  /** Rebuild reservations and paths after loading a savegame. */
  restoreAfterLoad(): void {
    // Transient counters were reset on construction; recompute from jobs.
    for (const worker of this.ctx.workers) {
      const job = worker.job;
      if (!job) continue;
      const producer = job.kind === 'pickup' ? this.ctx.buildings.get(job.buildingId) : null;
      const warehouse = this.ctx.buildings.get(job.warehouseId);
      const dest = this.ctx.buildings.get(job.buildingId);
      if (job.kind === 'pickup') {
        if (worker.phase === 'toPickup' && producer) producer.reservedOutput++;
        if (warehouse) warehouse.incomingStock++;
      } else {
        if (worker.phase === 'toPickup' && warehouse) warehouse.reservedStock[job.resource]++;
        if (!dest) continue;
        if (job.kind === 'transfer') dest.incomingStock++;
        else if (dest.underConstruction) dest.incomingMaterials++;
        else dest.incomingInput++;
      }
    }
    for (const worker of this.ctx.workers) {
      const target = this.phaseTarget(worker);
      if (target) {
        const path = this.pathTo(worker.tile, target);
        if (path) worker.setPath(path);
        else this.finishJob(worker);
      } else if (worker.phase !== 'idle') {
        this.finishJob(worker);
      }
    }
    this.emitPopulationIfChanged();
  }

  private phaseTarget(worker: Worker): Building | null {
    const job = worker.job;
    switch (worker.phase) {
      case 'toPickup':
        if (!job) return null;
        return job.kind === 'pickup'
          ? (this.ctx.buildings.get(job.buildingId) ?? null)
          : (this.ctx.buildings.get(job.warehouseId) ?? null);
      case 'toDropoff':
        if (!job) return null;
        return job.kind === 'pickup'
          ? (this.ctx.buildings.get(job.warehouseId) ?? null)
          : (this.ctx.buildings.get(job.buildingId) ?? null);
      case 'returning':
        return this.getNearestWarehouse(worker.tile);
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
