import {
  AUTOSAVE_INTERVAL_MS,
  DEMOLISH_REFUND,
  MAP_H,
  MAP_W,
  MIN_WORKERS,
  RESOURCE_IDS,
  SAVE_VERSION,
  START_RESOURCES,
} from '../data/config';
import { getSoldierType, type SoldierTypeId } from '../data/soldiers';
import {
  AUTUMN_FARM_BONUS,
  FOOD_INTERVAL,
  FOOD_PER_POP,
  FOOD_PER_SOLDIER,
  MORALE_FED_BONUS,
  MORALE_HUNGER_PENALTY,
  MORALE_SPEED_BASE,
  MORALE_SPEED_SPAN,
  MORALE_START,
  MORALE_TAX_PENALTY,
  MORALE_VARIETY_BONUS,
  SEASON_LENGTH,
  TAX_GOLD_PER_POP,
  TICK_RATE,
  WINTER_FOOD_FACTOR,
} from '../data/config';
import { SCENARIOS, getScenario, type ScenarioId } from '../data/scenarios';
import { getDef, type BuildingDefId } from '../data/buildings';
import type { ResourceId } from '../data/config';
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
  Terrain,
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
import { createDuelMenu } from '../ui/DuelMenu';
import { createMainMenu } from '../ui/MainMenu';
import { createStatsPanel } from '../ui/StatsPanel';
import { createMarketPanel } from '../ui/MarketPanel';
import type { BuildingDef } from '../data/buildings';
import { getTechDef, TECH_EFFECTS, type TechId } from '../data/techs';
import {
  FOREST_REGROW_ATTEMPTS,
  FOREST_REGROW_INTERVAL,
  UPGRADE_COST_FACTOR,
} from '../data/config';
import { recordScore } from './Highscores';
import {
  BUY_MARKUP,
  SELL_PRICE,
  TRADE_GUILD_BUY_FACTOR,
  TRADE_GUILD_SELL_FACTOR,
} from '../data/market';
import { decodeCastle, encodeCastle } from './CastleCode';
import {
  DUEL_GROUP_SIZE,
  DUEL_SPAWN_EDGE,
  DUEL_TIME_LIMIT,
  ENEMY_BREACH_COST_DUEL,
  computeArmy,
} from '../data/duel';
import type { EnemyDefId } from '../data/enemies';
import { TUTORIAL_STEPS, type TutorialView } from '../data/tutorial';
import { Capacitor } from '@capacitor/core';
import { DevRewardedAdProvider, type RewardedAdProvider } from '../monetization/Ads';
import { AdmobRewardedAdProvider } from '../monetization/AdmobAds';
import { createTutorialBanner } from '../ui/TutorialBanner';

/** How a building's tiles treat walking units. */
function passModeOf(def: BuildingDef): PassMode {
  if (def.roadTier === 2) return PassMode.RoadStone;
  if (def.roadTier === 1) return PassMode.Road;
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
  /** Phase 12: settlement morale (0–100), tax level (0–3), season clock. */
  morale = MORALE_START;
  taxLevel = 0;
  seasonTicks = 0;
  scenarioId: ScenarioId = 'endless';
  private victoryAnnounced = false;
  /** Swapped for an AdMob-backed provider in the store build (phase 6). */
  ads!: RewardedAdProvider;
  private reviveUsed = false;
  private lostWarehouseSpot: { x: number; y: number; rotated: boolean } | null = null;
  // --- Duel mode (Burg-Duell): attack a shared castle snapshot. ---
  duelMode = false;
  private duelQueue: EnemyDefId[] = [];
  private duelBackup: SaveData | null = null;
  private duelOutcome: 'victory' | 'defeat' | 'aborted' | null = null;
  private duelStats = { unitsLost: 0, buildingsDestroyed: 0, startMs: 0 };
  private duelLastStatus = '';
  seed = 0;
  private nextId = 1;
  private warehouseId = 0;
  selectedId: number | null = null;
  selectedSoldierId: number | null = null;
  statsPanel: { toggle(): void } | null = null;
  marketPanel: { open(): void } | null = null;
  /** True once the player has built anything beyond the starting warehouse. */
  hasProgress(): boolean {
    return this.buildings.size > 1 || this.waveSystem.waveNumber > 0;
  }

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
    createDuelMenu(uiRoot, this);
    createMainMenu(uiRoot, this);
    this.statsPanel = createStatsPanel(uiRoot, this);
    this.marketPanel = createMarketPanel(uiRoot, this);
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

    // Boot into the title screen; the player picks continue/new/duel.
    this.setPhase('menu');
    // Howler delays actual playback until the first user gesture.
    this.sound.startAmbient();
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
    this.morale = MORALE_START;
    this.taxLevel = 0;
    this.seasonTicks = 0;
    this.victoryAnnounced = false;
    this.reviveUsed = false;
    this.lostWarehouseSpot = null;
    this.grid = new IsoGrid(MAP_W, MAP_H);
    generateTerrain(this.grid, seed);
    this.grid.sealBaseline();

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
      getSpeedFactor: () =>
        (this.techs.has('fastCarriers') ? TECH_EFFECTS.fastCarriersSpeed : 1) *
        (this.techs.has('freeBeer') ? TECH_EFFECTS.freeBeerSpeed : 1) *
        this.moraleSpeedFactor(),
      fellForestTile: (b) => this.fellForest(b),
      getFarmFactor: () => (this.season === 2 ? AUTUMN_FARM_BONUS : this.season === 3 ? 0 : 1),
      onConstructionFinished: (b) => {
        this.sound.play('place');
        events.emit('toast:show', { message: `${b.def.name} fertiggestellt` });
      },
    });
    this.soldierSystem = new SoldierSystem(this.grid, this.soldiers, () =>
      this.techs.has('fieldRations') ? TECH_EFFECTS.fieldRationsSpeed : 1,
    );
    this.waveSystem = new WaveSystem({
      grid: this.grid,
      enemies: this.enemies,
      nextEntityId: () => this.nextId++,
      getWarehouse: () => this.buildings.get(this.warehouseId) ?? null,
    });
    this.combatSystem = new CombatSystem({
      grid: this.grid,
      buildings: this.buildings,
      soldiers: this.soldiers,
      enemies: this.enemies,
      getWarehouse: () => this.buildings.get(this.warehouseId) ?? null,
      destroyBuilding: (id) => this.destroyBuilding(id),
      onEnemyKilled: () => {
        if (this.duelMode) this.duelStats.unitsLost++;
        else this.waveSystem.onEnemyKilled();
      },
      onSoldierKilled: (soldier) => this.onSoldierKilled(soldier),
      playSound: (id) => this.sound.play(id),
      towerDamageFactor: () => (this.techs.has('steelArrows') ? TECH_EFFECTS.steelArrowsDamage : 1),
      towerRangeBonus: () =>
        this.techs.has('militaryDoctrine') ? TECH_EFFECTS.militaryDoctrineRange : 0,
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
      // Roads/bridges build instantly and are paid up front; everything
      // else becomes a construction site supplied by carriers.
      paysUpFront: (defId) => getDef(defId).roadTier !== undefined,
    });
    store.emitChanged();
  }

  newGame(seed: number = (Math.random() * 0xffffffff) >>> 0, scenarioId: ScenarioId = 'endless'): void {
    this.resetWorld(seed);
    this.scenarioId = scenarioId;
    this.lastSeason = -1;
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
    events.emit('morale:changed', { morale: Math.round(this.morale) });
    this.checkTutorial(true);
    events.emit('game:loaded', undefined);
  }

  // --- Loop ------------------------------------------------------------------

  private tickCount = 0;

  tick(): void {
    if (this.phase !== 'playing') return;
    this.tickCount++;
    if (this.duelMode) {
      // The defending castle fights back; no economy or waves run.
      this.soldierSystem.tick();
      this.combatSystem.tick();
      this.tickDuel();
      return;
    }
    this.seasonTicks++;
    this.economy.tick();
    this.soldierSystem.tick();
    this.waveSystem.tick();
    this.combatSystem.tick();
    if (this.tickCount % (FOOD_INTERVAL * TICK_RATE) === 0) this.foodAndTaxTick();
    // Tutorial conditions are cheap but need no per-tick precision.
    if (this.tickCount % 20 === 0) {
      this.checkTutorial();
      this.checkSeasonChange();
      this.checkVictory();
    }
    if (this.tickCount % (FOREST_REGROW_INTERVAL * 20) === 0) this.regrowForest();
  }

  // --- Seasons -------------------------------------------------------------------

  /** 0 Frühling, 1 Sommer, 2 Herbst, 3 Winter. */
  get season(): number {
    return Math.floor(this.seasonTicks / (SEASON_LENGTH * TICK_RATE)) % 4;
  }

  private lastSeason = -1;

  private checkSeasonChange(): void {
    const s = this.season;
    if (s === this.lastSeason) return;
    this.lastSeason = s;
    const names = ['🌱 Frühling', '☀️ Sommer', '🍂 Herbst', '❄️ Winter'];
    events.emit('season:changed', { season: s, label: names[s] });
    if (this.tickCount > 1) events.emit('toast:show', { message: `${names[s]} beginnt` });
    // Subtle map tint per season (terrain is baked into sprites — cheap).
    this.renderer.setSeasonTint([0xffffff, 0xfff6e4, 0xffe3c0, 0xdce8f5][s]);
  }

  // --- Consumption, morale & taxes ---------------------------------------------------

  private foodAndTaxTick(): void {
    const pop = this.economy.populationTotal();
    const winter = this.season === 3;
    let need = Math.ceil(pop * FOOD_PER_POP) + this.soldiers.length * FOOD_PER_SOLDIER;
    if (winter) need = Math.ceil(need * WINTER_FOOD_FACTOR);
    let missing = need;
    for (const r of ['bread', 'fish'] as const) {
      const take = Math.min(missing, this.store.get(r));
      if (take > 0) this.store.pay({ [r]: take });
      missing -= take;
    }
    if (missing > 0) {
      this.morale = Math.max(0, this.morale - MORALE_HUNGER_PENALTY);
      events.emit('toast:show', { message: `🍽️ Hunger! ${missing} Mahlzeiten fehlen` });
    } else {
      const variety =
        ['bread', 'fish', 'beer'].filter((r) => this.store.get(r as 'bread') > 0).length >= 2;
      this.morale = Math.min(
        100,
        this.morale + MORALE_FED_BONUS + (variety ? MORALE_VARIETY_BONUS : 0),
      );
    }
    if (this.taxLevel > 0) {
      this.store.add('gold', Math.round(pop * TAX_GOLD_PER_POP * this.taxLevel));
      this.morale = Math.max(0, this.morale - MORALE_TAX_PENALTY * this.taxLevel);
    }
    events.emit('morale:changed', { morale: Math.round(this.morale) });
  }

  /** Worker speed scales with morale (0.75–1.25). */
  moraleSpeedFactor(): number {
    return MORALE_SPEED_BASE + (this.morale / 100) * MORALE_SPEED_SPAN;
  }

  setTaxLevel(level: number): void {
    this.taxLevel = Math.max(0, Math.min(3, level));
  }

  /** Market trade: positive = sell to the market, negative = buy. */
  trade(resource: ResourceId, amount: number): void {
    if (this.duelMode || resource === 'gold') return;
    const sellFactor = this.techs.has('tradeGuild') ? TRADE_GUILD_SELL_FACTOR : 1;
    const buyFactor = this.techs.has('tradeGuild') ? TRADE_GUILD_BUY_FACTOR : 1;
    const base = SELL_PRICE[resource] ?? 0;
    if (base <= 0) return;
    if (amount > 0) {
      const units = Math.min(amount, this.store.get(resource));
      if (units <= 0) return;
      this.store.pay({ [resource]: units });
      this.store.add('gold', Math.round(units * base * sellFactor));
    } else {
      const units = -amount;
      const cost = Math.ceil(units * base * BUY_MARKUP * buyFactor);
      if (this.store.get('gold') < cost) {
        events.emit('toast:show', { message: 'Nicht genug Gold' });
        return;
      }
      this.store.pay({ gold: cost });
      this.store.add(resource, units);
    }
    this.sound.play('ui');
  }

  // --- Scenario victory ---------------------------------------------------------------

  private checkVictory(): void {
    if (this.victoryAnnounced || this.duelMode) return;
    const scenario = getScenario(this.scenarioId);
    if (!scenario.isWon) return;
    if (
      scenario.isWon({
        wavesSurvived:
          this.enemies.length === 0 ? this.waveSystem.waveNumber : this.waveSystem.waveNumber - 1,
        gold: this.store.get('gold'),
      })
    ) {
      this.victoryAnnounced = true;
      recordScore({
        waves: this.waveSystem.waveNumber,
        kills: this.waveSystem.kills,
        date: new Date().toLocaleDateString('de-DE'),
      });
      this.saveManager.clear();
      this.setPhase('gameover');
      this.sound.play('horn');
      events.emit('game:victory', { scenario: scenario.name, kills: this.waveSystem.kills });
    }
  }

  // --- Duel mode ----------------------------------------------------------------

  /** Compact shareable snapshot of the current castle. */
  exportCastleCode(): string {
    return encodeCastle({
      seed: this.seed,
      overrides: this.grid.terrainOverrides(),
      buildings: [...this.buildings.values()].map((b) => ({
        d: b.defId,
        x: b.x,
        y: b.y,
        r: b.rotated ? 1 : 0,
        l: b.level,
      })),
      soldiers: this.soldiers.map((s) => ({ x: s.tile.x, y: s.tile.y, t: s.typeId })),
      techs: [...this.techs],
    });
  }

  /** Start attacking a shared castle. Returns false with a toast on error. */
  startDuel(code: string): boolean {
    const castle = decodeCastle(code);
    if (!castle) {
      events.emit('toast:show', { message: 'Ungültiger Burg-Code' });
      return false;
    }
    const army = computeArmy(this.store.snapshot(), this.soldiers.length);
    if (army.length === 0) {
      events.emit('toast:show', { message: 'Zu wenig Vorräte (Brot/Waffen) für einen Angriff' });
      return false;
    }
    this.duelBackup = this.toSaveData();
    this.duelMode = true;
    this.duelOutcome = null;
    this.duelStats = { unitsLost: 0, buildingsDestroyed: 0, startMs: performance.now() };

    this.resetWorld(castle.seed);
    this.grid.applyTerrainOverrides(castle.overrides as [number, number, Terrain][]);
    this.renderer.buildTerrain(this.grid);
    this.setupSystems(new ResourceStore());
    for (const b of castle.buildings) {
      const placed = this.addBuilding(b.d, b.x, b.y, b.r === 1);
      placed.level = Math.max(1, Math.min(b.l, placed.maxLevel));
      placed.hp = placed.maxHp;
      placed.assignedWorkers = placed.workersRequired; // looks staffed
      if (placed.def.isWarehouse) this.warehouseId = placed.id;
    }
    for (const s of castle.soldiers) {
      this.soldiers.push(new Soldier(this.nextId++, s.x, s.y, s.t ?? 'soldier'));
    }
    for (const t of castle.techs) this.techs.add(t); // defender research applies

    this.duelQueue = army;
    const warehouse = this.buildings.get(this.warehouseId);
    if (warehouse) {
      const c = gridToScreen(warehouse.x + warehouse.w / 2, warehouse.y + warehouse.h / 2);
      this.camera.centerOn(c.x, c.y);
    }
    events.emit('tutorial:changed', { text: null });
    this.emitDuelStatus();
    this.setPhase('playing');
    events.emit('toast:show', { message: '⚔️ Duell! Tippe an den Kartenrand, um Truppen zu entsenden' });
    return true;
  }

  /** Player taps during a duel: release the next group at the map border. */
  private duelTap(worldX: number, worldY: number): void {
    const tile = screenToTile(worldX, worldY);
    if (!this.grid.inBounds(tile.x, tile.y)) return;
    const nearEdge =
      tile.x < DUEL_SPAWN_EDGE ||
      tile.y < DUEL_SPAWN_EDGE ||
      tile.x >= this.grid.width - DUEL_SPAWN_EDGE ||
      tile.y >= this.grid.height - DUEL_SPAWN_EDGE;
    if (!nearEdge) {
      events.emit('toast:show', { message: 'Truppen am Kartenrand entsenden' });
      return;
    }
    if (!isFinite(this.grid.enemyMoveCost(ENEMY_BREACH_COST_DUEL)(tile.x, tile.y))) {
      events.emit('toast:show', { message: 'Hier können Truppen nicht landen' });
      return;
    }
    if (this.duelQueue.length === 0) {
      events.emit('toast:show', { message: 'Keine Truppen mehr in Reserve' });
      return;
    }
    const group = this.duelQueue.splice(0, DUEL_GROUP_SIZE);
    for (const defId of group) {
      this.enemies.push(
        new Enemy(
          this.nextId++,
          tile.x + (Math.random() - 0.5) * 0.8,
          tile.y + (Math.random() - 0.5) * 0.8,
          defId,
        ),
      );
    }
    this.sound.play('horn');
    this.emitDuelStatus();
  }

  /** Resolve duel outcomes outside the combat iteration (safe point). */
  private tickDuel(): void {
    this.emitDuelStatus();
    if (this.duelOutcome === null && this.enemies.length === 0 && this.duelQueue.length === 0) {
      this.duelOutcome = 'defeat';
    }
    if (
      this.duelOutcome === null &&
      performance.now() - this.duelStats.startMs > DUEL_TIME_LIMIT * 1000
    ) {
      events.emit('toast:show', { message: 'Zeit abgelaufen — die Burg hält stand' });
      this.duelOutcome = 'defeat';
    }
    if (this.duelOutcome !== null) this.finishDuel(this.duelOutcome);
  }

  /** Abort button in the duel HUD. */
  abortDuel(): void {
    if (!this.duelMode) return;
    this.duelOutcome = 'aborted';
    this.setPhase('playing'); // ensure the next tick resolves it
  }

  private finishDuel(outcome: 'victory' | 'defeat' | 'aborted'): void {
    const stats = {
      victory: outcome === 'victory',
      unitsLost: this.duelStats.unitsLost,
      buildingsDestroyed: this.duelStats.buildingsDestroyed,
      seconds: Math.round((performance.now() - this.duelStats.startMs) / 1000),
    };
    const backup = this.duelBackup;
    this.duelMode = false;
    this.duelOutcome = null;
    this.duelQueue = [];
    this.duelBackup = null;
    if (backup) this.loadFromData(backup);
    this.setPhase('playing');
    if (outcome === 'aborted') {
      events.emit('toast:show', { message: 'Duell abgebrochen' });
    } else {
      events.emit('duel:ended', stats);
      this.sound.play(outcome === 'victory' ? 'horn' : 'gameover');
    }
  }

  private emitDuelStatus(): void {
    const key = `${this.duelQueue.length}:${this.enemies.length}`;
    if (key === this.duelLastStatus) return;
    this.duelLastStatus = key;
    events.emit('duel:status', { queued: this.duelQueue.length, alive: this.enemies.length });
  }

  // --- Forest ----------------------------------------------------------------

  /** A lumberjack felled one adjacent forest tile. */
  private fellForest(b: Building): void {
    const tile = b.adjacentTerrainTile(this.grid, Terrain.Forest);
    if (!tile) return;
    this.grid.setTerrain(tile.x, tile.y, Terrain.Grass);
    this.renderer.rebuildChunkAt(this.grid, tile.x, tile.y);
  }

  /** A few forest tiles try to spread onto free grass. */
  private regrowForest(): void {
    const forest: Point[] = [];
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        if (this.grid.terrainAt(x, y) === Terrain.Forest) forest.push({ x, y });
      }
    }
    if (forest.length === 0) return;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    for (let i = 0; i < FOREST_REGROW_ATTEMPTS; i++) {
      const src = forest[Math.floor(Math.random() * forest.length)];
      const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
      const nx = src.x + dx;
      const ny = src.y + dy;
      if (this.grid.isFree(nx, ny)) {
        this.grid.setTerrain(nx, ny, Terrain.Forest);
        this.renderer.rebuildChunkAt(this.grid, nx, ny);
      }
    }
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
    if (def.requires && !this.techs.has(def.requires as TechId)) {
      events.emit('toast:show', { message: `Benötigt erst: ${getTechDef(def.requires as TechId).name}` });
      return;
    }
    if (def.excludes && this.techs.has(def.excludes as TechId)) {
      events.emit('toast:show', { message: 'Der andere Zweig wurde bereits gewählt' });
      return;
    }
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
    if (this.duelMode) {
      this.duelTap(world.x, world.y);
      return;
    }
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
    if (this.duelMode) return; // defenders are not commandable
    if (this.selectedSoldierId === id) return;
    this.selectedSoldierId = id;
    if (id !== null && this.selectedId !== null) this.select(null);
    events.emit('soldier:selected', {
      soldier: id !== null ? (this.soldiers.find((s) => s.id === id) ?? null) : null,
    });
  }

  // --- Soldiers ----------------------------------------------------------------

  /** Recruit a soldier of the given type at a barracks (info panel action). */
  recruitSoldier(barracksId: number, typeId: SoldierTypeId = 'soldier'): void {
    if (this.duelMode) return;
    const barracks = this.buildings.get(barracksId);
    if (!barracks || !barracks.def.recruitsSoldiers) return;
    const type = getSoldierType(typeId);
    if (this.economy.workerTarget() <= MIN_WORKERS) {
      events.emit('toast:show', { message: 'Nicht genug Bevölkerung — baue Hütten' });
      return;
    }
    const missing = missingResourcesMessage(this.store, type.cost);
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
    this.store.pay(type.cost);
    this.soldiers.push(new Soldier(this.nextId++, spawn.x, spawn.y, typeId));
    this.sound.play('place');
    events.emit('toast:show', { message: `${type.name} rekrutiert` });
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
    // Roads, the starting warehouse and duel castles appear instantly;
    // everything else starts as a construction site awaiting materials.
    const instant =
      b.def.roadTier !== undefined || b.def.isWarehouse === true || this.duelMode;
    if (!instant && Object.keys(b.def.cost).length > 0) {
      b.underConstruction = true;
      b.materialsRemaining = { ...b.def.cost };
      b.buildTicks = b.totalBuildTicks;
    }
    this.buildings.set(b.id, b);
    this.grid.setOccupantRect(gx, gy, b.w, b.h, b.id, passModeOf(b.def));
    // Staff new workplaces automatically from the free population.
    if (b.workersRequired > 0) {
      b.assignedWorkers = Math.min(b.workersRequired, this.freePopulation());
      if (b.assignedWorkers < b.workersRequired) {
        events.emit('toast:show', { message: 'Zu wenig freie Bevölkerung — baue Hütten' });
      }
    }
    return b;
  }

  /** Population not bound as carrier minimum, soldier or building staff. */
  freePopulation(): number {
    return Math.max(0, this.economy.workerTarget() - MIN_WORKERS);
  }

  /** Info-panel action: change a building's staff by ±1. */
  assignWorker(buildingId: number, delta: 1 | -1): void {
    if (this.duelMode) return;
    const b = this.buildings.get(buildingId);
    if (!b || b.workersRequired === 0) return;
    if (delta > 0) {
      if (b.assignedWorkers >= b.workersRequired) return;
      if (this.freePopulation() <= 0) {
        events.emit('toast:show', { message: 'Keine freie Bevölkerung — baue Hütten' });
        return;
      }
      b.assignedWorkers++;
    } else if (b.assignedWorkers > 0) {
      b.assignedWorkers--;
    }
  }

  /** Repair price: half the build cost, scaled by missing hp. */
  repairCost(b: Building): Partial<Record<ResourceId, number>> {
    const fraction = 1 - b.hp / b.maxHp;
    const cost: Partial<Record<ResourceId, number>> = {};
    for (const r of RESOURCE_IDS) {
      const c = Math.ceil((b.def.cost[r] ?? 0) * DEMOLISH_REFUND * fraction);
      if (c > 0) cost[r] = c;
    }
    return cost;
  }

  /** Info-panel action: restore a damaged building to full hp. */
  repairBuilding(id: number): void {
    if (this.duelMode) return;
    const b = this.buildings.get(id);
    if (!b || b.hp >= b.maxHp) return;
    const cost = this.repairCost(b);
    const missing = missingResourcesMessage(this.store, cost);
    if (missing) {
      events.emit('toast:show', { message: missing });
      return;
    }
    this.store.pay(cost);
    b.hp = b.maxHp;
    this.sound.play('place');
    events.emit('toast:show', { message: `${b.def.name} repariert` });
  }

  /** Cost of the next level (base or explicit upgrade cost × level). */
  levelUpgradeCost(b: Building): Partial<Record<ResourceId, number>> {
    const base = b.def.upgradeCost ?? b.def.cost;
    const cost: Partial<Record<ResourceId, number>> = {};
    for (const r of RESOURCE_IDS) {
      const c = Math.ceil((base[r] ?? 0) * UPGRADE_COST_FACTOR * b.level);
      if (c > 0) cost[r] = c;
    }
    return cost;
  }

  /**
   * Info-panel action: roads swap their definition (Straße → Pflasterstraße),
   * every other building rises one level (more hp, faster production,
   * stronger towers, larger huts).
   */
  upgradeBuilding(id: number): void {
    if (this.duelMode) return;
    const b = this.buildings.get(id);
    if (!b) return;
    const targetId = b.def.upgradesTo as BuildingDefId | undefined;
    if (targetId) {
      const target = getDef(targetId);
      const missing = missingResourcesMessage(this.store, target.cost);
      if (missing) {
        events.emit('toast:show', { message: missing });
        return;
      }
      this.store.pay(target.cost);
      this.grid.setOccupantRect(b.x, b.y, b.w, b.h, NO_OCCUPANT);
      this.buildings.delete(b.id);
      this.economy.onBuildingRemoved(b.id);
      const upgraded = this.addBuilding(targetId, b.x, b.y, b.rotated);
      this.sound.play('place');
      this.select(upgraded.id);
      return;
    }
    if (b.level >= b.maxLevel) return;
    const cost = this.levelUpgradeCost(b);
    const missing = missingResourcesMessage(this.store, cost);
    if (missing) {
      events.emit('toast:show', { message: missing });
      return;
    }
    this.store.pay(cost);
    b.level++;
    b.hp = b.maxHp; // an upgrade includes a full repair
    this.sound.play('place');
    events.emit('toast:show', { message: `${b.def.name} auf Stufe ${b.level} ausgebaut` });
  }

  demolish(id: number): void {
    if (this.duelMode) return;
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
    if (this.duelMode) {
      this.duelStats.buildingsDestroyed++;
      if (b.def.isWarehouse) this.duelOutcome = 'victory'; // resolved next tick
      return;
    }
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
    recordScore({
      waves: Math.max(0, this.waveSystem.waveNumber - 1),
      kills: this.waveSystem.kills,
      date: new Date().toLocaleDateString('de-DE'),
    });
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
      terrainOverrides: this.grid.terrainOverrides(),
      morale: this.morale,
      taxLevel: this.taxLevel,
      seasonTicks: this.seasonTicks,
      scenarioId: this.scenarioId,
    };
  }

  saveNow(): void {
    if (this.duelMode) return; // never persist the opponent's castle
    this.saveManager.save(this.toSaveData());
  }

  loadFromData(data: SaveData): void {
    this.resetWorld(data.seed);
    // Re-apply terrain changes (felled/regrown forest) before buildings.
    if (data.terrainOverrides.length > 0) {
      this.grid.applyTerrainOverrides(data.terrainOverrides as [number, number, Terrain][]);
      this.renderer.buildTerrain(this.grid);
    }
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
    this.morale = data.morale;
    this.taxLevel = data.taxLevel;
    this.seasonTicks = data.seasonTicks;
    this.scenarioId = (data.scenarioId in SCENARIOS ? data.scenarioId : 'endless') as ScenarioId;
    this.lastSeason = -1;
    events.emit('morale:changed', { morale: Math.round(this.morale) });
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
  restartNewGame(scenarioId: ScenarioId = 'endless'): void {
    if (this.duelMode) {
      events.emit('toast:show', { message: 'Erst das Duell beenden' });
      return;
    }
    this.saveManager.clear();
    this.buildSystem.cancel();
    this.newGame(undefined, scenarioId);
    this.setPhase('playing');
    events.emit('toast:show', { message: 'Neues Spiel gestartet' });
  }
}
