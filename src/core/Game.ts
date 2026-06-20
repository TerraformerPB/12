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
  LUXURY_BEER_PER_POP,
  LUXURY_CLOTH_PER_POP,
  PRESTIGE_LUXURY_BONUS,
  PRESTIGE_PER_CARAVAN,
  CONTRACT_PRESTIGE,
  PRESTIGE_PER_POP,
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
import { Woodcutter } from '../entities/Woodcutter';
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
import { generateTerrain, mirrorTerrainEastWest } from '../world/TerrainGenerator';
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
import { createOnlineMenu } from '../ui/OnlineMenu';
import { createDiplomacyPanel } from '../ui/DiplomacyPanel';
import type { BuildingDef } from '../data/buildings';
import { getTechDef, TECH_EFFECTS, type TechId } from '../data/techs';
import {
  FOREST_REGROW_ATTEMPTS,
  FOREST_REGROW_INTERVAL,
  UPGRADE_COST_FACTOR,
  UPGRADE_MARKET_PRICE_BONUS,
  VETERAN_THRESHOLDS,
} from '../data/config';
import { recordScore } from './Highscores';
import {
  BUY_MARKUP,
  SELL_PRICE,
  TRADE_GUILD_BUY_FACTOR,
  TRADE_GUILD_SELL_FACTOR,
} from '../data/market';
import {
  DUEL_BUDGETS,
  DUEL_DEPLOY_COSTS,
  DUEL_NODES,
  DUEL_NODE_INTERVAL,
  DUEL_NODE_RADIUS,
  DUEL_NODE_YIELD,
  DUEL_TIME_LIMIT,
  duelClearRects,
  type DuelAiLevelId,
  type DuelBudgetId,
} from '../data/duel';
import { DuelAI } from '../systems/DuelAI';
import { loadDuelRating, recordDuel } from './DuelRating';
import { DiplomacySystem } from '../systems/DiplomacySystem';
import { RANKS, nextRank, rankFor } from '../data/ranks';
import { encodeCastle } from './CastleCode';
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
  /** Woodcutters derived from staffed lumberjacks (transient, not saved). */
  readonly gatherers: Woodcutter[] = [];
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
  /** Empire scenario: prestige drives the rank ladder. */
  prestige = 0;
  diplomacy!: DiplomacySystem;
  private lastRankIndex = 0;
  /** Swapped for an AdMob-backed provider in the store build (phase 6). */
  ads!: RewardedAdProvider;
  private reviveUsed = false;
  private lostWarehouseSpot: { x: number; y: number; rotated: boolean } | null = null;
  // --- Duel mode (Burg-Duell): mirrored 1v1 against a budgeted AI. ---
  duelMode = false;
  private duelAI: DuelAI | null = null;
  private foeWarehouseId = 0;
  /** Selected deployment card (Clash-style unit placement). */
  duelDeployType: SoldierTypeId | null = null;
  private duelLevel: DuelAiLevelId = 'normal';
  private duelSpawnCount = 0;
  /** Matched player when the running duel is an online match. */
  private onlineOpponent: { id: number; username: string } | null = null;
  /** Capturable resource depots on the duel battlefield. */
  duelNodes: { x: number; y: number; resource: ResourceId; icon: string; owner: 'none' | 'player' | 'foe' }[] = [];
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
  diplomacyPanel: { toggle(): void } | null = null;
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
    this.diplomacyPanel = createDiplomacyPanel(uiRoot, this);
    createOnlineMenu(uiRoot, this);
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

  private resetWorld(
    seed: number,
    mirrorClearRects?: { x: number; y: number; w: number; h: number }[],
  ): void {
    this.seed = seed;
    this.nextId = 1;
    this.selectedId = null;
    this.selectedSoldierId = null;
    this.buildings.clear();
    this.workers.length = 0;
    this.gatherers.length = 0;
    this.soldiers.length = 0;
    this.enemies.length = 0;
    this.techs.clear();
    this.tutorialStep = 0;
    this.morale = MORALE_START;
    this.taxLevel = 0;
    this.seasonTicks = 0;
    this.victoryAnnounced = false;
    this.prestige = 0;
    this.lastRankIndex = 0;
    this.reviveUsed = false;
    this.lostWarehouseSpot = null;
    this.grid = new IsoGrid(MAP_W, MAP_H);
    generateTerrain(this.grid, seed);
    // Duel maps are mirrored at the middle so both sides face equal terrain.
    if (mirrorClearRects) mirrorTerrainEastWest(this.grid, mirrorClearRects);
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
      gatherers: this.gatherers,
      getWarehouse: () => this.buildings.get(this.warehouseId) ?? null,
      nextEntityId: () => this.nextId++,
      getSoldierCount: () => this.soldiers.length,
      getSpeedFactor: () =>
        (this.techs.has('fastCarriers') ? TECH_EFFECTS.fastCarriersSpeed : 1) *
        (this.techs.has('freeBeer') ? TECH_EFFECTS.freeBeerSpeed : 1) *
        this.moraleSpeedFactor(),
      fellForestTile: (b) => this.fellForest(b),
      fellTileAt: (tile) => this.fellTile(tile),
      depleteOreTile: (b) => this.depleteOre(b),
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
      getFoeWarehouse: () =>
        this.foeWarehouseId !== 0 ? (this.buildings.get(this.foeWarehouseId) ?? null) : null,
    });
    this.buildSystem = new BuildSystem({
      grid: this.grid,
      store,
      placeBuilding: (defId, gx, gy, rotated) => {
        this.addBuilding(defId, gx, gy, rotated);
        this.sound.play('place');
      },
      // Roads/bridges build instantly and are paid up front; everything
      // else becomes a construction site supplied by carriers. Duels are
      // fast skirmishes: everything builds instantly there.
      paysUpFront: (defId) => getDef(defId).roadTier !== undefined || this.duelMode,
      lockedReason: (defId) => this.buildLockReason(defId),
    });
    this.diplomacy = new DiplomacySystem({
      store,
      spawnRaid: (strength) => this.waveSystem.spawnRaid(strength),
      onCaravanReturned: () => this.addPrestige(PRESTIGE_PER_CARAVAN),
      onContractFulfilled: () => this.addPrestige(CONTRACT_PRESTIGE),
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
    this.lastRankEmit = '';
    this.emitRank();
    this.checkTutorial(true);
    events.emit('game:loaded', undefined);
  }

  /** Wirtschaftssimulator: no waves, diplomacy decides war and peace. */
  get empireMode(): boolean {
    return this.scenarioId === 'empire' && !this.duelMode;
  }

  /** Current rank index (empire scenario). */
  get rankIndex(): number {
    return rankFor(this.prestige).index;
  }

  // --- Loop ------------------------------------------------------------------

  private tickCount = 0;

  tick(): void {
    if (this.phase !== 'playing') return;
    this.tickCount++;
    if (this.duelMode) {
      // Clash-style: no production — resources come from the inventory
      // budget and captured depots only. The AI opponent replaces waves.
      this.soldierSystem.tick();
      this.combatSystem.tick();
      this.duelAI?.tick();
      this.tickDuelNodes();
      this.tickDuel();
      return;
    }
    this.seasonTicks++;
    this.economy.tick();
    this.soldierSystem.tick();
    // Empire: no scheduled waves — war is a diplomacy failure state.
    if (this.empireMode) this.diplomacy.tick();
    else this.waveSystem.tick();
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
    if (this.empireMode) this.luxuryAndPrestigeTick(pop);
    events.emit('morale:changed', { morale: Math.round(this.morale) });
  }

  /**
   * Empire scenario: the population wants luxuries (beer, cloth) on top
   * of food. Fulfilled needs lift morale and grant bonus prestige; the
   * base prestige flow scales with population.
   */
  private luxuryAndPrestigeTick(pop: number): void {
    let gained = pop * PRESTIGE_PER_POP;
    for (const [resource, perPop] of [
      ['beer', LUXURY_BEER_PER_POP],
      ['cloth', LUXURY_CLOTH_PER_POP],
    ] as const) {
      const need = Math.ceil(pop * perPop);
      if (need <= 0) continue;
      const take = Math.min(need, this.store.get(resource));
      if (take > 0) this.store.pay({ [resource]: take });
      if (take >= need) {
        gained += PRESTIGE_LUXURY_BONUS;
        this.morale = Math.min(100, this.morale + 1);
      }
    }
    this.addPrestige(gained);
  }

  /** Add prestige and announce rank promotions. */
  addPrestige(amount: number): void {
    this.prestige += amount;
    const rank = rankFor(this.prestige);
    if (rank.index !== this.lastRankIndex) {
      this.lastRankIndex = rank.index;
      this.sound.play('horn');
      events.emit('toast:show', { message: `${rank.icon} Aufstieg: Du bist jetzt ${rank.name}!` });
      events.emit('techs:changed', { researched: [...this.techs] }); // refresh build menu locks
    }
    this.emitRank();
  }

  private lastRankEmit = '';

  private emitRank(): void {
    const rank = rankFor(this.prestige);
    const next = nextRank(this.prestige);
    const key = `${rank.index}:${Math.floor(this.prestige)}:${next?.prestige ?? 0}`;
    if (key === this.lastRankEmit) return;
    this.lastRankEmit = key;
    events.emit('rank:changed', {
      rank: rank.index,
      name: rank.name,
      icon: rank.icon,
      prestige: Math.floor(this.prestige),
    });
  }

  /** Empire scenario gates some buildings behind ranks. */
  buildLockReason(defId: BuildingDefId): string | null {
    if (!this.empireMode) return null;
    const required = getDef(defId).requiredRank ?? 0;
    if (this.rankIndex >= required) return null;
    const rank = RANKS[required];
    return `${rank.icon} Erst ab Rang ${rank.name}`;
  }

  /** Worker speed scales with morale (0.75–1.25). */
  moraleSpeedFactor(): number {
    return MORALE_SPEED_BASE + (this.morale / 100) * MORALE_SPEED_SPAN;
  }

  setTaxLevel(level: number): void {
    this.taxLevel = Math.max(0, Math.min(3, level));
  }

  /** Best finished market level (level upgrades improve sell prices). */
  private bestMarketLevel(): number {
    let best = 0;
    for (const b of this.buildings.values()) {
      if (b.defId === 'market' && !b.underConstruction) best = Math.max(best, b.level);
    }
    return best;
  }

  /** Market trade: positive = sell to the market, negative = buy. */
  trade(resource: ResourceId, amount: number): void {
    if (this.duelMode || resource === 'gold') return;
    const marketBonus = 1 + UPGRADE_MARKET_PRICE_BONUS * Math.max(0, this.bestMarketLevel() - 1);
    const sellFactor =
      (this.techs.has('tradeGuild') ? TRADE_GUILD_SELL_FACTOR : 1) * marketBonus;
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
        prestige: this.prestige,
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

  /**
   * Burg-Duell: mirrored map, one identical small castle per side, the same
   * resource budget for both. The opponent (DuelAI) converts its budget into
   * attack squads; destroy its warehouse before yours falls.
   */
  startMirrorDuel(budgetId: DuelBudgetId, level: DuelAiLevelId = 'normal'): boolean {
    if (this.duelMode) return false;
    const budget = DUEL_BUDGETS[budgetId];
    this.duelBackup = this.toSaveData();
    this.duelMode = true;
    this.duelLevel = level;
    this.duelSpawnCount = 0;
    this.duelOutcome = null;
    this.duelStats = { unitsLost: 0, buildingsDestroyed: 0, startMs: performance.now() };

    const cy = Math.floor(MAP_H / 2);
    this.resetWorld((Math.random() * 0xffffffff) >>> 0, duelClearRects(MAP_W, MAP_H));
    this.setupSystems(new ResourceStore(budget.resources));
    this.duelNodes = DUEL_NODES.flatMap((n) => [
      { ...n, owner: 'none' as const },
      { ...n, x: MAP_W - 1 - n.x, owner: 'none' as const },
    ]);
    this.duelDeployType = null;

    this.warehouseId = this.buildCastle('player', cy);
    this.foeWarehouseId = this.buildCastle('foe', cy);

    this.duelAI = new DuelAI(
      {
        enemies: this.enemies,
        nextEntityId: () => this.nextId++,
        spawnTile: () => this.duelSpawnTile(),
        playSound: (id) => this.sound.play(id),
        onSquadSent: (size) =>
          events.emit('toast:show', { message: `⚔️ Der Gegner schickt ${size} Angreifer!` }),
      },
      budget.resources,
      level,
    );

    const wh = this.buildings.get(this.warehouseId);
    if (wh) {
      const c = gridToScreen(wh.x + wh.w / 2, wh.y + wh.h / 2);
      this.camera.centerOn(c.x, c.y);
    }
    events.emit('tutorial:changed', { text: null });
    this.duelLastStatus = '';
    this.emitDuelStatus();
    this.setPhase('playing');
    events.emit('toast:show', {
      message: '⚔️ Burg-Duell! Zerstöre das gegnerische Lagerhaus im Osten',
    });
    return true;
  }

  /**
   * One side's starting castle: warehouse, two towers and a wall line with
   * an open gate in front. Layout is written in west coordinates and
   * mirrored for the foe so both sides are identical. Returns warehouse id.
   */
  private buildCastle(side: 'player' | 'foe', cy: number): number {
    const place = (defId: BuildingDefId, wx: number, wy: number): Building => {
      const def = getDef(defId);
      const x = side === 'player' ? wx : MAP_W - 1 - (wx + def.footprint.w - 1);
      const b = this.addBuilding(defId, x, wy, false);
      b.owner = side;
      if (side === 'foe') b.assignedWorkers = b.workersRequired;
      return b;
    };
    const warehouse = place('warehouse', 3, cy - 1);
    place('tower', 6, cy - 3);
    place('tower', 6, cy + 2);
    // Wall line toward the map center, gate gap in front of the warehouse.
    for (let y = cy - 4; y <= cy + 4; y++) {
      if (y === cy - 1 || y === cy) continue;
      place('wall', 8, y);
    }
    return warehouse.id;
  }

  /**
   * AI marshalling tile: rotates between the castle gate and spots next to
   * the mirrored depots, so AI squads contest the flags on their way out.
   */
  private duelSpawnTile(): Point {
    const cy = Math.floor(MAP_H / 2);
    const spots = [
      { x: MAP_W - 12, y: cy },
      ...this.duelNodes
        .filter((n) => n.x >= Math.floor(MAP_W / 2))
        .map((n) => ({ x: n.x + 1, y: n.y })),
    ];
    const base = spots[this.duelSpawnCount++ % spots.length];
    for (let dy = 0; dy < 8; dy++) {
      for (const y of [base.y + dy, base.y - dy]) {
        if (this.grid.inBounds(base.x, y) && this.grid.occupantAt(base.x, y) === NO_OCCUPANT) {
          return { x: base.x, y };
        }
      }
    }
    return { x: MAP_W - 12, y: cy };
  }

  /** Resolve duel outcomes outside the combat iteration (safe point). */
  private tickDuel(): void {
    this.emitDuelStatus();
    if (
      this.duelOutcome === null &&
      performance.now() - this.duelStats.startMs > DUEL_TIME_LIMIT * 1000
    ) {
      // Time out: the castle in better shape wins.
      events.emit('toast:show', { message: '⏳ Zeit abgelaufen' });
      this.duelOutcome =
        this.warehouseHpRatio(this.warehouseId) > this.warehouseHpRatio(this.foeWarehouseId)
          ? 'victory'
          : 'defeat';
    }
    if (this.duelOutcome !== null) this.finishDuel(this.duelOutcome);
  }

  private warehouseHpRatio(id: number): number {
    const b = this.buildings.get(id);
    return b ? b.hp / b.maxHp : 0;
  }

  /**
   * Capture & income of the battlefield depots: a side controls a depot
   * while only its units stand nearby; controlled depots pay out their
   * resource every few seconds (player → inventory, AI → its budget).
   */
  private tickDuelNodes(): void {
    for (const node of this.duelNodes) {
      const playerNear = this.soldiers.some(
        (s) => Math.hypot(s.x - node.x, s.y - node.y) <= DUEL_NODE_RADIUS,
      );
      const foeNear = this.enemies.some(
        (e) => Math.hypot(e.x - node.x, e.y - node.y) <= DUEL_NODE_RADIUS,
      );
      const owner = playerNear && !foeNear ? 'player' : foeNear && !playerNear ? 'foe' : node.owner;
      if (owner !== node.owner) {
        node.owner = owner;
        if (owner === 'player') {
          events.emit('toast:show', { message: `${node.icon} Lager erobert!` });
          this.sound.play('ui');
        } else if (owner === 'foe') {
          events.emit('toast:show', { message: `${node.icon} Lager an den Gegner verloren!` });
        }
      }
    }
    if (this.tickCount % (DUEL_NODE_INTERVAL * TICK_RATE) === 0) {
      for (const node of this.duelNodes) {
        if (node.owner === 'player') this.store.add(node.resource, DUEL_NODE_YIELD);
        else if (node.owner === 'foe') this.duelAI?.credit(node.resource, DUEL_NODE_YIELD);
      }
    }
  }

  /** Toggle the deployment card (Clash-style unit placement). */
  setDuelDeploy(typeId: SoldierTypeId | null): void {
    this.duelDeployType = this.duelDeployType === typeId ? null : typeId;
    this.buildSystem.cancel();
  }

  /** Deploy the selected unit on the own half. Returns true on success. */
  private tryDeployDuelUnit(worldX: number, worldY: number): boolean {
    const typeId = this.duelDeployType;
    if (!typeId) return false;
    const tile = screenToTile(worldX, worldY);
    if (!this.grid.inBounds(tile.x, tile.y)) return false;
    if (tile.x >= Math.floor(MAP_W / 2) - 1) {
      events.emit('toast:show', { message: 'Nur auf deiner Kartenhälfte absetzen' });
      return false;
    }
    if (!isFinite(this.grid.moveCost(tile.x, tile.y))) {
      events.emit('toast:show', { message: 'Hier können Truppen nicht stehen' });
      return false;
    }
    const cost = DUEL_DEPLOY_COSTS[typeId];
    const missing = missingResourcesMessage(this.store, cost);
    if (missing) {
      events.emit('toast:show', { message: missing });
      return false;
    }
    this.store.pay(cost);
    const unit = new Soldier(this.nextId++, tile.x, tile.y, typeId);
    unit.mode = 'advance';
    this.soldiers.push(unit);
    this.sound.play('place');
    return true;
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
    this.duelAI = null;
    this.foeWarehouseId = 0;
    this.duelNodes = [];
    this.duelDeployType = null;
    this.duelBackup = null;
    const opponent = this.onlineOpponent;
    this.onlineOpponent = null;
    if (backup) this.loadFromData(backup);
    this.setPhase('playing');
    if (outcome === 'aborted') {
      events.emit('toast:show', { message: 'Duell abgebrochen' });
    } else {
      // Trophies are the offline rating — the future match system's MMR.
      const { delta } = recordDuel(outcome === 'victory', this.duelLevel);
      events.emit('duel:ended', { ...stats, trophyDelta: delta });
      // Online matches additionally settle the server-side Elo.
      if (opponent) {
        events.emit('duel:onlineResult', {
          opponentId: opponent.id,
          username: opponent.username,
          victory: outcome === 'victory',
        });
      }
      this.sound.play(outcome === 'victory' ? 'horn' : 'gameover');
    }
  }

  /** Compact shareable snapshot of the current castle (server upload). */
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

  /**
   * Online match: a mirror duel played against the matched player — the
   * AI takes their seat, its difficulty scales with the rating gap. The
   * result settles the server-side Elo via 'duel:onlineResult'.
   */
  startOnlineDuel(opponent: { id: number; username: string; trophies: number }): boolean {
    const own = loadDuelRating().trophies;
    const level: DuelAiLevelId =
      opponent.trophies - own > 100 ? 'schwer' : own - opponent.trophies > 100 ? 'leicht' : 'normal';
    if (!this.startMirrorDuel('mittel', level)) return false;
    this.onlineOpponent = { id: opponent.id, username: opponent.username };
    events.emit('toast:show', { message: `🌍 Online-Duell gegen ${opponent.username}!` });
    return true;
  }

  private emitDuelStatus(): void {
    const own = Math.round(this.warehouseHpRatio(this.warehouseId) * 100);
    const foe = Math.round(this.warehouseHpRatio(this.foeWarehouseId) * 100);
    const key = `${own}:${foe}:${this.enemies.length}`;
    if (key === this.duelLastStatus) return;
    this.duelLastStatus = key;
    events.emit('duel:status', { ownHp: own, foeHp: foe, foes: this.enemies.length });
  }

  // --- Forest ----------------------------------------------------------------

  /** A lumberjack felled one adjacent forest tile. */
  private fellForest(b: Building): void {
    const tile = b.adjacentTerrainTile(this.grid, Terrain.Forest);
    if (!tile) return;
    this.fellTile(tile);
  }

  /** Turn one specific forest tile to grass (a woodcutter exhausted it). */
  private fellTile(tile: Point): void {
    if (this.grid.terrainAt(tile.x, tile.y) !== Terrain.Forest) return;
    this.grid.setTerrain(tile.x, tile.y, Terrain.Grass);
    this.renderer.rebuildChunkAt(this.grid, tile.x, tile.y);
  }

  /** A mine emptied one adjacent ore vein — it turns to plain rock. */
  private depleteOre(b: Building): void {
    const tile = b.adjacentTerrainTile(this.grid, Terrain.Ore);
    if (!tile) return;
    this.grid.setTerrain(tile.x, tile.y, Terrain.Rock);
    this.renderer.rebuildChunkAt(this.grid, tile.x, tile.y);
    if (b.adjacentTerrainTile(this.grid, Terrain.Ore) === null) {
      events.emit('toast:show', { message: '⛏️ Erzader erschöpft — die Mine steht still' });
    }
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
        gatherers: this.gatherers,
        soldiers: this.soldiers,
        enemies: this.enemies,
        projectiles: this.combatSystem?.projectiles ?? [],
        ghost: this.buildSystem?.ghost ?? null,
        selectedId: this.selectedId,
        selectedSoldierId: this.selectedSoldierId,
        duelNodes: this.duelMode ? this.duelNodes : null,
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
    // Duel deployment card selected: taps drop units instead of selecting.
    if (this.duelMode && this.duelDeployType !== null) {
      this.tryDeployDuelUnit(world.x, world.y);
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
    // The opposing castle cannot be inspected — send soldiers instead.
    const hit = occupant === NO_OCCUPANT ? null : (this.buildings.get(occupant) ?? null);
    if (hit && hit.owner === 'foe') {
      events.emit('toast:show', { message: 'Feindliche Burg — schicke deine Soldaten!' });
      this.select(null);
      return;
    }
    this.select(hit ? hit.id : null);
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

  /** Recruit a soldier of the given type at a barracks (info panel action). */
  recruitSoldier(barracksId: number, typeId: SoldierTypeId = 'soldier'): void {
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
    const soldier = new Soldier(this.nextId++, spawn.x, spawn.y, typeId);
    // Veteran training: higher-level barracks field pre-promoted recruits.
    if (barracks.level >= 2) soldier.kills = VETERAN_THRESHOLDS[barracks.level - 2];
    this.soldiers.push(soldier);
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

  private addBuilding(
    defId: BuildingDefId,
    gx: number,
    gy: number,
    rotated: boolean,
    forceInstant = false,
  ): Building {
    const b = new Building(this.nextId++, defId, gx, gy, rotated);
    // Roads, the starting warehouse, duel castles and def-swap upgrades
    // appear instantly; everything else is a supplied construction site.
    const instant =
      forceInstant || b.def.roadTier !== undefined || b.def.isWarehouse === true || this.duelMode;
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
    const b = this.buildings.get(buildingId);
    if (!b || b.owner !== 'player' || b.workersRequired === 0) return;
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
    const b = this.buildings.get(id);
    if (!b || b.owner !== 'player' || b.hp >= b.maxHp) return;
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
  /** Def-swap upgrade cost: target cost minus the old building's refund. */
  defUpgradeCost(b: Building): Partial<Record<ResourceId, number>> {
    const targetId = b.def.upgradesTo as BuildingDefId | undefined;
    if (!targetId) return {};
    const target = getDef(targetId);
    const cost: Partial<Record<ResourceId, number>> = {};
    for (const r of RESOURCE_IDS) {
      const net = (target.cost[r] ?? 0) - Math.floor((b.def.cost[r] ?? 0) * DEMOLISH_REFUND);
      if (net > 0) cost[r] = net;
    }
    return cost;
  }

  upgradeBuilding(id: number): void {
    const b = this.buildings.get(id);
    if (!b || b.owner !== 'player') return;
    const targetId = b.def.upgradesTo as BuildingDefId | undefined;
    if (targetId) {
      if (this.buildLockReason(targetId)) {
        events.emit('toast:show', { message: this.buildLockReason(targetId)! });
        return;
      }
      // The old building counts toward the new one: its demolition refund
      // is deducted, so upgrading never costs as much as building fresh.
      const cost = this.defUpgradeCost(b);
      const missing = missingResourcesMessage(this.store, cost);
      if (missing) {
        events.emit('toast:show', { message: missing });
        return;
      }
      this.store.pay(cost);
      this.grid.setOccupantRect(b.x, b.y, b.w, b.h, NO_OCCUPANT);
      this.buildings.delete(b.id);
      this.economy.onBuildingRemoved(b.id);
      // Swapping an existing structure is instant — there is no fresh
      // construction site on top of a standing building.
      const upgraded = this.addBuilding(targetId, b.x, b.y, b.rotated, true);
      if (upgraded.def.isWarehouse) this.warehouseId = upgraded.id;
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
    const b = this.buildings.get(id);
    if (!b || b.owner !== 'player' || b.def.isWarehouse) return;
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
      if (b.owner === 'foe') this.duelStats.buildingsDestroyed++;
      if (b.def.isWarehouse) {
        // Resolved next tick (outside the combat iteration).
        this.duelOutcome = b.owner === 'foe' ? 'victory' : 'defeat';
      }
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
      prestige: this.prestige,
      diplomacy: this.empireMode ? this.diplomacy.toSave() : null,
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
    this.prestige = data.prestige ?? 0;
    this.lastRankIndex = this.rankIndex;
    if (data.diplomacy) this.diplomacy.restore(data.diplomacy);
    this.emitRank();
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
