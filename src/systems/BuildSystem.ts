import { events } from '../core/EventBus';
import { getDef, PlacementRule, type BuildingDef, type BuildingDefId } from '../data/buildings';
import { RESOURCE_INFO, RESOURCE_IDS } from '../data/config';
import type { ResourceStore } from './EconomySystem';
import { IsoGrid, NO_OCCUPANT, Terrain, screenToGrid } from '../world/IsoGrid';

export interface PlacementCheck {
  ok: boolean;
  /** German user-facing reason when not ok. */
  reason?: string;
}

/** Footprint after applying rotation. */
export function rotatedFootprint(def: BuildingDef, rotated: boolean): { w: number; h: number } {
  return rotated ? { w: def.footprint.h, h: def.footprint.w } : { ...def.footprint };
}

/**
 * Pure placement validation (terrain, occupancy, placement rule).
 * Resource affordability is checked separately so the ghost can distinguish
 * "blocked" from "too expensive".
 */
export function checkPlacement(
  grid: IsoGrid,
  def: BuildingDef,
  gx: number,
  gy: number,
  rotated: boolean,
): PlacementCheck {
  const { w, h } = rotatedFootprint(def, rotated);
  // Bridges stand on water; everything else needs grass.
  const requiredTerrain = def.placement === PlacementRule.Water ? Terrain.Water : Terrain.Grass;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = gx + dx;
      const y = gy + dy;
      if (!grid.inBounds(x, y)) return { ok: false, reason: 'Außerhalb der Karte' };
      if (grid.terrainAt(x, y) !== requiredTerrain) {
        return {
          ok: false,
          reason: requiredTerrain === Terrain.Water ? 'Nur auf Wasser baubar' : 'Gelände blockiert',
        };
      }
      if (grid.occupantAt(x, y) !== NO_OCCUPANT) return { ok: false, reason: 'Bereits bebaut' };
    }
  }

  const requireAdjacent = (terrain: Terrain, reason: string): PlacementCheck => {
    let touches = false;
    const checkTile = (x: number, y: number): void => {
      if (grid.inBounds(x, y) && grid.terrainAt(x, y) === terrain) touches = true;
    };
    for (let dx = 0; dx < w; dx++) {
      checkTile(gx + dx, gy - 1);
      checkTile(gx + dx, gy + h);
    }
    for (let dy = 0; dy < h; dy++) {
      checkTile(gx - 1, gy + dy);
      checkTile(gx + w, gy + dy);
    }
    return touches ? { ok: true } : { ok: false, reason };
  };

  if (def.placement === PlacementRule.AdjacentRock) {
    return requireAdjacent(Terrain.Rock, 'Muss an Fels grenzen');
  }
  if (def.placement === PlacementRule.AdjacentForest) {
    return requireAdjacent(Terrain.Forest, 'Muss an Wald grenzen');
  }
  if (def.placement === PlacementRule.AdjacentWater) {
    return requireAdjacent(Terrain.Water, 'Muss am Wasser stehen');
  }
  if (def.placement === PlacementRule.AdjacentOre) {
    return requireAdjacent(Terrain.Ore, 'Muss an einer Erzader stehen');
  }
  return { ok: true };
}

/** German message listing the missing resources of a cost. */
export function missingResourcesMessage(
  store: ResourceStore,
  cost: BuildingDef['cost'],
): string | null {
  const missing = RESOURCE_IDS.filter((r) => store.get(r) < (cost[r] ?? 0));
  if (missing.length === 0) return null;
  return `Nicht genug ${missing.map((r) => RESOURCE_INFO[r].label).join(' und ')}`;
}

export interface GhostState {
  defId: BuildingDefId;
  rotated: boolean;
  /** Top-left tile of the footprint. */
  gx: number;
  gy: number;
  valid: boolean;
}

/** What the build system needs from the game. */
export interface BuildContext {
  grid: IsoGrid;
  store: ResourceStore;
  placeBuilding(defId: BuildingDefId, gx: number, gy: number, rotated: boolean): void;
  /** Instant builds (roads) pay at placement; sites pay via deliveries. */
  paysUpFront(defId: BuildingDefId): boolean;
  /** German reason the building is locked (rank gate), or null. */
  lockedReason(defId: BuildingDefId): string | null;
}

/**
 * Build mode: ghost preview placement, validation and purchase.
 * The renderer reads `ghost` each frame; the UI drives mode via enter/rotate/cancel.
 */
export class BuildSystem {
  private ctx: BuildContext;
  private mode: { defId: BuildingDefId; rotated: boolean } | null = null;
  /** Current ghost position/validity, null while no pointer position known. */
  ghost: GhostState | null = null;

  constructor(ctx: BuildContext) {
    this.ctx = ctx;
  }

  get active(): boolean {
    return this.mode !== null;
  }

  get currentDefId(): BuildingDefId | null {
    return this.mode?.defId ?? null;
  }

  enterBuildMode(defId: BuildingDefId): void {
    this.mode = { defId, rotated: false };
    this.ghost = null;
    events.emit('build:modeChanged', { defId, rotated: false });
  }

  rotate(): void {
    if (!this.mode) return;
    this.mode.rotated = !this.mode.rotated;
    if (this.ghost) this.moveGhostToTopLeft(this.ghost.gx, this.ghost.gy);
    events.emit('build:modeChanged', { defId: this.mode.defId, rotated: this.mode.rotated });
  }

  cancel(): void {
    if (!this.mode) return;
    this.mode = null;
    this.ghost = null;
    events.emit('build:modeChanged', { defId: null, rotated: false });
  }

  /** Move the ghost so its footprint is centered under the world position. */
  updateGhost(worldX: number, worldY: number): void {
    if (!this.mode) return;
    const def = getDef(this.mode.defId);
    const { w, h } = rotatedFootprint(def, this.mode.rotated);
    const g = screenToGrid(worldX, worldY);
    this.moveGhostToTopLeft(Math.round(g.x - (w - 1) / 2), Math.round(g.y - (h - 1) / 2));
  }

  private moveGhostToTopLeft(gx: number, gy: number): void {
    if (!this.mode) return;
    const def = getDef(this.mode.defId);
    const placement = checkPlacement(this.ctx.grid, def, gx, gy, this.mode.rotated);
    const affordable = this.ctx.store.canAfford(def.cost);
    this.ghost = {
      defId: this.mode.defId,
      rotated: this.mode.rotated,
      gx,
      gy,
      valid: placement.ok && affordable,
    };
  }

  /**
   * Attempt to place at the given world position (tap).
   * Returns true if a building was placed; shows a toast otherwise.
   */
  tryPlaceAt(worldX: number, worldY: number): boolean {
    if (!this.mode) return false;
    this.updateGhost(worldX, worldY);
    const ghost = this.ghost;
    if (!ghost) return false;
    const def = getDef(ghost.defId);

    const locked = this.ctx.lockedReason(ghost.defId);
    if (locked) {
      events.emit('toast:show', { message: locked });
      return false;
    }

    const placement = checkPlacement(this.ctx.grid, def, ghost.gx, ghost.gy, ghost.rotated);
    if (!placement.ok) {
      events.emit('toast:show', { message: placement.reason ?? 'Hier nicht möglich' });
      return false;
    }
    const missing = missingResourcesMessage(this.ctx.store, def.cost);
    if (missing) {
      events.emit('toast:show', { message: missing });
      return false;
    }
    // Construction sites are paid through carrier deliveries instead.
    if (this.ctx.paysUpFront(ghost.defId)) this.ctx.store.pay(def.cost);
    this.ctx.placeBuilding(ghost.defId, ghost.gx, ghost.gy, ghost.rotated);
    // Stay in build mode so several buildings can be placed in a row;
    // refresh validity for the spot just built on.
    this.moveGhostToTopLeft(ghost.gx, ghost.gy);
    return true;
  }
}
