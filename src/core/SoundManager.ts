import type { Howl } from 'howler';

/** Sound effect identifiers; wired up in a later phase. */
export type SoundId = 'place' | 'demolish' | 'error' | 'pickup' | 'ui';

/**
 * Phase 1 stub around Howler.js. All call sites are already in place
 * (placement, demolition, errors); phase 2 fills `sounds` with real Howl
 * instances without touching callers.
 */
export class SoundManager {
  private sounds = new Map<SoundId, Howl>();
  private muted = false;

  /** Load sound assets. No-op in phase 1. */
  async preload(): Promise<void> {
    // Intentionally empty: no audio assets in phase 1.
  }

  play(id: SoundId): void {
    if (this.muted) return;
    this.sounds.get(id)?.play();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }
}
