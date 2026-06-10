import { Application, Container, Graphics } from 'pixi.js';
import {
  RESOURCE_INFO,
  SOLDIER_HP,
  TERRAIN_CHUNK_SIZE,
  TILE_H,
  TILE_W,
} from '../data/config';
import { getDef } from '../data/buildings';
import type { Building } from '../entities/Building';
import type { Enemy } from '../entities/Enemy';
import type { Soldier } from '../entities/Soldier';
import type { Worker } from '../entities/Worker';
import type { Projectile } from '../systems/CombatSystem';
import type { Camera } from '../world/Camera';
import { gridToScreen, type IsoGrid } from '../world/IsoGrid';
import type { GhostState } from '../systems/BuildSystem';
import {
  PALETTE,
  drawBuildingView,
  drawEnemy,
  drawGhost,
  drawSelection,
  drawSoldier,
  drawTerrainTile,
  drawWorker,
} from './placeholders';
import { rotatedFootprint } from '../systems/BuildSystem';

/** World-space bounding box used for culling. */
interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface BuildingViewEntry {
  view: Graphics;
  bounds: Bounds;
  lastHp: number;
  lastLevel: number;
}

interface WorkerViewEntry {
  view: Graphics;
  lastCarrying: string | null;
}

interface SoldierViewEntry {
  view: Graphics;
  lastSelected: boolean;
  lastHp: number;
}

interface EnemyViewEntry {
  view: Graphics;
  lastHp: number;
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

  private terrainChunks: { view: Graphics; bounds: Bounds }[] = [];
  private buildingViews = new Map<number, BuildingViewEntry>();
  private workerViews = new Map<number, WorkerViewEntry>();
  private soldierViews = new Map<number, SoldierViewEntry>();
  private enemyViews = new Map<number, EnemyViewEntry>();
  private projectileView!: Graphics;
  private ghostView!: Graphics;
  private ghostKey = '';
  private selectionView!: Graphics;
  private selectionKey = '';

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

    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w: number, h: number): void {
    this.app.renderer.resize(w, h);
  }

  /** (Re)build the static terrain chunk graphics. Call after terrain changes. */
  buildTerrain(grid: IsoGrid): void {
    for (const chunk of this.terrainChunks) chunk.view.destroy();
    this.terrainChunks = [];
    this.terrainLayer.removeChildren();

    for (let cy = 0; cy < grid.height; cy += TERRAIN_CHUNK_SIZE) {
      for (let cx = 0; cx < grid.width; cx += TERRAIN_CHUNK_SIZE) {
        const g = new Graphics();
        const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        const maxY = Math.min(cy + TERRAIN_CHUNK_SIZE, grid.height);
        const maxX = Math.min(cx + TERRAIN_CHUNK_SIZE, grid.width);
        // Draw back-to-front inside the chunk so rock lumps overlap correctly.
        for (let gy = cy; gy < maxY; gy++) {
          for (let gx = cx; gx < maxX; gx++) {
            const p = gridToScreen(gx, gy);
            drawTerrainTile(g, p.x, p.y, grid.terrainAt(gx, gy), (gx + gy) % 2 === 0, gx, gy);
            bounds.minX = Math.min(bounds.minX, p.x - TILE_W / 2);
            bounds.maxX = Math.max(bounds.maxX, p.x + TILE_W / 2);
            bounds.minY = Math.min(bounds.minY, p.y - TILE_H);
            bounds.maxY = Math.max(bounds.maxY, p.y + TILE_H / 2);
          }
        }
        this.terrainLayer.addChild(g);
        this.terrainChunks.push({ view: g, bounds });
      }
    }
  }

  /** Remove all building/unit views (new game / load). */
  clearEntities(): void {
    for (const entry of this.buildingViews.values()) entry.view.destroy();
    for (const entry of this.workerViews.values()) entry.view.destroy();
    for (const entry of this.soldierViews.values()) entry.view.destroy();
    for (const entry of this.enemyViews.values()) entry.view.destroy();
    this.buildingViews.clear();
    this.workerViews.clear();
    this.soldierViews.clear();
    this.enemyViews.clear();
    this.projectileView?.clear();
    this.ghostKey = '';
    this.selectionKey = '';
  }

  /** Render one frame. `alpha` interpolates worker movement between ticks. */
  renderFrame(camera: Camera, state: RenderState, alpha: number): void {
    camera.apply(this.world);
    this.syncBuildings(state);
    this.syncWorkers(state, alpha);
    this.syncSoldiers(state, alpha);
    this.syncEnemies(state, alpha);
    this.syncProjectiles(state);
    this.syncGhost(state);
    this.syncSelection(state);
    this.cull(camera);
    this.app.render();
  }

  private syncEnemies(state: RenderState, alpha: number): void {
    const liveIds = new Set<number>();
    for (const e of state.enemies) {
      liveIds.add(e.id);
      let entry = this.enemyViews.get(e.id);
      if (!entry) {
        const view = new Graphics();
        drawEnemy(view, e.def.art, e.hp / e.def.hp);
        this.objectLayer.addChild(view);
        entry = { view, lastHp: e.hp };
        this.enemyViews.set(e.id, entry);
      }
      if (entry.lastHp !== e.hp) {
        drawEnemy(entry.view, e.def.art, e.hp / e.def.hp);
        entry.lastHp = e.hp;
      }
      const fx = e.prevX + (e.x - e.prevX) * alpha;
      const fy = e.prevY + (e.y - e.prevY) * alpha;
      const p = gridToScreen(fx, fy);
      entry.view.position.set(p.x, p.y + walkBob(fx, fy, e.prevX !== e.x || e.prevY !== e.y));
      entry.view.zIndex = fx + fy + 0.5;
    }
    for (const [id, entry] of this.enemyViews) {
      if (!liveIds.has(id)) {
        entry.view.destroy();
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
      g.circle(x, y, 2.5).fill(PALETTE.projectile);
    }
  }

  private syncSoldiers(state: RenderState, alpha: number): void {
    const liveIds = new Set<number>();
    for (const s of state.soldiers) {
      liveIds.add(s.id);
      let entry = this.soldierViews.get(s.id);
      if (!entry) {
        const view = new Graphics();
        drawSoldier(view, false, s.hp / SOLDIER_HP);
        this.objectLayer.addChild(view);
        entry = { view, lastSelected: false, lastHp: s.hp };
        this.soldierViews.set(s.id, entry);
      }
      const selected = state.selectedSoldierId === s.id;
      if (entry.lastSelected !== selected || entry.lastHp !== s.hp) {
        drawSoldier(entry.view, selected, s.hp / SOLDIER_HP);
        entry.lastSelected = selected;
        entry.lastHp = s.hp;
      }
      const fx = s.prevX + (s.x - s.prevX) * alpha;
      const fy = s.prevY + (s.y - s.prevY) * alpha;
      const p = gridToScreen(fx, fy);
      entry.view.position.set(p.x, p.y + walkBob(fx, fy, s.prevX !== s.x || s.prevY !== s.y));
      entry.view.zIndex = fx + fy + 0.5;
    }
    for (const [id, entry] of this.soldierViews) {
      if (!liveIds.has(id)) {
        entry.view.destroy();
        this.soldierViews.delete(id);
      }
    }
  }

  private syncBuildings(state: RenderState): void {
    for (const [id, entry] of this.buildingViews) {
      if (!state.buildings.has(id)) {
        entry.view.destroy();
        this.buildingViews.delete(id);
      }
    }
    for (const b of state.buildings.values()) {
      const existing = this.buildingViews.get(b.id);
      if (existing) {
        if (existing.lastHp !== b.hp || existing.lastLevel !== b.level) {
          drawBuildingView(existing.view, b.def, b.w, b.h, b.hp / b.maxHp, b.level);
          existing.lastHp = b.hp;
          existing.lastLevel = b.level;
        }
        continue;
      }
      const view = new Graphics();
      drawBuildingView(view, b.def, b.w, b.h, b.hp / b.maxHp, b.level);
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
      this.buildingViews.set(b.id, {
        view,
        bounds: {
          minX: Math.min(...corners.map((c) => c.x)) - TILE_W / 2,
          maxX: Math.max(...corners.map((c) => c.x)) + TILE_W / 2,
          minY: Math.min(...corners.map((c) => c.y)) - TILE_H / 2 - b.def.art.height,
          maxY: Math.max(...corners.map((c) => c.y)) + TILE_H / 2,
        },
        lastHp: b.hp,
        lastLevel: b.level,
      });
    }
  }

  private syncWorkers(state: RenderState, alpha: number): void {
    const liveIds = new Set<number>();
    for (const w of state.workers) {
      liveIds.add(w.id);
      let entry = this.workerViews.get(w.id);
      if (!entry) {
        const view = new Graphics();
        drawWorker(view, null);
        this.objectLayer.addChild(view);
        entry = { view, lastCarrying: null };
        this.workerViews.set(w.id, entry);
      }
      if (entry.lastCarrying !== w.carrying) {
        drawWorker(entry.view, w.carrying ? RESOURCE_INFO[w.carrying].color : null);
        entry.lastCarrying = w.carrying;
      }
      // Interpolated fractional grid position → world position.
      const fx = w.prevX + (w.x - w.prevX) * alpha;
      const fy = w.prevY + (w.y - w.prevY) * alpha;
      const p = gridToScreen(fx, fy);
      const bob = walkBob(fx, fy, w.prevX !== w.x || w.prevY !== w.y);
      // Small per-id offset so idle carriers on the same tile don't stack.
      entry.view.position.set(p.x + ((w.id * 37) % 13) - 6, p.y + ((w.id * 53) % 7) - 3 + bob);
      entry.view.zIndex = fx + fy + 0.5; // bias: in front of the tile they stand on
    }
    for (const [id, entry] of this.workerViews) {
      if (!liveIds.has(id)) {
        entry.view.destroy();
        this.workerViews.delete(id);
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

  /** Manual culling: hide everything outside the camera's view rectangle. */
  private cull(camera: Camera): void {
    const view = camera.visibleRect();
    const minX = view.x - CULL_MARGIN;
    const maxX = view.x + view.w + CULL_MARGIN;
    const minY = view.y - CULL_MARGIN;
    const maxY = view.y + view.h + CULL_MARGIN;
    const visible = (b: Bounds): boolean =>
      b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY;

    for (const chunk of this.terrainChunks) chunk.view.visible = visible(chunk.bounds);
    for (const entry of this.buildingViews.values()) entry.view.visible = visible(entry.bounds);
    for (const entry of this.workerViews.values()) {
      const { x, y } = entry.view.position;
      entry.view.visible = x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    for (const entry of this.soldierViews.values()) {
      const { x, y } = entry.view.position;
      entry.view.visible = x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    for (const entry of this.enemyViews.values()) {
      const { x, y } = entry.view.position;
      entry.view.visible = x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
  }
}
