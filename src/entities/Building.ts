import {
  BUILDING_DEFAULT_HP,
  BUILDING_MAX_LEVEL,
  LOCAL_STORE_CAP,
  TICK_RATE,
  UPGRADE_HP_BONUS,
  UPGRADE_HUT_POPULATION,
  UPGRADE_SPEED_BONUS,
  type ResourceId,
} from '../data/config';
import { getDef, type BuildingDef, type BuildingDefId } from '../data/buildings';
import type { IsoGrid, Point } from '../world/IsoGrid';

/** Serialized building state inside a savegame. */
export interface BuildingSave {
  id: number;
  defId: BuildingDefId;
  x: number;
  y: number;
  rotated: boolean;
  active: boolean;
  progress: number;
  inputStore: number;
  outputStore: number;
  /** Since save version 3. */
  hp: number;
  /** Since save version 5. */
  assignedWorkers: number;
  /** Since save version 6. */
  level: number;
  /** Since save version 7. */
  harvestProgress: number;
}

/**
 * A placed building: pure state + production logic, no rendering.
 * (Extension point: soldiers/towers in later phases get their own entity
 * classes; shared needs like ids/footprints can be lifted into a base then.)
 */
export class Building {
  readonly id: number;
  readonly defId: BuildingDefId;
  /** Top-left tile of the footprint. */
  readonly x: number;
  readonly y: number;
  /** Rotation swaps footprint width/height. */
  readonly rotated: boolean;

  /** Production cycle currently running. */
  active = false;
  /** Elapsed ticks of the current cycle. */
  progress = 0;
  /** Locally stored input units (processors only). */
  inputStore = 0;
  /** Locally stored output units waiting for pickup. */
  outputStore = 0;
  /** Current hit points; the building is destroyed at 0 (phase 3). */
  hp: number;
  /** Population assigned to operate this building (phase 7). */
  assignedWorkers = 0;
  /** Upgrade level 1..maxLevel (phase 8). */
  level = 1;
  /** Wood harvested toward felling the next forest tile (lumberjacks). */
  harvestProgress = 0;
  /** Production stalled by missing surroundings (e.g. no forest left). */
  productionHalted = false;

  // Transient reservation counters (recomputed from worker jobs on load).
  /** Output units already promised to a pickup job. */
  reservedOutput = 0;
  /** Input units on their way via delivery jobs. */
  incomingInput = 0;

  constructor(id: number, defId: BuildingDefId, x: number, y: number, rotated = false) {
    this.id = id;
    this.defId = defId;
    this.x = x;
    this.y = y;
    this.rotated = rotated;
    this.hp = this.maxHp;
  }

  get maxLevel(): number {
    return this.def.maxLevel ?? BUILDING_MAX_LEVEL;
  }

  get maxHp(): number {
    const base = getDef(this.defId).maxHp ?? BUILDING_DEFAULT_HP;
    return Math.round(base * (1 + UPGRADE_HP_BONUS * (this.level - 1)));
  }

  /** Carrier capacity provided (huts grow with their level). */
  get populationBonus(): number {
    const base = this.def.population ?? 0;
    return base === 0 ? 0 : base + UPGRADE_HUT_POPULATION * (this.level - 1);
  }

  /** Center of the footprint in grid coordinates (tower range checks). */
  get center(): Point {
    return { x: this.x + (this.w - 1) / 2, y: this.y + (this.h - 1) / 2 };
  }

  get def(): BuildingDef {
    return getDef(this.defId);
  }

  get w(): number {
    const f = this.def.footprint;
    return this.rotated ? f.h : f.w;
  }

  get h(): number {
    const f = this.def.footprint;
    return this.rotated ? f.w : f.h;
  }

  /** Depth-sort key: the footprint's front (south) corner tile. */
  get zIndex(): number {
    return this.x + this.w - 1 + this.y + this.h - 1;
  }

  get durationTicks(): number {
    const recipe = this.def.recipe;
    return recipe ? Math.round(recipe.duration * TICK_RATE) : 0;
  }

  /** Required staff; 0 = runs unmanned (no recipe or legacy building). */
  get workersRequired(): number {
    return this.def.workersRequired ?? 0;
  }

  /** Production speed factor from staffing (0 → stands still). */
  get staffingFactor(): number {
    const required = this.workersRequired;
    if (required === 0) return 1;
    return Math.min(1, this.assignedWorkers / required);
  }

  /** Production speed factor from the upgrade level. */
  get levelFactor(): number {
    return 1 + UPGRADE_SPEED_BONUS * (this.level - 1);
  }

  /** Advance production by one logic tick, scaled by assigned workers. */
  tickProduction(): void {
    const recipe = this.def.recipe;
    if (!recipe) return;
    if (this.productionHalted) return;
    const speed = this.staffingFactor * this.levelFactor;
    if (speed <= 0) return;

    if (!this.active) {
      if (this.outputStore >= LOCAL_STORE_CAP) return;
      if (recipe.input) {
        if (this.inputStore <= 0) return;
        this.inputStore--;
      }
      this.active = true;
      this.progress = 0;
    }

    this.progress += speed;
    if (this.progress >= this.durationTicks) {
      this.outputStore++;
      this.active = false;
      this.progress = 0;
    }
  }

  /** How many input units may still be requested from the warehouse. */
  inputDemand(): number {
    const recipe = this.def.recipe;
    if (!recipe?.input) return 0;
    return Math.max(0, LOCAL_STORE_CAP - this.inputStore - this.incomingInput);
  }

  /** Output units not yet promised to a carrier. */
  unclaimedOutput(): number {
    return this.outputStore - this.reservedOutput;
  }

  inputResource(): ResourceId | null {
    return this.def.recipe?.input ?? null;
  }

  /** All tiles covered by the footprint. */
  footprintTiles(): Point[] {
    const tiles: Point[] = [];
    for (let dy = 0; dy < this.h; dy++) {
      for (let dx = 0; dx < this.w; dx++) {
        tiles.push({ x: this.x + dx, y: this.y + dy });
      }
    }
    return tiles;
  }

  /** First tile of the given terrain orthogonally adjacent to the footprint. */
  adjacentTerrainTile(grid: IsoGrid, terrain: number): Point | null {
    for (let dx = 0; dx < this.w; dx++) {
      for (const y of [this.y - 1, this.y + this.h]) {
        if (grid.inBounds(this.x + dx, y) && grid.terrainAt(this.x + dx, y) === terrain) {
          return { x: this.x + dx, y };
        }
      }
    }
    for (let dy = 0; dy < this.h; dy++) {
      for (const x of [this.x - 1, this.x + this.w]) {
        if (grid.inBounds(x, this.y + dy) && grid.terrainAt(x, this.y + dy) === terrain) {
          return { x, y: this.y + dy };
        }
      }
    }
    return null;
  }

  /** Walkable tiles orthogonally adjacent to the footprint (carrier targets). */
  accessTiles(grid: IsoGrid): Point[] {
    const tiles: Point[] = [];
    const seen = new Set<number>();
    const tryAdd = (x: number, y: number): void => {
      const key = y * grid.width + x;
      if (seen.has(key)) return;
      seen.add(key);
      if (isFinite(grid.moveCost(x, y))) tiles.push({ x, y });
    };
    for (let dx = 0; dx < this.w; dx++) {
      tryAdd(this.x + dx, this.y - 1);
      tryAdd(this.x + dx, this.y + this.h);
    }
    for (let dy = 0; dy < this.h; dy++) {
      tryAdd(this.x - 1, this.y + dy);
      tryAdd(this.x + this.w, this.y + dy);
    }
    return tiles;
  }

  toSave(): BuildingSave {
    return {
      id: this.id,
      defId: this.defId,
      x: this.x,
      y: this.y,
      rotated: this.rotated,
      active: this.active,
      progress: this.progress,
      inputStore: this.inputStore,
      outputStore: this.outputStore,
      hp: this.hp,
      assignedWorkers: this.assignedWorkers,
      level: this.level,
      harvestProgress: this.harvestProgress,
    };
  }

  static fromSave(s: BuildingSave): Building {
    const b = new Building(s.id, s.defId, s.x, s.y, s.rotated);
    b.level = Math.max(1, Math.min(s.level, b.maxLevel));
    b.active = s.active;
    b.progress = s.progress;
    b.inputStore = s.inputStore;
    b.outputStore = s.outputStore;
    b.hp = Math.min(s.hp, b.maxHp);
    b.assignedWorkers = s.assignedWorkers;
    b.harvestProgress = s.harvestProgress;
    return b;
  }
}
