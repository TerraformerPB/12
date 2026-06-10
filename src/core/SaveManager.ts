import {
  BUILDING_DEFAULT_HP,
  SAVE_KEY,
  SAVE_VERSION,
  SOLDIER_HP,
  WAVE_FIRST_DELAY,
  type ResourceId,
} from '../data/config';
import { getDef } from '../data/buildings';
import type { BuildingSave } from '../entities/Building';
import type { EnemySave } from '../entities/Enemy';
import type { SoldierSave } from '../entities/Soldier';
import type { WorkerSave } from '../entities/Worker';
import type { WaveSave } from '../systems/WaveSystem';

/** Complete serialized game state. Versioned for future migrations. */
export interface SaveData {
  saveVersion: number;
  /** Terrain is fully derived from this seed and not stored. */
  seed: number;
  nextEntityId: number;
  resources: Record<ResourceId, number>;
  buildings: BuildingSave[];
  workers: WorkerSave[];
  /** Since save version 2. */
  soldiers: SoldierSave[];
  /** Since save version 3. */
  enemies: EnemySave[];
  wave: WaveSave;
}

/**
 * Upgrade older savegames in place, one version step at a time.
 * Returns null when the version is unknown (newer than this build).
 */
export function migrateSave(data: SaveData): SaveData | null {
  if (data.saveVersion === 1) {
    // v1 → v2: soldiers introduced in phase 2.
    data.soldiers = [];
    data.saveVersion = 2;
  }
  if (data.saveVersion === 2) {
    // v2 → v3: combat. Buildings/soldiers gain hp, waves start fresh.
    for (const b of data.buildings) {
      b.hp = getDef(b.defId).maxHp ?? BUILDING_DEFAULT_HP;
    }
    for (const s of data.soldiers) {
      s.hp = SOLDIER_HP;
      s.anchor = { x: Math.round(s.x), y: Math.round(s.y) };
    }
    data.enemies = [];
    data.wave = { number: 0, nextInSeconds: WAVE_FIRST_DELAY, kills: 0 };
    data.saveVersion = 3;
  }
  return data.saveVersion === SAVE_VERSION ? data : null;
}

/** Minimal storage interface so tests can inject a fake. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * localStorage persistence. Game state assembly/restoration lives in Game;
 * this class only handles (de)serialization, versioning and storage errors.
 */
export class SaveManager {
  private storage: KeyValueStorage;
  private key: string;

  constructor(storage: KeyValueStorage = localStorage, key: string = SAVE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  save(data: SaveData): boolean {
    try {
      this.storage.setItem(this.key, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('Savegame konnte nicht gespeichert werden:', err);
      return false;
    }
  }

  load(): SaveData | null {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const migrated = migrateSave(JSON.parse(raw) as SaveData);
      if (!migrated) {
        console.warn('Unbekannte Savegame-Version, starte neu.');
        return null;
      }
      return migrated;
    } catch (err) {
      console.warn('Savegame konnte nicht geladen werden:', err);
      return null;
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      // ignore
    }
  }
}
