import {
  AUTOSAVE_INTERVAL_MS,
  DEMOLISH_REFUND,
  MAP_H,
  MAP_W,
  RESOURCE_IDS,
  SAVE_VERSION,
  START_RESOURCES,
} from '../data/config';
import { getDef, type BuildingDefId } from '../data/buildings';
import { Building } from '../entities/Building';
import { Worker } from '../entities/Worker';
import { WorldRenderer } from '../render/WorldRenderer';
import { BuildSystem } from '../systems/BuildSystem';
import { EconomySystem, ResourceStore } from '../systems/EconomySystem';
import { Camera } from '../world/Camera';
import { IsoGrid, NO_OCCUPANT, gridToScreen, screenToTile } from '../world/IsoGrid';
import { generateTerrain } from '../world/TerrainGenerator';
import { events, type GamePhase } from './EventBus';
import { InputController } from './Input';
import { SaveManager, type SaveData } from './SaveManager';
import { SoundManager } from './SoundManager';
import { createHUD } from '../ui/HUD';
import { createBuildMenu } from '../ui/BuildMenu';
import { createToast } from '../ui/Toast';
import { createInfoPanel } from '../ui/InfoPanel';
import { createPauseMenu } from '../ui/PauseMenu';

/**
 * Central game class: owns world state, systems, renderer and UI, and runs
 * the state machine (loading → playing ⇄ paused). The fixed-timestep loop
 * in main.ts calls `tick()` and `renderFrame()`.
 */
export class Game {
  phase: GamePhase = 'loading';

  grid = new IsoGrid(MAP_W, MAP_H);
  camera = new Camera();
  renderer = new WorldRenderer();
  saveManager = new SaveManager();
  sound = new SoundManager();

  store!: ResourceStore;
  economy!: EconomySystem;
  buildSystem!: BuildSystem;

  readonly buildings = new Map<number, Building>();
  readonly workers: Worker[] = [];
  seed = 0;
  private nextId = 1;
  private warehouseId = 0;
  selectedId: number | null = null;

  async init(root: HTMLElement, uiRoot: HTMLElement): Promise<void> {
    await this.renderer.init(root);
    await this.sound.preload();
    new InputController(this.renderer.canvas, this.camera, {
      onTap: (x, y) => this.handleTap(x, y),
      onHover: (x, y) => this.handleHover(x, y),
    });

    createHUD(uiRoot, this);
    createBuildMenu(uiRoot, this);
    createInfoPanel(uiRoot, this);
    createPauseMenu(uiRoot, this);
    createToast(uiRoot);

    const data = this.saveManager.load();
    if (data) {
      this.loadFromData(data);
    } else {
      this.newGame();
    }

    window.setInterval(() => {
      if (this.phase === 'playing') this.saveNow();
    }, AUTOSAVE_INTERVAL_MS);

    this.setPhase('playing');
  }

  // --- World setup -----------------------------------------------------------

  private resetWorld(seed: number): void {
    this.seed = seed;
    this.nextId = 1;
    this.selectedId = null;
    this.buildings.clear();
    this.workers.length = 0;
    this.grid = new IsoGrid(MAP_W, MAP_H);
    generateTerrain(this.grid, seed);

    this.renderer.clearEntities();
    this.renderer.buildTerrain(this.grid);
    this.camera.setMapBounds(MAP_W, MAP_H);
    events.emit('building:selected', { building: null });
  }

  private setupSystems(store: ResourceStore): void {
    this.store = store;
    this.economy = new EconomySystem({
      grid: this.grid,
      store,
      buildings: this.buildings,
      workers: this.workers,
      getWarehouse: () => this.buildings.get(this.warehouseId) ?? null,
      nextEntityId: () => this.nextId++,
    });
    this.buildSystem = new BuildSystem({
      grid: this.grid,
      store,
      placeBuilding: (defId, gx, gy, rotated) => {
        this.addBuilding(defId, gx, gy, rotated);
        this.sound.play('place');
      },
    });
    store.emitChanged();
  }

  newGame(seed: number = (Math.random() * 0xffffffff) >>> 0): void {
    this.resetWorld(seed);
    this.setupSystems(new ResourceStore(START_RESOURCES));

    // Starting warehouse in the map center (the generator keeps it clear).
    const warehouseDef = getDef('warehouse');
    const wx = Math.floor(MAP_W / 2) - 1;
    const wy = Math.floor(MAP_H / 2) - 1;
    const warehouse = this.addBuilding('warehouse', wx, wy, false);
    this.warehouseId = warehouse.id;

    const center = gridToScreen(wx + warehouseDef.footprint.w / 2, wy + warehouseDef.footprint.h / 2);
    this.camera.centerOn(center.x, center.y);
    events.emit('game:loaded', undefined);
  }

  // --- Loop ------------------------------------------------------------------

  tick(): void {
    if (this.phase !== 'playing') return;
    this.economy.tick();
  }

  renderFrame(alpha: number): void {
    this.renderer.renderFrame(
      this.camera,
      {
        grid: this.grid,
        buildings: this.buildings,
        workers: this.workers,
        ghost: this.buildSystem?.ghost ?? null,
        selectedId: this.selectedId,
      },
      alpha,
    );
  }

  handleResize(w: number, h: number): void {
    this.renderer.resize(w, h);
    this.camera.setViewport(w, h);
  }

  setPhase(phase: GamePhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    events.emit('game:phaseChanged', { phase });
  }

  togglePause(): void {
    if (this.phase === 'playing') this.setPhase('paused');
    else if (this.phase === 'paused') this.setPhase('playing');
  }

  /** Called when the tab is hidden: persist, logic stops via the loop. */
  onHidden(): void {
    if (this.phase !== 'loading') this.saveNow();
  }

  // --- Interaction -------------------------------------------------------------

  private handleTap(sx: number, sy: number): void {
    if (this.phase !== 'playing') return;
    const world = this.camera.screenToWorld(sx, sy);
    if (this.buildSystem.active) {
      this.buildSystem.tryPlaceAt(world.x, world.y);
      return;
    }
    const tile = screenToTile(world.x, world.y);
    const occupant = this.grid.inBounds(tile.x, tile.y)
      ? this.grid.occupantAt(tile.x, tile.y)
      : NO_OCCUPANT;
    this.select(occupant === NO_OCCUPANT ? null : occupant);
  }

  private handleHover(sx: number, sy: number): void {
    if (this.phase !== 'playing' || !this.buildSystem.active) return;
    const world = this.camera.screenToWorld(sx, sy);
    this.buildSystem.updateGhost(world.x, world.y);
  }

  select(id: number | null): void {
    this.selectedId = id;
    events.emit('building:selected', {
      building: id !== null ? (this.buildings.get(id) ?? null) : null,
    });
  }

  // --- Building management -------------------------------------------------------

  private addBuilding(defId: BuildingDefId, gx: number, gy: number, rotated: boolean): Building {
    const b = new Building(this.nextId++, defId, gx, gy, rotated);
    this.buildings.set(b.id, b);
    this.grid.setOccupantRect(gx, gy, b.w, b.h, b.id);
    return b;
  }

  demolish(id: number): void {
    const b = this.buildings.get(id);
    if (!b || b.def.isWarehouse) return;
    this.grid.setOccupantRect(b.x, b.y, b.w, b.h, NO_OCCUPANT);
    this.buildings.delete(id);
    this.economy.onBuildingRemoved(id);
    for (const r of RESOURCE_IDS) {
      const refund = Math.floor((b.def.cost[r] ?? 0) * DEMOLISH_REFUND);
      if (refund > 0) this.store.add(r, refund);
    }
    if (this.selectedId === id) this.select(null);
    this.sound.play('demolish');
    events.emit('toast:show', { message: `${b.def.name} abgerissen` });
  }

  // --- Persistence -----------------------------------------------------------------

  toSaveData(): SaveData {
    return {
      saveVersion: SAVE_VERSION,
      seed: this.seed,
      nextEntityId: this.nextId,
      resources: this.store.snapshot(),
      buildings: [...this.buildings.values()].map((b) => b.toSave()),
      workers: this.workers.map((w) => w.toSave()),
    };
  }

  saveNow(): void {
    this.saveManager.save(this.toSaveData());
  }

  loadFromData(data: SaveData): void {
    this.resetWorld(data.seed);
    this.setupSystems(new ResourceStore(data.resources));
    this.nextId = data.nextEntityId;

    for (const bs of data.buildings) {
      const b = Building.fromSave(bs);
      this.buildings.set(b.id, b);
      this.grid.setOccupantRect(b.x, b.y, b.w, b.h, b.id);
      if (b.def.isWarehouse) this.warehouseId = b.id;
    }
    for (const ws of data.workers) {
      this.workers.push(Worker.fromSave(ws));
    }
    this.economy.restoreAfterLoad();

    const warehouse = this.buildings.get(this.warehouseId);
    if (warehouse) {
      const center = gridToScreen(warehouse.x + warehouse.w / 2, warehouse.y + warehouse.h / 2);
      this.camera.centerOn(center.x, center.y);
    }
    events.emit('game:loaded', undefined);
  }

  /** Wipe the save and start over (pause menu action). */
  restartNewGame(): void {
    this.saveManager.clear();
    this.buildSystem.cancel();
    this.newGame();
    this.setPhase('playing');
    events.emit('toast:show', { message: 'Neues Spiel gestartet' });
  }
}
