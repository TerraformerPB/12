import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { RESOURCE_INFO, TERRAIN_CHUNK_SIZE, TILE_H, TILE_W } from '../data/config';
import { getDef } from '../data/buildings';
import type { Building } from '../entities/Building';
import type { Enemy } from '../entities/Enemy';
import type { Soldier } from '../entities/Soldier';
import type { Worker } from '../entities/Worker';
import type { Projectile } from '../systems/CombatSystem';
import type { Camera } from '../world/Camera';
import { gridToScreen, type IsoGrid, Terrain, type Point } from '../world/IsoGrid';
import { findPath } from '../world/Pathfinding';
import type { GhostState } from '../systems/BuildSystem';
import {
  PALETTE,
  drawEnemy,
  drawGhost,
  drawHpBar,
  drawSelection,
  drawSoldier,
  drawTerrainTile,
  drawTerrainEdges,
  drawWorker,
  drawFisheryBoat,
  drawDecorativeNPC,
  footprintCorners,
} from './placeholders';
import { rotatedFootprint } from '../systems/BuildSystem';
import { BuildingSprites } from './BuildingSprites';
import { UnitSprites, unitFrame, type UnitSpriteSet } from './UnitSprites';

/** World-space bounding box used for culling. */
interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface BuildingViewEntry {
  view: Container;
  sprite: Sprite;
  hpBar: Graphics;
  bounds: Bounds;
  /** Redraw trigger for the hp/construction overlay. */
  lastOverlayKey: string;
  lastLevel: number;
  /** Floating upgrade-level badge (star pips), shown from level 2. */
  levelBadge?: Graphics;
  /** Redraw trigger for the level badge (level + construction state). */
  lastBadgeKey?: string;
  sailsGfx?: Graphics;
  sailsAngle?: number;
}

interface UnitViewEntry {
  view: Container;
  /** Animated sprite when real art exists, otherwise null (gfx fallback). */
  sprite: Sprite | null;
  /** Fallback drawing or overlay (cargo, hp bar, selection ring). */
  gfx: Graphics;
  set: UnitSpriteSet | null;
  lastFrame: number;
  facing: number;
  lastKey: string;
}

interface DecorativeNPCState {
  buildingId: number;
  type: 'lumberjack' | 'miner' | 'quarryman' | 'farmer';
  x: number;
  y: number;
  phase: 'toTarget' | 'working' | 'returning' | 'idle';
  path: Point[];
  pathIndex: number;
  targetTile: Point | null;
  timer: number;
  view: Container;
  sprite: Sprite | null;
  gfx: Graphics;
  set: UnitSpriteSet | null;
  facing: number;
  lastFrame: number;
}

interface FisheryBoatState {
  buildingId: number;
  x: number;
  y: number;
  view: Container;
  gfx: Graphics;
  bobTimer: number;
}

/** Everything the renderer needs to draw one frame. */
export interface RenderState {
  grid: IsoGrid;
  buildings: Map<number, Building>;
  workers: Worker[];
  soldiers: Soldier[];
  enemies: Enemy[];
  projectiles: Projectile[];
  ghost: GhostState | null;
  selectedId: number | null;
  selectedSoldierId: number | null;
  /** Capturable resource depots while a duel is running. */
  duelNodes: { x: number; y: number; owner: 'none' | 'player' | 'foe' }[] | null;
}

const CULL_MARGIN = TILE_W * 2;

/** Tiny vertical hop while a unit moves (driven by its position). */
function walkBob(fx: number, fy: number, moving: boolean): number {
  return moving ? -Math.abs(Math.sin((fx + fy) * Math.PI * 2)) * 1.6 : 0;
}

/**
 * Owns the Pixi application and all display objects. Reads pure game state
 * each frame; game logic never touches Pixi. Placeholder art comes from
 * `placeholders.ts` and can be swapped for sprites without changing this
 * sync logic.
 */
export class WorldRenderer {
  private app!: Application;
  private world!: Container;
  private terrainLayer!: Container;
  /** Flat markers (selection) drawn above terrain, below objects. */
  private markerLayer!: Container;
  private objectLayer!: Container;

  private terrainChunks = new Map<number, { view: Sprite; bounds: Bounds }>();
  private chunkCols = 0;
  private buildingSprites = new BuildingSprites();
  private buildingViews = new Map<number, BuildingViewEntry>();
  private unitSprites = new UnitSprites();
  private workerViews = new Map<number, UnitViewEntry>();
  private soldierViews = new Map<number, UnitViewEntry>();
  private enemyViews = new Map<number, UnitViewEntry>();
  private projectileView!: Graphics;
  private ghostView!: Graphics;
  private ghostKey = '';
  private selectionView!: Graphics;
  private selectionKey = '';
  private fogView!: Graphics;
  private decorativeNPCs = new Map<string, DecorativeNPCState>();
  private fisheryBoats = new Map<number, FisheryBoatState>();
  private lastTime = performance.now();

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  async init(root: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      background: PALETTE.background,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
    });
    this.app.ticker.stop(); // frames are rendered manually from the game loop
    root.appendChild(this.app.canvas);
    await this.buildingSprites.loadExternal();
    await this.unitSprites.load();

    this.world = new Container();
    this.terrainLayer = new Container();
    this.markerLayer = new Container();
    this.objectLayer = new Container();
    this.objectLayer.sortableChildren = true;
    this.world.addChild(this.terrainLayer, this.markerLayer, this.objectLayer);
    this.app.stage.addChild(this.world);

    this.ghostView = new Graphics();
    this.ghostView.zIndex = 1_000_000; // always on top of objects
    this.ghostView.visible = false;
    this.objectLayer.addChild(this.ghostView);

    this.projectileView = new Graphics();
    this.projectileView.zIndex = 999_999; // arrows fly above everything
    this.objectLayer.addChild(this.projectileView);

    this.selectionView = new Graphics();
    this.selectionView.visible = false;
    this.markerLayer.addChild(this.selectionView);

    this.fogView = new Graphics();
    this.world.addChild(this.terrainLayer, this.markerLayer, this.objectLayer, this.fogView);

    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w: number, h: number): void {
    if (!this.app) return;
    this.app.renderer.resize(w, h);
  }

  /** Seasonal map mood — terrain is baked into chunk textures, so one tint. */
  setSeasonTint(color: number): void {
    if (!this.terrainLayer) return;
    this.terrainLayer.tint = color;
  }

  /** (Re)build the static terrain chunk textures. Call after terrain changes. */
  buildTerrain(grid: IsoGrid): void {
    if (!this.terrainLayer) return;
    for (const chunk of this.terrainChunks.values()) chunk.view.destroy(true);
    this.terrainChunks.clear();
    this.terrainLayer.removeChildren();
    this.chunkCols = Math.ceil(grid.width / TERRAIN_CHUNK_SIZE);

    for (let cy = 0; cy < grid.height; cy += TERRAIN_CHUNK_SIZE) {
      for (let cx = 0; cx < grid.width; cx += TERRAIN_CHUNK_SIZE) {
        this.buildChunk(grid, cx, cy);
      }
    }
  }

  /** Re-bake only the chunk containing the given tile (terrain changed). */
  rebuildChunkAt(grid: IsoGrid, gx: number, gy: number): void {
    if (!this.terrainLayer) return;
    const cx = Math.floor(gx / TERRAIN_CHUNK_SIZE) * TERRAIN_CHUNK_SIZE;
    const cy = Math.floor(gy / TERRAIN_CHUNK_SIZE) * TERRAIN_CHUNK_SIZE;
    const key = (cy / TERRAIN_CHUNK_SIZE) * this.chunkCols + cx / TERRAIN_CHUNK_SIZE;
    const old = this.terrainChunks.get(key);
    if (old) {
      this.terrainLayer.removeChild(old.view);
      old.view.destroy(true);
    }
    this.buildChunk(grid, cx, cy);
  }

  /** Bake one chunk: one textured quad instead of thousands of polygons. */
  private buildChunk(grid: IsoGrid, cx: number, cy: number): void {
    const g = new Graphics();
    const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const maxY = Math.min(cy + TERRAIN_CHUNK_SIZE, grid.height);
    const maxX = Math.min(cx + TERRAIN_CHUNK_SIZE, grid.width);
    // Draw back-to-front inside the chunk so rock lumps overlap correctly.
    for (let gy = cy; gy < maxY; gy++) {
      for (let gx = cx; gx < maxX; gx++) {
        const p = gridToScreen(gx, gy);
        const self = grid.terrainAt(gx, gy);
        drawTerrainTile(g, p.x, p.y, self, (gx + gy) % 2 === 0, gx, gy);
        // Blend edges against the four orthogonal neighbours (foam, seams).
        const nAt = (x: number, y: number): Terrain =>
          grid.inBounds(x, y) ? grid.terrainAt(x, y) : self;
        drawTerrainEdges(
          g, p.x, p.y, self,
          nAt(gx, gy - 1), nAt(gx + 1, gy), nAt(gx, gy + 1), nAt(gx - 1, gy),
        );
        bounds.minX = Math.min(bounds.minX, p.x - TILE_W / 2);
        bounds.maxX = Math.max(bounds.maxX, p.x + TILE_W / 2);
        bounds.minY = Math.min(bounds.minY, p.y - TILE_H);
        bounds.maxY = Math.max(bounds.maxY, p.y + TILE_H / 2);
      }
    }
    // Subtle build grid: a few long lines per chunk instead of one
    // stroked outline per tile (massively fewer vertices).
    for (let gx = cx; gx <= maxX; gx++) {
      const a = gridToScreen(gx - 0.5, cy - 0.5);
      const b = gridToScreen(gx - 0.5, maxY - 0.5);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    for (let gy = cy; gy <= maxY; gy++) {
      const a = gridToScreen(cx - 0.5, gy - 0.5);
      const b = gridToScreen(maxX - 0.5, gy - 0.5);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ color: 0x3a5c30, width: 1, alpha: 0.22 });
    const localBounds = g.getLocalBounds();
    const texture = this.app.renderer.generateTexture({ target: g });
    g.destroy();
    const sprite = new Sprite(texture);
    sprite.position.set(localBounds.minX, localBounds.minY);
    this.terrainLayer.addChild(sprite);
    const key = (cy / TERRAIN_CHUNK_SIZE) * this.chunkCols + cx / TERRAIN_CHUNK_SIZE;
    this.terrainChunks.set(key, { view: sprite, bounds });
  }

  /** Remove all building/unit views (new game / load). */
  clearEntities(): void {
    for (const entry of this.buildingViews.values()) entry.view.destroy({ children: true });
    for (const entry of this.workerViews.values()) entry.view.destroy({ children: true });
    for (const entry of this.soldierViews.values()) entry.view.destroy({ children: true });
    for (const entry of this.enemyViews.values()) entry.view.destroy({ children: true });
    for (const entry of this.decorativeNPCs.values()) entry.view.destroy({ children: true });
    for (const entry of this.fisheryBoats.values()) entry.view.destroy({ children: true });
    this.buildingViews.clear();
    this.workerViews.clear();
    this.soldierViews.clear();
    this.enemyViews.clear();
    this.decorativeNPCs.clear();
    this.fisheryBoats.clear();
    this.projectileView?.clear();
    this.ghostKey = '';
    this.selectionKey = '';
  }

  /** Create a unit view: animated sprite if art exists, plus overlay gfx. */
  private createUnitEntry(spriteId: string): UnitViewEntry {
    const set = this.unitSprites.get(spriteId);
    const view = new Container();
    let sprite: Sprite | null = null;
    if (set) {
      sprite = new Sprite(set.textures[0]);
      sprite.anchor.set(set.anchorU, set.anchorV);
      sprite.scale.set(set.scale);
      view.addChild(sprite);
    }
    const gfx = new Graphics();
    view.addChild(gfx);
    this.objectLayer.addChild(view);
    return { view, sprite, gfx, set, lastFrame: -1, facing: 1, lastKey: '' };
  }

  /** Position + animate a unit view; returns interpolated grid coords. */
  private placeUnit(
    entry: UnitViewEntry,
    prevX: number,
    prevY: number,
    x: number,
    y: number,
    alpha: number,
    offsetX = 0,
  ): { fx: number; fy: number } {
    const fx = prevX + (x - prevX) * alpha;
    const fy = prevY + (y - prevY) * alpha;
    const moving = prevX !== x || prevY !== y;
    const p = gridToScreen(fx, fy);
    entry.view.position.set(p.x + offsetX, p.y + walkBob(fx, fy, moving));
    entry.view.zIndex = fx + fy + 0.5;
    if (entry.sprite && entry.set) {
      const frame = unitFrame(entry.set, fx, fy, moving);
      if (frame !== entry.lastFrame) {
        entry.sprite.texture = entry.set.textures[frame];
        entry.lastFrame = frame;
      }
      // Face the walking direction (screen x): art faces right by default.
      if (moving) {
        const dxScreen = (x - prevX) - (y - prevY);
        if (dxScreen < -0.001) entry.facing = -1;
        else if (dxScreen > 0.001) entry.facing = 1;
      }
      entry.sprite.scale.set(entry.set.scale * entry.facing, entry.set.scale);
    }
    return { fx, fy };
  }

  /** Render one frame. `alpha` interpolates worker movement between ticks. */
  renderFrame(camera: Camera, state: RenderState, alpha: number): void {
    if (!this.app) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    camera.apply(this.world);
    this.syncBuildings(state);
    this.syncWorkers(state, alpha);
    this.syncDecorativeNPCs(state, dt);
    this.syncFisheryBoats(state, dt);
    this.syncSoldiers(state, alpha);
    this.syncEnemies(state, alpha);
    this.syncProjectiles(state);
    this.syncGhost(state);
    this.syncSelection(state);
    this.syncDuelNodes(state);
    this.syncFog(state, camera);
    this.cull(camera, state);
    this.app.render();
  }

  private duelNodesView: Graphics | null = null;
  private duelNodesKey = '';

  /** Flag markers for the duel's capturable depots, tinted by controller. */
  private syncDuelNodes(state: RenderState): void {
    const key = state.duelNodes
      ? state.duelNodes.map((n) => `${n.x},${n.y},${n.owner}`).join(';')
      : '';
    if (key === this.duelNodesKey) return;
    this.duelNodesKey = key;
    if (!this.duelNodesView) {
      this.duelNodesView = new Graphics();
      this.markerLayer.addChild(this.duelNodesView);
    }
    const g = this.duelNodesView;
    g.clear();
    if (!state.duelNodes) return;
    for (const node of state.duelNodes) {
      const p = gridToScreen(node.x, node.y);
      const color =
        node.owner === 'player' ? 0x4f9dd8 : node.owner === 'foe' ? 0xd4574e : 0xcfc6a8;
      // Capture area, pole and pennant.
      g.ellipse(p.x, p.y, TILE_W * 1.1, TILE_H * 1.1)
        .stroke({ color, width: 2, alpha: 0.55 })
        .fill({ color, alpha: 0.08 });
      g.rect(p.x - 1.5, p.y - 34, 3, 34).fill({ color: 0x5a4632 });
      g.poly([p.x + 1.5, p.y - 34, p.x + 18, p.y - 28, p.x + 1.5, p.y - 22]).fill({ color });
    }
  }

  private syncEnemies(state: RenderState, alpha: number): void {
    const liveIds = new Set<number>();
    for (const e of state.enemies) {
      liveIds.add(e.id);
      let entry = this.enemyViews.get(e.id);
      if (!entry) {
        entry = this.createUnitEntry(e.defId);
        this.enemyViews.set(e.id, entry);
      }
      const key = `${e.hp}`;
      if (entry.lastKey !== key) {
        entry.lastKey = key;
        if (entry.sprite) {
          entry.gfx.clear();
          drawHpBar(entry.gfx, 0, -e.def.art.radius * 2 - 13, 18, e.hp / e.def.hp);
        } else {
          drawEnemy(entry.gfx, e.def.art, e.hp / e.def.hp);
        }
      }
      this.placeUnit(entry, e.prevX, e.prevY, e.x, e.y, alpha);
    }
    for (const [id, entry] of this.enemyViews) {
      if (!liveIds.has(id)) {
        entry.view.destroy({ children: true });
        this.enemyViews.delete(id);
      }
    }
  }

  /** Tower arrows: tiny dots flying from tower to target (visual only). */
  private syncProjectiles(state: RenderState): void {
    const g = this.projectileView;
    g.clear();
    for (const p of state.projectiles) {
      const t = Math.min(1, p.age / 6);
      const from = gridToScreen(p.x0, p.y0);
      const to = gridToScreen(p.x1, p.y1);
      const x = from.x + (to.x - from.x) * t;
      // Arc: launch height at the tower top, dipping to the target.
      const y = from.y - 40 * (1 - t) + (to.y - from.y) * t - Math.sin(t * Math.PI) * 14;
      g.circle(x, y, 2.5).fill(p.color ?? PALETTE.projectile);
    }
  }

  private syncSoldiers(state: RenderState, alpha: number): void {
    const liveIds = new Set<number>();
    for (const s of state.soldiers) {
      liveIds.add(s.id);
      let entry = this.soldierViews.get(s.id);
      if (!entry) {
        entry = this.createUnitEntry(s.typeId);
        this.soldierViews.set(s.id, entry);
      }
      const selected = state.selectedSoldierId === s.id;
      const key = `${selected}:${s.hp}:${s.rank}`;
      if (entry.lastKey !== key) {
        entry.lastKey = key;
        entry.gfx.clear();
        if (entry.sprite) {
          if (selected) {
            entry.gfx.ellipse(0, 2, 12, 6).stroke({ color: PALETTE.selection, width: 2, alpha: 0.95 });
          }
          drawHpBar(entry.gfx, 0, -26, 18, s.hp / s.maxHp);
        } else {
          drawSoldier(entry.gfx, selected, s.hp / s.maxHp);
        }
        // Veteran rank pips above the head.
        for (let r = 0; r < s.rank; r++) {
          entry.gfx.rect(-5 + r * 4, -31, 3, 3).fill({ color: 0xf0c843, alpha: 0.95 });
        }
      }
      this.placeUnit(entry, s.prevX, s.prevY, s.x, s.y, alpha);
    }
    for (const [id, entry] of this.soldierViews) {
      if (!liveIds.has(id)) {
        entry.view.destroy({ children: true });
        this.soldierViews.delete(id);
      }
    }
  }

  /** Construction sites tick every frame; finished buildings only on hp change. */
  private buildingOverlayKey(b: Building): string {
    return b.underConstruction ? `c:${b.materialsMissing()}:${b.buildTicks}` : `h:${b.hp}`;
  }

  /**
   * Topmost building whose drawn sprite covers the world point — selection
   * tests the full sprite rectangle (including the part overhanging the base
   * tile), not just the footprint, so tall buildings are easy to tap even
   * where they overlap a neighbour. Returns the frontmost (highest zIndex).
   */
  pickBuildingAt(worldX: number, worldY: number): number | null {
    let bestId: number | null = null;
    let bestZ = -Infinity;
    for (const [id, entry] of this.buildingViews) {
      const b = entry.bounds;
      if (worldX < b.minX || worldX > b.maxX || worldY < b.minY || worldY > b.maxY) continue;
      const z = entry.view.zIndex;
      if (z > bestZ) {
        bestZ = z;
        bestId = id;
      }
    }
    return bestId;
  }

  /**
   * Overlay above the roof (world px, relative to the anchor):
   * health bar for finished buildings, yellow progress bar for sites.
   */
  private updateOverlay(entry: BuildingViewEntry, b: Building): void {
    entry.sprite.alpha = b.underConstruction ? 0.55 : 1;
    entry.hpBar.clear();
    const [n, , s] = footprintCorners(b.w, b.h);
    const cx = (n[0] + s[0]) / 2;
    const cy = n[1] - b.def.art.height - 10;
    const width = Math.max(28, b.w * 18);
    if (b.underConstruction) {
      // Fills only once all materials arrived (delivery phase shows empty).
      const ratio =
        b.materialsMissing() > 0 ? 0 : 1 - b.buildTicks / Math.max(1, b.totalBuildTicks);
      entry.hpBar.rect(cx - width / 2, cy, width, 4).fill({ color: 0x33301f, alpha: 0.9 });
      entry.hpBar
        .rect(cx - width / 2, cy, width * Math.max(0, Math.min(1, ratio)), 4)
        .fill({ color: 0xe8b93c, alpha: 0.95 });
    } else {
      drawHpBar(entry.hpBar, cx, cy, width, b.hp / b.maxHp);
    }
  }

  /**
   * A floating chip with gold star pips above the roof — one pip per level,
   * shown from level 2. Works for every building regardless of whether it
   * uses an external sprite or a baked placeholder, so upgrades always read
   * clearly on the map. Hidden while a building is still under construction.
   */
  private syncLevelBadge(entry: BuildingViewEntry, b: Building): void {
    const key = `${b.level}:${b.underConstruction ? 1 : 0}`;
    if (entry.lastBadgeKey === key) return;
    entry.lastBadgeKey = key;
    if (!entry.levelBadge) {
      entry.levelBadge = new Graphics();
      entry.view.addChild(entry.levelBadge);
    }
    const g = entry.levelBadge;
    g.clear();
    if (b.level < 2 || b.underConstruction) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const [n, , s] = footprintCorners(b.w, b.h);
    const cx = (n[0] + s[0]) / 2;
    const top = n[1] - b.def.art.height - 20;
    const pips = b.level;
    const gap = 11;
    const w = pips * gap + 6;
    g.roundRect(cx - w / 2, top - 8, w, 16, 8)
      .fill({ color: 0x1c1710, alpha: 0.8 })
      .stroke({ color: 0xe3b341, width: 1 });
    for (let i = 0; i < pips; i++) {
      const px = cx - w / 2 + 9 + i * gap;
      g.star(px, top, 5, 4.4, 1.9).fill({ color: 0xf4d06a }).stroke({ color: 0x7a5a16, width: 0.6 });
    }
  }

  private syncBuildings(state: RenderState): void {
    for (const [id, entry] of this.buildingViews) {
      if (!state.buildings.has(id)) {
        entry.view.destroy({ children: true });
        this.buildingViews.delete(id);
      }
    }
    for (const b of state.buildings.values()) {
      const existing = this.buildingViews.get(b.id);
      if (existing) {
        if (existing.lastLevel !== b.level) {
          const tex = this.buildingSprites.get(this.app.renderer, b.def, b.w, b.h, b.level, b.rotated);
          existing.sprite.texture = tex.texture;
          existing.sprite.position.set(tex.offsetX, tex.offsetY);
          existing.sprite.scale.set(tex.scale);
          existing.lastLevel = b.level;
        }
        const overlayKey = this.buildingOverlayKey(b);
        if (existing.lastOverlayKey !== overlayKey) {
          this.updateOverlay(existing, b);
          existing.lastOverlayKey = overlayKey;
        }
        this.syncLevelBadge(existing, b);
        // Rotate sails if present
        if (existing.sailsGfx) {
          const active = !b.underConstruction && b.assignedWorkers > 0 && !b.productionHalted && !b.userPaused;
          if (active) {
            existing.sailsAngle = (existing.sailsAngle ?? 0) + 0.05;
            existing.sailsGfx.rotation = existing.sailsAngle;
          }
        }
        continue;
      }
      const tex = this.buildingSprites.get(this.app.renderer, b.def, b.w, b.h, b.level, b.rotated);
      const sprite = new Sprite(tex.texture);
      sprite.position.set(tex.offsetX, tex.offsetY);
      sprite.scale.set(tex.scale);
      // Duel: the opposing castle reads as hostile via a reddish tint.
      if (b.owner === 'foe') sprite.tint = 0xffb0a0;
      const hpBar = new Graphics();
      const view = new Container();
      view.addChild(sprite, hpBar);

      // Create rotating sails for the Mill
      let sailsGfx: Graphics | undefined;
      let sailsAngle = 0;
      if (b.defId === 'mill') {
        sailsGfx = new Graphics();
        // Draw the sails centered at (0, 0)
        sailsGfx.moveTo(0, 0).lineTo(0, -6).stroke({ color: 0x4a3b28, width: 2.5 });
        for (const a of [0.5, 2.07, 3.64, 5.21]) {
          sailsGfx.moveTo(0, 0)
            .lineTo(Math.cos(a) * 26, Math.sin(a) * 26)
            .stroke({ color: 0xf4eee0, width: 4 });
          // Draw a sail cloth
          const start = 6;
          const sx = Math.cos(a) * start;
          const sy = Math.sin(a) * start;
          const ex = Math.cos(a) * 26;
          const ey = Math.sin(a) * 26;
          // Draw perpendicular cloth
          const perpAngle = a + Math.PI / 2;
          const cx1 = sx + Math.cos(perpAngle) * 4;
          const cy1 = sy + Math.sin(perpAngle) * 4;
          const cx2 = ex + Math.cos(perpAngle) * 4;
          const cy2 = ey + Math.sin(perpAngle) * 4;
          sailsGfx.poly([sx, sy, cx1, cy1, cx2, cy2, ex, ey]).fill(0xfbf8eb).stroke({ color: 0x4a3b28, width: 0.8 });
        }
        // Offset for hub
        const isExternal = (b.w === b.def.footprint.w && b.h === b.def.footprint.h) && this.buildingSprites.hasExternal(b.defId, b.level);
        const hubX = isExternal ? 6 : 0;
        const hubY = isExternal ? -56 : -52;
        sailsGfx.position.set(hubX, hubY);
        view.addChild(sailsGfx);
      }

      const anchor = gridToScreen(b.x, b.y);
      view.position.set(anchor.x, anchor.y);
      view.zIndex = b.zIndex;
      this.objectLayer.addChild(view);
      const corners = [
        gridToScreen(b.x, b.y),
        gridToScreen(b.x + b.w - 1, b.y),
        gridToScreen(b.x + b.w - 1, b.y + b.h - 1),
        gridToScreen(b.x, b.y + b.h - 1),
      ];
      const entry: BuildingViewEntry = {
        view,
        sprite,
        hpBar,
        bounds: {
          minX: Math.min(...corners.map((c) => c.x)) - TILE_W / 2,
          maxX: Math.max(...corners.map((c) => c.x)) + TILE_W / 2,
          minY: Math.min(...corners.map((c) => c.y)) - TILE_H / 2 - b.def.art.height,
          maxY: Math.max(...corners.map((c) => c.y)) + TILE_H / 2,
        },
        lastOverlayKey: this.buildingOverlayKey(b),
        lastLevel: b.level,
        sailsGfx,
        sailsAngle,
      };
      this.updateOverlay(entry, b);
      this.syncLevelBadge(entry, b);
      this.buildingViews.set(b.id, entry);
    }
  }

  private syncWorkers(state: RenderState, alpha: number): void {
    const liveIds = new Set<number>();
    for (const w of state.workers) {
      liveIds.add(w.id);
      let entry = this.workerViews.get(w.id);
      if (!entry) {
        entry = this.createUnitEntry(w.isCart ? 'cart' : 'worker');
        this.workerViews.set(w.id, entry);
      }
      const key = w.carrying ?? '';
      if (entry.lastKey !== key) {
        entry.lastKey = key;
        entry.gfx.clear();
        if (entry.sprite) {
          if (w.carrying) {
            // Cargo crate on the shoulder, tinted by resource.
            entry.gfx
              .rect(2, -21, 7, 6)
              .fill(RESOURCE_INFO[w.carrying].color)
              .stroke({ color: 0x000000, width: 1, alpha: 0.4 });
          }
        } else {
          drawWorker(entry.gfx, w.carrying ? RESOURCE_INFO[w.carrying].color : null);
        }
      }
      // Small per-id offset so idle carriers on the same tile don't stack.
      this.placeUnit(entry, w.prevX, w.prevY, w.x, w.y, alpha, ((w.id * 37) % 13) - 6);
    }
    for (const [id, entry] of this.workerViews) {
      if (!liveIds.has(id)) {
        entry.view.destroy({ children: true });
        this.workerViews.delete(id);
      }
    }
  }

  private syncDecorativeNPCs(state: RenderState, dt: number): void {
    for (const b of state.buildings.values()) {
      if (b.defId !== 'lumberjack' && b.defId !== 'mine' && b.defId !== 'quarry' && b.defId !== 'farm') continue;

      const active = !b.underConstruction && b.assignedWorkers > 0 && !b.productionHalted && !b.userPaused;
      // One animated figure per assigned worker (the farm can staff two).
      const maxFigures = b.workersRequired || 1;
      const desired = active ? Math.min(b.assignedWorkers, maxFigures) : 0;
      for (let index = 0; index < maxFigures; index++) {
        this.updateDecorativeNPC(state, b, index, index < desired, dt);
      }
    }

    // Clean up NPCs whose building was removed entirely.
    for (const [key, npc] of this.decorativeNPCs) {
      if (!state.buildings.has(npc.buildingId)) {
        npc.view.destroy({ children: true });
        this.decorativeNPCs.delete(key);
      }
    }
  }

  /** Animate one decorative field/resource worker, keyed by building + index. */
  private updateDecorativeNPC(
    state: RenderState,
    b: Building,
    index: number,
    want: boolean,
    dt: number,
  ): void {
    const key = `${b.id}:${index}`;

    // Determine target tile based on building type.
    let target: Point | null = null;
    if (want) {
      if (b.defId === 'lumberjack') {
        target = b.terrainTileInRange(state.grid, Terrain.Forest, 4);
      } else if (b.defId === 'mine') {
        target = b.adjacentTerrainTile(state.grid, Terrain.Ore);
      } else if (b.defId === 'quarry') {
        target = b.adjacentTerrainTile(state.grid, Terrain.Rock);
      } else if (b.defId === 'farm') {
        const access = b.accessTiles(state.grid);
        // door is access[0]. Spread farmers across the remaining field spots.
        target = access.length > 1
          ? access[1 + ((b.id * 17 + index * 7) % (access.length - 1))]
          : (access[0] ?? { x: b.x, y: b.y });
      }
    }

    let npc = this.decorativeNPCs.get(key);

      if (!want || !target) {
        if (npc) {
          // Return worker to building door and despawn
          if (npc.phase !== 'returning') {
            const currentTile = { x: Math.round(npc.x), y: Math.round(npc.y) };
            const path = findPath(state.grid, currentTile, b.accessTiles(state.grid));
            if (path) {
              npc.path = path;
              npc.pathIndex = 0;
              npc.phase = 'returning';
              npc.targetTile = null;
            } else {
              npc.view.destroy({ children: true });
              this.decorativeNPCs.delete(key);
              return;
            }
          }

          // Move back to door
          let budget = 2.2 * dt;
          while (budget > 0 && npc.pathIndex < npc.path.length) {
            const tgt = npc.path[npc.pathIndex];
            const dx = tgt.x - npc.x;
            const dy = tgt.y - npc.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= budget) {
              npc.x = tgt.x;
              npc.y = tgt.y;
              budget -= dist;
              npc.pathIndex++;
            } else {
              npc.x += (dx / dist) * budget;
              npc.y += (dy / dist) * budget;
              budget = 0;
            }
          }

          if (npc.pathIndex >= npc.path.length) {
            // Arrived at door, despawn
            npc.view.destroy({ children: true });
            this.decorativeNPCs.delete(key);
            return;
          }

          // Visual updates
          const p = gridToScreen(npc.x, npc.y);
          const bob = walkBob(npc.x, npc.y, true);
          npc.view.position.set(p.x, p.y + bob);
          npc.view.zIndex = npc.x + npc.y + 0.5;

          if (npc.pathIndex < npc.path.length) {
            const tgt = npc.path[npc.pathIndex];
            const dxScreen = (tgt.x - npc.x) - (tgt.y - npc.y);
            if (dxScreen < -0.001) npc.facing = -1;
            else if (dxScreen > 0.001) npc.facing = 1;
          }

          if (npc.sprite && npc.set) {
            const frame = unitFrame(npc.set, npc.x, npc.y, true);
            if (frame !== npc.lastFrame) {
              npc.sprite.texture = npc.set.textures[frame];
              npc.lastFrame = frame;
            }
            npc.sprite.scale.set(npc.set.scale * npc.facing, npc.set.scale);
          }
          npc.view.rotation = 0;
          drawDecorativeNPC(npc.gfx, npc.type, npc.phase, npc.sprite !== null);
        }
        return;
      }

      // Building is active and has a target
      if (!npc) {
        const accessTiles = b.accessTiles(state.grid);
        const spawn = accessTiles[0] ?? { x: b.x, y: b.y };
        const entry = this.createUnitEntry('worker');
        npc = {
          buildingId: b.id,
          type: b.defId === 'lumberjack' ? 'lumberjack' : b.defId === 'mine' ? 'miner' : b.defId === 'quarry' ? 'quarryman' : 'farmer',
          x: spawn.x,
          y: spawn.y,
          phase: 'idle',
          path: [],
          pathIndex: 0,
          targetTile: null,
          timer: 0.5,
          view: entry.view,
          sprite: entry.sprite,
          gfx: entry.gfx,
          set: entry.set,
          facing: 1,
          lastFrame: -1,
        };
        this.decorativeNPCs.set(key, npc);
      }

      // Target validation check
      let targetInvalid = npc.targetTile === null;
      if (npc.targetTile) {
        if (npc.type === 'lumberjack') {
          targetInvalid = targetInvalid || state.grid.terrainAt(npc.targetTile.x, npc.targetTile.y) !== Terrain.Forest || (npc.targetTile.x !== target.x || npc.targetTile.y !== target.y);
        } else if (npc.type === 'miner') {
          targetInvalid = targetInvalid || state.grid.terrainAt(npc.targetTile.x, npc.targetTile.y) !== Terrain.Ore || (npc.targetTile.x !== target.x || npc.targetTile.y !== target.y);
        } else if (npc.type === 'quarryman') {
          targetInvalid = targetInvalid || state.grid.terrainAt(npc.targetTile.x, npc.targetTile.y) !== Terrain.Rock || (npc.targetTile.x !== target.x || npc.targetTile.y !== target.y);
        } else if (npc.type === 'farmer') {
          targetInvalid = targetInvalid || (npc.targetTile.x !== target.x || npc.targetTile.y !== target.y);
        }
      }

      if (targetInvalid) {
        npc.targetTile = target;
        const currentTile = { x: Math.round(npc.x), y: Math.round(npc.y) };

        if (npc.type === 'farmer') {
          // Farmer walks directly to the target field/access tile
          const path = findPath(state.grid, currentTile, [target]);
          if (path) {
            npc.path = path;
            npc.pathIndex = 0;
            npc.phase = 'toTarget';
          } else {
            npc.phase = 'idle';
            npc.timer = 1.0;
          }
        } else {
          // Miner, quarryman, lumberjack walk to a walkable neighbor of the target resource tile
          const neighbors: Point[] = [];
          const dirs = [[1,0], [-1,0], [0,1], [0,-1], [1,1], [-1,-1], [1,-1], [-1,1]] as const;
          for (const [dx, dy] of dirs) {
            const nx = target.x + dx;
            const ny = target.y + dy;
            if (state.grid.inBounds(nx, ny) && isFinite(state.grid.moveCost(nx, ny))) {
              neighbors.push({ x: nx, y: ny });
            }
          }

          const path = findPath(state.grid, currentTile, neighbors);
          if (path) {
            npc.path = path;
            npc.pathIndex = 0;
            npc.phase = 'toTarget';
          } else {
            npc.phase = 'idle';
            npc.timer = 1.0;
          }
        }
      }

      // Phase updates
      if (npc.phase === 'toTarget') {
        let budget = 2.2 * dt;
        while (budget > 0 && npc.pathIndex < npc.path.length) {
          const tgt = npc.path[npc.pathIndex];
          const dx = tgt.x - npc.x;
          const dy = tgt.y - npc.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= budget) {
            npc.x = tgt.x;
            npc.y = tgt.y;
            budget -= dist;
            npc.pathIndex++;
          } else {
            npc.x += (dx / dist) * budget;
            npc.y += (dy / dist) * budget;
            budget = 0;
          }
        }
        if (npc.pathIndex >= npc.path.length) {
          npc.phase = 'working';
          npc.timer = 3.0;
          npc.path = [];
          npc.pathIndex = 0;
        }
      } else if (npc.phase === 'working') {
        npc.timer -= dt;
        if (npc.timer <= 0) {
          const currentTile = { x: Math.round(npc.x), y: Math.round(npc.y) };
          const path = findPath(state.grid, currentTile, b.accessTiles(state.grid));
          if (path) {
            npc.path = path;
            npc.pathIndex = 0;
            npc.phase = 'returning';
          } else {
            npc.phase = 'idle';
            npc.timer = 1.0;
          }
        }
      } else if (npc.phase === 'returning') {
        let budget = 2.2 * dt;
        while (budget > 0 && npc.pathIndex < npc.path.length) {
          const tgt = npc.path[npc.pathIndex];
          const dx = tgt.x - npc.x;
          const dy = tgt.y - npc.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= budget) {
            npc.x = tgt.x;
            npc.y = tgt.y;
            budget -= dist;
            npc.pathIndex++;
          } else {
            npc.x += (dx / dist) * budget;
            npc.y += (dy / dist) * budget;
            budget = 0;
          }
        }
        if (npc.pathIndex >= npc.path.length) {
          npc.phase = 'idle';
          npc.timer = 1.0;
          npc.path = [];
          npc.pathIndex = 0;
        }
      } else if (npc.phase === 'idle') {
        npc.timer -= dt;
        if (npc.timer <= 0) {
          const currentTile = { x: Math.round(npc.x), y: Math.round(npc.y) };
          if (npc.type === 'farmer') {
            const path = findPath(state.grid, currentTile, [target]);
            if (path) {
              npc.path = path;
              npc.pathIndex = 0;
              npc.phase = 'toTarget';
            } else {
              npc.timer = 1.0;
            }
          } else {
            const neighbors: Point[] = [];
            const dirs = [[1,0], [-1,0], [0,1], [0,-1], [1,1], [-1,-1], [1,-1], [-1,1]] as const;
            for (const [dx, dy] of dirs) {
              const nx = target.x + dx;
              const ny = target.y + dy;
              if (state.grid.inBounds(nx, ny) && isFinite(state.grid.moveCost(nx, ny))) {
                neighbors.push({ x: nx, y: ny });
              }
            }
            const path = findPath(state.grid, currentTile, neighbors);
            if (path) {
              npc.path = path;
              npc.pathIndex = 0;
              npc.phase = 'toTarget';
            } else {
              npc.timer = 1.0;
            }
          }
        }
      }

      // Visual updates
      const p = gridToScreen(npc.x, npc.y);
      const moving = npc.phase === 'toTarget' || npc.phase === 'returning';
      const bob = walkBob(npc.x, npc.y, moving);
      npc.view.position.set(p.x, p.y + bob);
      npc.view.zIndex = npc.x + npc.y + 0.5;

      if (moving && npc.pathIndex < npc.path.length) {
        const tgt = npc.path[npc.pathIndex];
        const dxScreen = (tgt.x - npc.x) - (tgt.y - npc.y);
        if (dxScreen < -0.001) npc.facing = -1;
        else if (dxScreen > 0.001) npc.facing = 1;
      } else if (npc.phase === 'working') {
        if (npc.type === 'farmer') {
          // Face the center of the 3x3 farm
          const center = b.center;
          const dxScreen = (center.x - npc.x) - (center.y - npc.y);
          if (dxScreen < -0.001) npc.facing = -1;
          else if (dxScreen > 0.001) npc.facing = 1;
        } else if (npc.targetTile) {
          const dxScreen = (npc.targetTile.x - npc.x) - (npc.targetTile.y - npc.y);
          if (dxScreen < -0.001) npc.facing = -1;
          else if (dxScreen > 0.001) npc.facing = 1;
        }
      }

      if (npc.sprite && npc.set) {
        const frame = unitFrame(npc.set, npc.x, npc.y, moving);
        if (frame !== npc.lastFrame) {
          npc.sprite.texture = npc.set.textures[frame];
          npc.lastFrame = frame;
        }
        npc.sprite.scale.set(npc.set.scale * npc.facing, npc.set.scale);
      }

      if (npc.phase === 'working') {
        npc.view.rotation = Math.sin(performance.now() * 0.015) * 0.25;
      } else {
        npc.view.rotation = 0;
      }

      drawDecorativeNPC(npc.gfx, npc.type, npc.phase, npc.sprite !== null);
  }

  private syncFisheryBoats(state: RenderState, dt: number): void {
    const liveBuildingIds = new Set<number>();

    for (const b of state.buildings.values()) {
      if (b.defId !== 'fishery') continue;
      liveBuildingIds.add(b.id);

      const active = !b.underConstruction && b.assignedWorkers > 0 && !b.productionHalted && !b.userPaused;
      let boat = this.fisheryBoats.get(b.id);

      if (!active) {
        if (boat) {
          boat.view.destroy({ children: true });
          this.fisheryBoats.delete(b.id);
        }
        continue;
      }

      if (!boat) {
        const waterTile = b.adjacentTerrainTile(state.grid, Terrain.Water);
        if (waterTile) {
          const view = new Container();
          const gfx = new Graphics();
          view.addChild(gfx);
          this.objectLayer.addChild(view);
          boat = {
            buildingId: b.id,
            x: waterTile.x,
            y: waterTile.y,
            view,
            gfx,
            bobTimer: Math.random() * 10,
          };
          this.fisheryBoats.set(b.id, boat);
        }
      }

      if (boat) {
        boat.bobTimer += dt;
        const bob = Math.sin(boat.bobTimer * 2) * 2;
        const p = gridToScreen(boat.x, boat.y);
        boat.view.position.set(p.x, p.y + bob);
        boat.view.zIndex = boat.x + boat.y + 0.1;
        drawFisheryBoat(boat.gfx, boat.bobTimer);
      }
    }

    // Clean up completely removed buildings
    for (const [id, boat] of this.fisheryBoats) {
      if (!liveBuildingIds.has(id)) {
        boat.view.destroy({ children: true });
        this.fisheryBoats.delete(id);
      }
    }
  }

  private syncGhost(state: RenderState): void {
    const ghost = state.ghost;
    if (!ghost) {
      this.ghostView.visible = false;
      this.ghostKey = '';
      return;
    }
    const def = getDef(ghost.defId);
    const { w, h } = rotatedFootprint(def, ghost.rotated);
    const key = `${ghost.defId}:${ghost.gx}:${ghost.gy}:${ghost.rotated}:${ghost.valid}`;
    if (key !== this.ghostKey) {
      this.ghostKey = key;
      drawGhost(this.ghostView, def, w, h, ghost.valid);
      const anchor = gridToScreen(ghost.gx, ghost.gy);
      this.ghostView.position.set(anchor.x, anchor.y);
    }
    this.ghostView.visible = true;
  }

  private syncSelection(state: RenderState): void {
    const building = state.selectedId !== null ? state.buildings.get(state.selectedId) : undefined;
    if (!building) {
      this.selectionView.visible = false;
      this.selectionKey = '';
      return;
    }
    const key = `${building.id}`;
    if (key !== this.selectionKey) {
      this.selectionKey = key;
      drawSelection(this.selectionView, building.w, building.h);
      const anchor = gridToScreen(building.x, building.y);
      this.selectionView.position.set(anchor.x, anchor.y);
    }
    this.selectionView.visible = true;
  }

  private syncFog(state: RenderState, camera: Camera): void {
    this.fogView.clear();
    const view = camera.visibleRect();
    const margin = TILE_W;
    const minX = view.x - margin;
    const maxX = view.x + view.w + margin;
    const minY = view.y - margin;
    const maxY = view.y + view.h + margin;

    const grid = state.grid;
    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;

    for (let gy = 0; gy < grid.height; gy++) {
      for (let gx = 0; gx < grid.width; gx++) {
        if (!grid.isExplored(gx, gy)) {
          const p = gridToScreen(gx, gy);
          if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
            this.fogView.poly([
              p.x, p.y - halfH - 0.5,
              p.x + halfW + 0.5, p.y,
              p.x, p.y + halfH + 0.5,
              p.x - halfW - 0.5, p.y
            ]).fill({ color: 0x0c0f16, alpha: 0.9 });
          }
        }
      }
    }
  }

  /** Manual culling: hide everything outside the camera's view rectangle or in unexplored FOW. */
  private cull(camera: Camera, state: RenderState): void {
    const view = camera.visibleRect();
    const minX = view.x - CULL_MARGIN;
    const maxX = view.x + view.w + CULL_MARGIN;
    const minY = view.y - CULL_MARGIN;
    const maxY = view.y + view.h + CULL_MARGIN;
    const visible = (b: Bounds): boolean =>
      b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;

    for (const chunk of this.terrainChunks.values()) chunk.view.visible = visible(chunk.bounds);
    for (const [id, entry] of this.buildingViews) {
      const b = state.buildings.get(id);
      const explored = b ? state.grid.isExplored(b.x, b.y) : false;
      entry.view.visible = explored && visible(entry.bounds);
    }
    for (const [id, entry] of this.workerViews) {
      const w = state.workers.find((x) => x.id === id);
      const explored = w ? state.grid.isExplored(Math.round(w.x), Math.round(w.y)) : false;
      const { x, y } = entry.view.position;
      entry.view.visible = explored && x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    for (const entry of this.decorativeNPCs.values()) {
      const explored = state.grid.isExplored(Math.round(entry.x), Math.round(entry.y));
      const { x, y } = entry.view.position;
      entry.view.visible = explored && x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    for (const entry of this.fisheryBoats.values()) {
      const explored = state.grid.isExplored(Math.round(entry.x), Math.round(entry.y));
      const { x, y } = entry.view.position;
      entry.view.visible = explored && x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    for (const [id, entry] of this.soldierViews) {
      const s = state.soldiers.find((x) => x.id === id);
      const explored = s ? state.grid.isExplored(Math.round(s.x), Math.round(s.y)) : false;
      const { x, y } = entry.view.position;
      entry.view.visible = explored && x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    for (const [id, entry] of this.enemyViews) {
      const e = state.enemies.find((x) => x.id === id);
      const explored = e ? state.grid.isExplored(Math.round(e.x), Math.round(e.y)) : false;
      const { x, y } = entry.view.position;
      entry.view.visible = explored && x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
  }
}
