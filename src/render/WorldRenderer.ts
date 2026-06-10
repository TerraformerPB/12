import { Application, Container, Graphics } from 'pixi.js';
import { RESOURCE_INFO, TERRAIN_CHUNK_SIZE, TILE_H, TILE_W } from '../data/config';
import { getDef } from '../data/buildings';
import type { Building } from '../entities/Building';
import type { Soldier } from '../entities/Soldier';
import type { Worker } from '../entities/Worker';
import type { Camera } from '../world/Camera';
import { gridToScreen, type IsoGrid } from '../world/IsoGrid';
import type { GhostState } from '../systems/BuildSystem';
import {
  PALETTE,
  createBuildingView,
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
}

interface WorkerViewEntry {
  view: Graphics;
  lastCarrying: string | null;
}

interface SoldierViewEntry {
  view: Graphics;
  lastSelected: boolean;
}

/** Everything the renderer needs to draw one frame. */
export interface RenderState {
  grid: IsoGrid;
  buildings: Map<number, Building>;
  workers: Worker[];
  soldiers: Soldier[];
  ghost: GhostState | null;
  selectedId: number | null;
  selectedSoldierId: number | null;
}

const CULL_MARGIN = TILE_W * 2;

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
            drawTerrainTile(g, p.x, p.y, grid.terrainAt(gx, gy), (gx + gy) % 2 === 0);
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
    this.buildingViews.clear();
    this.workerViews.clear();
    this.soldierViews.clear();
    this.ghostKey = '';
    this.selectionKey = '';
  }

  /** Render one frame. `alpha` interpolates worker movement between ticks. */
  renderFrame(camera: Camera, state: RenderState, alpha: number): void {
    camera.apply(this.world);
    this.syncBuildings(state);
    this.syncWorkers(state, alpha);
    this.syncSoldiers(state, alpha);
    this.syncGhost(state);
    this.syncSelection(state);
    this.cull(camera);
    this.app.render();
  }

  private syncSoldiers(state: RenderState, alpha: number): void {
    const liveIds = new Set<number>();
    for (const s of state.soldiers) {
      liveIds.add(s.id);
      let entry = this.soldierViews.get(s.id);
      if (!entry) {
        const view = new Graphics();
        drawSoldier(view, false);
        this.objectLayer.addChild(view);
        entry = { view, lastSelected: false };
        this.soldierViews.set(s.id, entry);
      }
      const selected = state.selectedSoldierId === s.id;
      if (entry.lastSelected !== selected) {
        drawSoldier(entry.view, selected);
        entry.lastSelected = selected;
      }
      const fx = s.prevX + (s.x - s.prevX) * alpha;
      const fy = s.prevY + (s.y - s.prevY) * alpha;
      const p = gridToScreen(fx, fy);
      entry.view.position.set(p.x, p.y);
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
      if (this.buildingViews.has(b.id)) continue;
      const view = createBuildingView(b.def, b.w, b.h);
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
      // Small per-id offset so idle carriers on the same tile don't stack.
      entry.view.position.set(p.x + ((w.id * 37) % 13) - 6, p.y + ((w.id * 53) % 7) - 3);
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
  }
}
