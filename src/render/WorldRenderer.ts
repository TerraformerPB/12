import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { RESOURCE_INFO, TERRAIN_CHUNK_SIZE, TILE_H, TILE_W } from '../data/config';
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
  drawEnemy,
  drawGhost,
  drawHpBar,
  drawSelection,
  drawSoldier,
  drawTerrainTile,
  drawWorker,
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

    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w: number, h: number): void {
    this.app.renderer.resize(w, h);
  }

  /** Seasonal map mood — terrain is baked into chunk textures, so one tint. */
  setSeasonTint(color: number): void {
    this.terrainLayer.tint = color;
  }

  /** (Re)build the static terrain chunk textures. Call after terrain changes. */
  buildTerrain(grid: IsoGrid): void {
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
        drawTerrainTile(g, p.x, p.y, grid.terrainAt(gx, gy), (gx + gy) % 2 === 0, gx, gy);
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
    this.buildingViews.clear();
    this.workerViews.clear();
    this.soldierViews.clear();
    this.enemyViews.clear();
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
          const tex = this.buildingSprites.get(this.app.renderer, b.def, b.w, b.h, b.level);
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
        continue;
      }
      const tex = this.buildingSprites.get(this.app.renderer, b.def, b.w, b.h, b.level);
      const sprite = new Sprite(tex.texture);
      sprite.position.set(tex.offsetX, tex.offsetY);
      sprite.scale.set(tex.scale);
      // Duel: the opposing castle reads as hostile via a reddish tint.
      if (b.owner === 'foe') sprite.tint = 0xffb0a0;
      const hpBar = new Graphics();
      const view = new Container();
      view.addChild(sprite, hpBar);
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
      };
      this.updateOverlay(entry, b);
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

    for (const chunk of this.terrainChunks.values()) chunk.view.visible = visible(chunk.bounds);
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
