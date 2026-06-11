import { Assets, Texture } from 'pixi.js';

/**
 * Animated unit sprites from public/sprites/manifest.json ("units" section):
 * frame 0 = idle, frames 1..n = walk cycle. Units without an entry keep
 * their vector placeholder (see WorldRenderer fallback paths).
 */

export interface UnitSpriteSet {
  textures: Texture[];
  /** Anchor (feet center) as a 0..1 fraction of the image. */
  anchorU: number;
  anchorV: number;
  /** Display scale (0.5 for 2× art). */
  scale: number;
}

interface ManifestUnit {
  frames: string[];
  anchorX: number;
  anchorY: number;
  scale?: number;
}

export class UnitSprites {
  private sets = new Map<string, UnitSpriteSet>();

  async load(): Promise<void> {
    let manifest: { units?: Record<string, ManifestUnit> };
    try {
      const res = await fetch('sprites/manifest.json');
      if (!res.ok) return;
      manifest = (await res.json()) as { units?: Record<string, ManifestUnit> };
    } catch {
      return;
    }
    for (const [id, entry] of Object.entries(manifest.units ?? {})) {
      try {
        const textures: Texture[] = [];
        for (const file of entry.frames) {
          textures.push(await Assets.load<Texture>(`sprites/${file}`));
        }
        const w = textures[0].width;
        const h = textures[0].height;
        this.sets.set(id, {
          textures,
          anchorU: entry.anchorX / w,
          anchorV: entry.anchorY / h,
          scale: entry.scale ?? 1,
        });
      } catch (err) {
        console.warn(`Einheiten-Sprites für ${id} konnten nicht geladen werden:`, err);
      }
    }
  }

  get(id: string): UnitSpriteSet | null {
    return this.sets.get(id) ?? null;
  }
}

/** Walk-cycle frame for a unit at fractional position (fx, fy). */
export function unitFrame(set: UnitSpriteSet, fx: number, fy: number, moving: boolean): number {
  if (!moving) return 0;
  const walkFrames = set.textures.length - 1;
  if (walkFrames <= 0) return 0;
  const t = ((fx + fy) * 1.5) % 1;
  return 1 + (Math.floor(t * walkFrames) % walkFrames);
}
