import type { Container } from 'pixi.js';
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../data/config';
import { gridToScreen, type Point } from './IsoGrid';

/**
 * Camera over the world container. Holds the world-space point at the
 * viewport center plus a zoom factor, and clamps so the map can never
 * leave the viewport entirely.
 */
export class Camera {
  /** World-space coordinates at the viewport center. */
  x = 0;
  y = 0;
  zoom = ZOOM_DEFAULT;

  viewportW = 1;
  viewportH = 1;

  private boundsMinX = 0;
  private boundsMaxX = 0;
  private boundsMinY = 0;
  private boundsMaxY = 0;

  /** Compute world-space map bounds from the grid size (diamond corners). */
  setMapBounds(mapW: number, mapH: number): void {
    const corners = [
      gridToScreen(0, 0),
      gridToScreen(mapW - 1, 0),
      gridToScreen(mapW - 1, mapH - 1),
      gridToScreen(0, mapH - 1),
    ];
    this.boundsMinX = Math.min(...corners.map((c) => c.x));
    this.boundsMaxX = Math.max(...corners.map((c) => c.x));
    this.boundsMinY = Math.min(...corners.map((c) => c.y));
    this.boundsMaxY = Math.max(...corners.map((c) => c.y));
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
    this.clamp();
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
    this.clamp();
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  /** Zoom keeping the world point under the given screen position fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  screenToWorld(sx: number, sy: number): Point {
    return {
      x: this.x + (sx - this.viewportW / 2) / this.zoom,
      y: this.y + (sy - this.viewportH / 2) / this.zoom,
    };
  }

  worldToScreen(wx: number, wy: number): Point {
    return {
      x: (wx - this.x) * this.zoom + this.viewportW / 2,
      y: (wy - this.y) * this.zoom + this.viewportH / 2,
    };
  }

  /** Visible world-space rectangle (for culling). */
  visibleRect(): { x: number; y: number; w: number; h: number } {
    const w = this.viewportW / this.zoom;
    const h = this.viewportH / this.zoom;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }

  /** Keep the camera center inside the map bounds. */
  private clamp(): void {
    this.x = Math.min(this.boundsMaxX, Math.max(this.boundsMinX, this.x));
    this.y = Math.min(this.boundsMaxY, Math.max(this.boundsMinY, this.y));
  }

  /** Apply the camera transform to the Pixi world container. */
  apply(world: Container): void {
    world.scale.set(this.zoom);
    world.position.set(
      this.viewportW / 2 - this.x * this.zoom,
      this.viewportH / 2 - this.y * this.zoom,
    );
  }
}
