import { Assets, Graphics, Texture, type Renderer } from 'pixi.js';
import type { BuildingDef } from '../data/buildings';
import { drawBuildingView } from './placeholders';

/**
 * Building sprite source with two layers:
 *
 * 1. EXTERNAL ART — real sprites dropped into `public/sprites/` and listed
 *    in `public/sprites/manifest.json` are used automatically (see
 *    ASSETS.md for the exact pixel spec). No code changes needed.
 * 2. BAKED PLACEHOLDERS — everything else is drawn once via
 *    `placeholders.ts` and baked into a texture. All buildings of the same
 *    type/level share one texture, which keeps wall-heavy maps cheap.
 */

interface SpriteEntry {
  texture: Texture;
  /** Offset of the texture's top-left from the anchor tile center, world px. */
  offsetX: number;
  offsetY: number;
  /** Display scale (0.5 for art delivered at 2× resolution). */
  scale: number;
}

interface ManifestSprite {
  /** File name inside public/sprites/. */
  file: string;
  /**
   * Pixel position INSIDE the image that sits on the anchor point
   * (center of the footprint's top-left tile).
   */
  anchorX: number;
  anchorY: number;
  /** Display scale; 0.5 when the art is delivered at 2× resolution. */
  scale?: number;
  /** Optional per-level variants: file name per level (1-based index). */
  levels?: string[];
}

interface SpriteManifest {
  buildings?: Record<string, ManifestSprite>;
}

const BAKE_RESOLUTION = 2;

export class BuildingSprites {
  private baked = new Map<string, SpriteEntry>();
  private external = new Map<string, SpriteEntry>();

  /** Load real art listed in the manifest; silently absent in dev. */
  async loadExternal(): Promise<void> {
    let manifest: SpriteManifest;
    try {
      const res = await fetch('sprites/manifest.json');
      if (!res.ok) return;
      manifest = (await res.json()) as SpriteManifest;
    } catch {
      return; // no manifest — placeholders everywhere
    }
    for (const [defId, entry] of Object.entries(manifest.buildings ?? {})) {
      const files = entry.levels?.length ? entry.levels : [entry.file];
      for (let level = 1; level <= files.length; level++) {
        try {
          const texture = await Assets.load<Texture>(`sprites/${files[level - 1]}`);
          const scale = entry.scale ?? 1;
          this.external.set(`${defId}:L${level}`, {
            texture,
            offsetX: -entry.anchorX * scale,
            offsetY: -entry.anchorY * scale,
            scale,
          });
        } catch (err) {
          console.warn(`Sprite ${files[level - 1]} konnte nicht geladen werden:`, err);
        }
      }
    }
  }

  /** Texture for a building type at a given size/level. */
  get(
    renderer: Renderer,
    def: BuildingDef,
    w: number,
    h: number,
    level: number,
    rotated = false,
  ): SpriteEntry {
    // Real art first (exact level, then base) — but only in the default
    // orientation; rotated footprints fall back to the baked placeholder.
    if (w === def.footprint.w && h === def.footprint.h) {
      const ext = this.external.get(`${def.id}:L${level}`) ?? this.external.get(`${def.id}:L1`);
      if (ext) return ext;
    }

    const key = `${def.id}:${w}x${h}:${rotated ? 'r' : 'n'}:L${level}`;
    let entry = this.baked.get(key);
    if (!entry) {
      const g = new Graphics();
      drawBuildingView(g, def, w, h, 1, level, rotated);
      const bounds = g.getLocalBounds();
      const texture = renderer.generateTexture({ target: g, resolution: BAKE_RESOLUTION });
      g.destroy();
      entry = { texture, offsetX: bounds.minX, offsetY: bounds.minY, scale: 1 };
      this.baked.set(key, entry);
    }
    return entry;
  }

  /** Check if a building has a loaded external sprite variant at this level. */
  hasExternal(defId: string, level: number): boolean {
    return this.external.has(`${defId}:L${level}`);
  }
}
