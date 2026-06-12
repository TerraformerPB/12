import { MORALE_START, SAVE_KEY, SAVE_VERSION, type ResourceId } from '../data/config';
import type { BuildingSave } from '../entities/Building';
import type { EnemySave } from '../entities/Enemy';
import type { SoldierSave } from '../entities/Soldier';
import type { WorkerSave } from '../entities/Worker';
import type { TechId } from '../data/techs';
import type { WaveSave } from '../systems/WaveSystem';
import type { DiplomacySave } from '../systems/DiplomacySystem';

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
  /** Since save version 4. */
  techs: TechId[];
  tutorialStep: number;
  /** Since save version 7: terrain changes (felled/regrown forest). */
  terrainOverrides: [number, number, number][];
  /** Since save version 9. */
  morale: number;
  taxLevel: number;
  seasonTicks: number;
  scenarioId: string;
  /** Since save version 10 (empire scenario). */
  prestige: number;
  diplomacy: DiplomacySave | null;
}

/**
 * Upgrade older savegames in place, one version step at a time.
 * Returns null when the version is unknown (newer than this build).
 */
export function migrateSave(data: SaveData): SaveData | null {
  // v5 changed the terrain generator (forests, guaranteed start resources):
  // older worlds cannot be reproduced from their seed, so anything below
  // v5 starts a fresh game. Future versions migrate step by step from here.
  if (data.saveVersion < 5) {
    console.warn('Savegame vor Version 5 — Terrain hat sich geändert, starte neu.');
    return null;
  }
  if (data.saveVersion === 5) {
    // v5 → v6: building levels introduced.
    for (const b of data.buildings) b.level = 1;
    data.saveVersion = 6;
  }
  if (data.saveVersion === 6) {
    // v6 → v7: finite forest (harvest progress + terrain overrides).
    for (const b of data.buildings) b.harvestProgress = 0;
    data.terrainOverrides = [];
    data.saveVersion = 7;
  }
  if (data.saveVersion === 7) {
    // v7 → v8: soldier types and ox carts.
    for (const s of data.soldiers) s.typeId = s.typeId ?? 'soldier';
    for (const w of data.workers) {
      w.isCart = w.isCart ?? false;
      w.carryingCount = w.carryingCount ?? (w.carrying ? 1 : 0);
    }
    data.saveVersion = 8;
  }
  if (data.saveVersion === 8) {
    // v8 → v9: consumption/morale, construction, veterans, gold, seasons.
    data.morale = MORALE_START;
    data.taxLevel = 0;
    data.seasonTicks = 0;
    data.scenarioId = 'endless';
    data.resources.gold = data.resources.gold ?? 0;
    for (const b of data.buildings) {
      b.underConstruction = false;
      b.materialsRemaining = {};
      b.buildTicks = 0;
    }
    for (const s of data.soldiers) s.kills = 0;
    data.saveVersion = 9;
  }
  if (data.saveVersion === 9) {
    // v9 → v10: empire scenario (wool/cloth, prestige, diplomacy).
    data.resources.wool = data.resources.wool ?? 0;
    data.resources.cloth = data.resources.cloth ?? 0;
    data.prestige = 0;
    data.diplomacy = null;
    data.saveVersion = 10;
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
