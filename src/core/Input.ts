import { TAP_MAX_MS, TAP_MAX_PX, WHEEL_ZOOM_STEP } from '../data/config';
import type { Camera } from '../world/Camera';

export interface InputCallbacks {
  /** Quick press without movement — selection or placement. */
  onTap(screenX: number, screenY: number): void;
  /** Pointer position changed (hover or drag) — drives the ghost preview. */
  onHover(screenX: number, screenY: number): void;
}

interface TrackedPointer {
  x: number;
  y: number;
}

/**
 * Unified pointer handling for touch and mouse (Pointer Events API).
 *
 * Gestures:
 * - one pointer drag  → camera pan
 * - two pointer pinch → zoom around the pinch midpoint + pan
 * - tap (< TAP_MAX_MS, < TAP_MAX_PX movement, never multi-touch) → onTap
 * - mouse wheel → zoom around the cursor
 *
 * The tap/drag distinction is strict: any gesture that ever had two
 * pointers or moved beyond the threshold can no longer become a tap,
 * so panning/pinching never places buildings accidentally.
 */
export class InputController {
  private el: HTMLCanvasElement;
  private camera: Camera;
  private cb: InputCallbacks;

  private pointers = new Map<number, TrackedPointer>();
  private gesture: {
    startX: number;
    startY: number;
    startTime: number;
    moved: boolean;
    hadMultiTouch: boolean;
  } | null = null;
  private pinch: { dist: number; midX: number; midY: number } | null = null;

  constructor(el: HTMLCanvasElement, camera: Camera, cb: InputCallbacks) {
    this.el = el;
    this.camera = camera;
    this.cb = cb;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 1) {
      this.gesture = {
        startX: p.x,
        startY: p.y,
        startTime: performance.now(),
        moved: false,
        hadMultiTouch: false,
      };
    } else if (this.pointers.size === 2) {
      if (this.gesture) this.gesture.hadMultiTouch = true;
      this.pinch = this.computePinch();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked) {
      // Mouse hover without a pressed button.
      this.cb.onHover(p.x, p.y);
      return;
    }

    if (this.pointers.size === 1 && this.gesture) {
      const dx = p.x - tracked.x;
      const dy = p.y - tracked.y;
      tracked.x = p.x;
      tracked.y = p.y;
      if (
        Math.hypot(p.x - this.gesture.startX, p.y - this.gesture.startY) > TAP_MAX_PX
      ) {
        this.gesture.moved = true;
      }
      if (this.gesture.moved) this.camera.panBy(dx, dy);
      this.cb.onHover(p.x, p.y);
    } else if (this.pointers.size >= 2) {
      tracked.x = p.x;
      tracked.y = p.y;
      const next = this.computePinch();
      if (this.pinch && next) {
        this.camera.panBy(next.midX - this.pinch.midX, next.midY - this.pinch.midY);
        if (this.pinch.dist > 0) {
          this.camera.zoomAt(next.dist / this.pinch.dist, next.midX, next.midY);
        }
      }
      this.pinch = next;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);

    if (this.pointers.size === 0) {
      const g = this.gesture;
      this.gesture = null;
      this.pinch = null;
      if (
        g &&
        !g.moved &&
        !g.hadMultiTouch &&
        performance.now() - g.startTime < TAP_MAX_MS
      ) {
        this.cb.onTap(p.x, p.y);
      }
    } else if (this.pointers.size === 1) {
      // Pinch ended; keep panning with the remaining finger, but never tap.
      this.pinch = null;
    } else {
      this.pinch = this.computePinch();
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.gesture = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    this.camera.zoomAt(factor, p.x, p.y);
  };

  private computePinch(): { dist: number; midX: number; midY: number } | null {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }
}
