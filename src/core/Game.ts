import {
  AUTOSAVE_INTERVAL_MS,
  DEMOLISH_REFUND,
  MAP_H,
  MAP_W,
  MIN_WORKERS,
  RESOURCE_IDS,
  SAVE_VERSION,
  SOLDIER_RECRUIT_COST,
  START_RESOURCES,
} from '../data/config';
import { getDef, type BuildingDefId } from '../data/buildings';
import { Building } from '../entities/Building';
import { Enemy } from '../entities/Enemy';
import { Soldier } from '../entities/Soldier';
import { Worker } from '../entities/Worker';
import { WorldRenderer } from '../render/WorldRenderer';
import { BuildSystem } from '../systems/BuildSystem';
import { missingResourcesMessage } from '../systems/BuildSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { EconomySystem, ResourceStore } from '../systems/EconomySystem';
import { SoldierSystem } from '../systems/SoldierSystem';
import { WaveSystem } from '../systems/WaveSystem';
import { Camera } from '../world/Camera';
import {
  IsoGrid,
  NO_OCCUPANT,
  PassMode,
  gridToScreen,
  screenToGrid,
  screenToTile,
  type Point,
} from '../world/IsoGrid';
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
import { createGameOverMenu } from '../ui/GameOverMenu';
import type { BuildingDef } from '../data/buildings';
import { getTechDef, TECH_EFFECTS, type TechId } from '../data/techs';
import { TUTORIAL_STEPS, type TutorialView } from '../data/tutorial';
import { Capacitor } from '@capacitor/core';
import { DevRewardedAdProvider, type RewardedAdProvider } from '../monetization/Ads';
import { AdmobRewardedAdProvider } from '../monetization/AdmobAds';
import { createTutorialBanner } from '../ui/TutorialBanner';

/** How a building's tiles treat walking units. */
function passModeOf(def: BuildingDef): PassMode {
  if (def.isRoad) return PassMode.Road;
  if (def.passable) return PassMode.Gate;
  return PassMode.None;
}

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
  soldierSystem!: SoldierSystem;
  waveSystem!: WaveSystem;
  combatSystem!: CombatSystem;

  readonly buildings = new Map<number, Building>();
  readonly workers: Worker[] = [];
  readonly soldiers: Soldier[] = [];
  readonly enemies: Enemy[] = [];
  readonly techs = new Set<TechId>();
  tutorialStep = 0;
  /** Swapped for an AdMob-backed provider in the store build (phase 6). */
  ads!: RewardedAdProvider;
  private reviveUsed = false;
  private lostWarehouseSpot: { x: number; y: number; rotated: boolean } | null = null;
  seed = 0;
  private nextId = 1;
  private warehouseId = 0;
  selectedId: number | null = null;
  selectedSoldierId: number | null = null;

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
    createGameOverMenu(uiRoot, this);
    createTutorialBanner(uiRoot, this);
    createToast(uiRoot);
    if (Capacitor.isNativePlatform()) {
      const admob = new AdmobRewardedAdProvider();
      void admob.init(); // preloads in the background; isAvailable() gates use
      this.ads = admob;
    } else {
      this.ads = new DevRewardedAdProvider(uiRoot);
    }

    const data = this.saveManager.load();
    if (data) {
      this.loadFromData(data);
    } else {
      this.newGame();
    }

    window.setInterval(() => {
      if (this.phase === 'playing') this.saveNow();
    }, AUTOSAVE_INTERVAL_MS);

    events.on('wave:started', ({ wave, count }) => {
      this.sound.play('horn');
      events.emit('toast:show', { message: `⚔️ Welle ${wave}: ${count} Angreifer!` });
    });

    this.setPhase('playing');
  }

  // --- World setup -----------------------------------------------------------

  private resetWorld(seed: number): void {
    this.seed = seed;
    this.nextId = 1;
    this.selectedId = null;
    this.selectedSoldierId = null;
    this.buildings.clear();
    this.workers.length = 0;
    this.soldiers.length = 0;
    this.enemies.length = 0;
    this.techs.clear();
    this.tutorialStep = 0;
    this.reviveUsed = false;
    this.lostWarehouseSpot = null;
    this.grid = new IsoGrid(MAP_W, MAP_H);
    generateTerrain(this.grid, seed);

    this.renderer.clearEntities();
    this.renderer.buildTerrain(this.grid);
    this.camera.setMapBounds(MAP_W, MAP_H);
    events.emit('building:selected', { building: null });
    events.emit('soldier:selected', { soldier: null });
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
      getSoldierCount: () => this.soldiers.length,
      getSpeedFactor: () => (this.techs.has('fastCarriers') ? TECH_EFFECTS.fastCarriersSpeed : 1),
    });
    this.soldierSystem = new SoldierSystem(this.grid, this.soldiers);
    this.waveSystem = new WaveSystem({
      grid: this.grid,
      enemies: this.enemies,
      nextEntityId: () => this.nextId++,
    });
    this.combatSystem = new CombatSystem({
      grid: this.grid,
      buildings: this.buildings,
      soldiers: this.soldiers,
      enemies: this.enemies,
      getWarehouse: () => this.buildings.get(this.warehouseId) ?? null,
      destroyBuilding: (id) => this.destroyBuilding(id),
      onEnemyKilled: () => this.waveSystem.onEnemyKilled(),
      onSoldierKilled: (soldier) => this.onSoldierKilled(soldier),
      playSound: (id) => this.sound.play(id),
      towerDamageFactor: () => (this.techs.has('steelArrows') ? TECH_EFFECTS.steelArrowsDamage : 1),
      soldierDamageFactor: () =>
        this.techs.has('combatTraining') ? TECH_EFFECTS.combatTrainingDamage : 1,
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
    events.emit('techs:changed', { researched: [] });
    this.checkTutorial(true);
    events.emit('game:loaded', undefined);
  }

  // --- Loop ------------------------------------------------------------------

  private tickCount = 0;

  tick(): void {
    if (this.phase !== 'playing') return;
    this.tickCount++;
    this.economy.tick();
    this.soldierSystem.tick();
    this.waveSystem.tick();
    this.combatSystem.tick();
    // Tutorial conditions are cheap but need no per-tick precision.
    if (this.tickCount % 20 === 0) this.checkTutorial();
  }

  // --- Tutorial ----------------------------------------------------------------

  private tutorialView(): TutorialView {
    return {
      countBuildings: (defId) =>
        [...this.buildings.values()].filter((b) => b.defId === defId).length,
      soldierCount: this.soldiers.length,
      wavesSurvived:
        this.enemies.length === 0 ? this.waveSystem.waveNumber : this.waveSystem.waveNumber - 1,
    };
  }

  private checkTutorial(emitAlways = false): void {
    const before = this.tutorialStep;
    const view = this.tutorialView();
    while (this.tutorialStep < TUTORIAL_STEPS.length && TUTORIAL_STEPS[this.tutorialStep].isDone(view)) {
      this.tutorialStep++;
    }
    if (this.tutorialStep !== before || emitAlways) {
      if (this.tutorialStep !== before && this.tutorialStep <= TUTORIAL_STEPS.length) {
        this.sound.play('ui');
      }
      events.emit('tutorial:changed', {
        text: this.tutorialStep < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[this.tutorialStep].text : null,
      });
    }
  }

  skipTutorial(): void {
    this.tutorialStep = TUTORIAL_STEPS.length;
    events.emit('tutorial:changed', { text: null });
  }

  // --- Research ------------------------------------------------------------------

  buyTech(id: TechId): void {
    if (this.techs.has(id)) return;
    const def = getTechDef(id);
    const missing = missingResourcesMessage(this.store, def.cost);
    if (missing) {
      events.emit('toast:show', { message: missing });
      return;
    }
    this.store.pay(def.cost);
    this.techs.add(id);
    this.sound.play('place');
    events.emit('toast:show', { message: `Erforscht: ${def.name}` });
    events.emit('techs:changed', { researched: [...this.techs] });
  }

  renderFrame(alpha: number): void {
    this.renderer.renderFrame(
      this.camera,
      {
        grid: this.grid,
        buildings: this.buildings,
        workers: this.workers,
        soldiers: this.soldiers,
        enemies: this.enemies,
        projectiles: this.combatSystem?.projectiles ?? [],
        ghost: this.buildSystem?.ghost ?? null,
        selectedId: this.selectedId,
        selectedSoldierId: this.selectedSoldierId,
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
    // Never persist a lost game over the last valid save.
    if (this.phase === 'playing' || this.phase === 'paused') this.saveNow();
  }

  // --- Interaction -------------------------------------------------------------

  private handleTap(sx: number, sy: number): void {
    if (this.phase !== 'playing') return;
    const world = this.camera.screenToWorld(sx, sy);
    if (this.buildSystem.active) {
      this.buildSystem.tryPlaceAt(world.x, world.y);
      return;
    }

    // Priority: soldier under the finger > move order > building > deselect.
    const g = screenToGrid(world.x, world.y);
    const hitSoldier = this.soldierSystem.soldierAt(g.x, g.y, 0.6);
    if (hitSoldier) {
      this.selectSoldier(hitSoldier.id);
      return;
    }

    const tile = screenToTile(world.x, world.y);
    const occupant = this.grid.inBounds(tile.x, tile.y)
      ? this.grid.occupantAt(tile.x, tile.y)
      : NO_OCCUPANT;

    if (this.selectedSoldierId !== null && occupant === NO_OCCUPANT) {
      const soldier = this.soldiers.find((s) => s.id === this.selectedSoldierId);
      if (soldier && this.grid.inBounds(tile.x, tile.y)) {
        this.soldierSystem.command(soldier, tile);
        return; // keep the soldier selected for follow-up orders
      }
    }

    this.selectSoldier(null);
    this.select(occupant === NO_OCCUPANT ? null : occupant);
  }

  private handleHover(sx: number, sy: number): void {
    if (this.phase !== 'playing' || !this.buildSystem.active) return;
    const world = this.camera.screenToWorld(sx, sy);
    this.buildSystem.updateGhost(world.x, world.y);
  }

  select(id: number | null): void {
    this.selectedId = id;
    if (id !== null) this.selectSoldier(null);
    events.emit('building:selected', {
      building: id !== null ? (this.buildings.get(id) ?? null) : null,
    });
  }

  selectSoldier(id: number | null): void {
    if (this.selectedSoldierId === id) return;
    this.selectedSoldierId = id;
    if (id !== null && this.selectedId !== null) this.select(null);
    events.emit('soldier:selected', {
      soldier: id !== null ? (this.soldiers.find((s) => s.id === id) ?? null) : null,
    });
  }

  // --- Soldiers ----------------------------------------------------------------

  /** Recruit one soldier at a barracks (info panel action). */
  recruitSoldier(barracksId: number): void {
    const barracks = this.buildings.get(barracksId);
    if (!barracks || !barracks.def.recruitsSoldiers) return;
    if (this.economy.workerTarget() <= MIN_WORKERS) {
      events.emit('toast:show', { message: 'Nicht genug Bevölkerung — baue Hütten' });
      return;
    }
    const missing = missingResourcesMessage(this.store, SOLDIER_RECRUIT_COST);
    if (missing) {
      events.emit('toast:show', { message: missing });
      return;
    }
    // Front-most access tile so the new soldier isn't hidden behind the roof.
    const spawn = barracks
      .accessTiles(this.grid)
      .sort((a, b) => b.x + b.y - (a.x + a.y))[0];
    if (!spawn) {
      events.emit('toast:show', { message: 'Kaserne ist eingebaut — kein Platz' });
      return;
    }
    this.store.pay(SOLDIER_RECRUIT_COST);
    this.soldiers.push(new Soldier(this.nextId++, spawn.x, spawn.y));
    this.sound.play('place');
    events.emit('toast:show', { message: 'Soldat rekrutiert' });
  }

  /** Dismiss a soldier; the population slot returns to the carrier pool. */
  dismissSoldier(id: number): void {
    const idx = this.soldiers.findIndex((s) => s.id === id);
    if (idx === -1) return;
    this.soldiers.splice(idx, 1);
    if (this.selectedSoldierId === id) this.selectSoldier(null);
    events.emit('toast:show', { message: 'Soldat entlassen' });
  }

  // --- Building management -------------------------------------------------------

  private addBuilding(defId: BuildingDefId, gx: number, gy: number, rotated: boolean): Building {
    const b = new Building(this.nextId++, defId, gx, gy, rotated);
    this.buildings.set(b.id, b);
    this.grid.setOccupantRect(gx, gy, b.w, b.h, b.id, passModeOf(b.def));
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

  /** Building destroyed by enemies: no refund; losing the warehouse ends the game. */
  destroyBuilding(id: number): void {
    const b = this.buildings.get(id);
    if (!b) return;
    this.grid.setOccupantRect(b.x, b.y, b.w, b.h, NO_OCCUPANT);
    this.buildings.delete(id);
    this.economy.onBuildingRemoved(id);
    if (this.selectedId === id) this.select(null);
    this.sound.play('demolish');
    events.emit('toast:show', { message: `${b.def.name} zerstört!` });
    if (b.def.isWarehouse) {
      this.lostWarehouseSpot = { x: b.x, y: b.y, rotated: b.rotated };
      this.gameOver();
    }
  }

  private onSoldierKilled(soldier: Soldier): void {
    const idx = this.soldiers.indexOf(soldier);
    if (idx !== -1) this.soldiers.splice(idx, 1);
    if (this.selectedSoldierId === soldier.id) this.selectSoldier(null);
    this.sound.play('death');
    events.emit('toast:show', { message: 'Ein Soldat ist gefallen' });
  }

  private gameOver(): void {
    this.buildSystem.cancel();
    this.setPhase('gameover');
    this.sound.play('gameover');
    // A lost run must not be resumable after reload.
    this.saveManager.clear();
    events.emit('game:over', {
      wavesSurvived: Math.max(0, this.waveSystem.waveNumber - 1),
      kills: this.waveSystem.kills,
    });
  }

  /** One revive per run, paid with a rewarded ad (dev stub on the web). */
  canRevive(): boolean {
    return (
      this.phase === 'gameover' &&
      !this.reviveUsed &&
      this.lostWarehouseSpot !== null &&
      this.ads.isAvailable()
    );
  }

  async reviveViaAd(): Promise<boolean> {
    if (!this.canRevive()) return false;
    const rewarded = await this.ads.show();
    if (!rewarded) return false;
    const spot = this.lostWarehouseSpot!;
    this.reviveUsed = true;
    this.lostWarehouseSpot = null;
    // The attackers withdraw; the warehouse is rebuilt at half strength.
    this.enemies.length = 0;
    const warehouse = this.addBuilding('warehouse', spot.x, spot.y, spot.rotated);
    warehouse.hp = Math.ceil(warehouse.maxHp / 2);
    this.warehouseId = warehouse.id;
    this.setPhase('playing');
    this.saveNow();
    this.sound.play('horn');
    events.emit('toast:show', { message: 'Die Burg lebt weiter!' });
    return true;
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
      soldiers: this.soldiers.map((s) => s.toSave()),
      enemies: this.enemies.map((e) => e.toSave()),
      wave: this.waveSystem.toSave(),
      techs: [...this.techs],
      tutorialStep: this.tutorialStep,
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
      this.grid.setOccupantRect(b.x, b.y, b.w, b.h, b.id, passModeOf(b.def));
      if (b.def.isWarehouse) this.warehouseId = b.id;
    }
    for (const ws of data.workers) {
      this.workers.push(Worker.fromSave(ws));
    }
    this.economy.restoreAfterLoad();

    const soldierTargets = new Map<number, Point>();
    for (const ss of data.soldiers) {
      const { soldier, target } = Soldier.fromSave(ss);
      this.soldiers.push(soldier);
      if (target) soldierTargets.set(soldier.id, target);
    }
    this.soldierSystem.restoreAfterLoad(soldierTargets);

    for (const es of data.enemies) {
      // Routes and attack targets are recomputed by CombatSystem.
      this.enemies.push(Enemy.fromSave(es));
    }
    this.waveSystem.restore(data.wave);
    for (const t of data.techs) this.techs.add(t);
    this.tutorialStep = Math.min(data.tutorialStep, TUTORIAL_STEPS.length);
    events.emit('techs:changed', { researched: [...this.techs] });
    this.checkTutorial(true);

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
