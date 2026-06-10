import type { ResourceId } from '../data/config';
import type { BuildingDefId } from '../data/buildings';
import type { Building } from '../entities/Building';
import type { Soldier } from '../entities/Soldier';

export type GamePhase = 'loading' | 'playing' | 'paused' | 'gameover';

/**
 * All events flowing between game logic and DOM UI.
 * The UI never reaches into systems directly — it listens here and calls
 * the few public methods on `Game`.
 */
export interface GameEvents {
  'resources:changed': Readonly<Record<ResourceId, number>>;
  'population:changed': { used: number; total: number };
  'toast:show': { message: string };
  'building:selected': { building: Building | null };
  'soldier:selected': { soldier: Soldier | null };
  'build:modeChanged': { defId: BuildingDefId | null; rotated: boolean };
  'game:phaseChanged': { phase: GamePhase };
  'game:loaded': void;
  'wave:started': { wave: number; count: number };
  'wave:status': { wave: number; nextInSeconds: number; enemiesAlive: number; kills: number };
  'game:over': { wavesSurvived: number; kills: number };
}

type Handler<P> = (payload: P) => void;

/** Minimal typed pub/sub. Decouples UI from game logic. */
export class EventBus<E> {
  // Handlers are stored type-erased; `on`/`emit` signatures guarantee that
  // a handler registered for key K only ever receives E[K].
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof E>(event: K, handler: Handler<E[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Handler<E[K]>)(payload);
    }
  }
}

/** Global bus instance shared by game systems and UI. */
export const events = new EventBus<GameEvents>();
