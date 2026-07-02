import type { AppState } from './types';
import { initialState } from './seed';

export { uid, todayISO, addDaysISO } from './util';

const STORAGE_KEY = 'freelance-cockpit-v1';

type Listener = () => void;
const listeners: Listener[] = [];

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && parsed.version === 1) return parsed;
    }
  } catch {
    // defekter Save → frisch starten
  }
  return initialState();
}

export const store = {
  state: load(),
  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  },
  /** Mutiert den State, persistiert und benachrichtigt die UI. */
  update(fn: (s: AppState) => void): void {
    fn(this.state);
    this.save();
    for (const l of listeners) l();
  },
  replace(next: AppState): void {
    this.state = next;
    this.save();
    for (const l of listeners) l();
  },
  subscribe(l: Listener): void {
    listeners.push(l);
  },
};
