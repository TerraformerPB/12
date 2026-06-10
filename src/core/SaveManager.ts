import { SAVE_KEY, SAVE_VERSION, type ResourceId } from '../data/config';
import type { BuildingSave } from '../entities/Building';
import type { WorkerSave } from '../entities/Worker';

/** Complete serialized game state. Versioned for future migrations. */
export interface SaveData {
  saveVersion: number;
  /** Terrain is fully derived from this seed and not stored. */
  seed: number;
  nextEntityId: number;
  resources: Record<ResourceId, number>;
  buildings: BuildingSave[];
  workers: WorkerSave[];
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
      const data = JSON.parse(raw) as SaveData;
      if (data.saveVersion !== SAVE_VERSION) {
        // Extension point: run migrations here once SAVE_VERSION > 1.
        console.warn(`Unbekannte Savegame-Version ${data.saveVersion}, starte neu.`);
        return null;
      }
      return data;
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
