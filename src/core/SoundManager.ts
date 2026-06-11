import { Howl } from 'howler';

/** Sound effect identifiers. */
export type SoundId =
  | 'place'
  | 'demolish'
  | 'error'
  | 'ui'
  | 'horn'
  | 'arrow'
  | 'hit'
  | 'death'
  | 'gameover';

const SAMPLE_RATE = 22050;

/** Encode mono float samples [-1..1] as a base64 WAV data URI. */
function toWavDataUri(samples: Float32Array): string {
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v * 0x7fff, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

/** A decaying tone sweep; `noise` blends in white noise for percussive FX. */
function synth(
  durationS: number,
  freqFrom: number,
  freqTo: number,
  noise = 0,
  volume = 0.5,
): Float32Array {
  const n = Math.floor(SAMPLE_RATE * durationS);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = freqFrom + (freqTo - freqFrom) * t;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const env = Math.exp(-3.5 * t) * (1 - Math.exp(-40 * t)); // fast attack, exp decay
    const tone = Math.sin(phase) * (1 - noise);
    const hiss = (Math.random() * 2 - 1) * noise;
    out[i] = (tone + hiss) * env * volume;
  }
  return out;
}

/**
 * Audio via Howler. All effects are tiny WAVs synthesized at startup —
 * no third-party assets. Real recorded sounds can replace single entries
 * in `defs` later without touching any call site.
 */
const MUTE_KEY = 'burgspiel.muted';

export class SoundManager {
  private sounds = new Map<SoundId, Howl>();
  private ambient: Howl | null = null;
  private muted = false;
  /** Per-id throttle so rapid combat doesn't stack dozens of plays. */
  private lastPlayed = new Map<SoundId, number>();

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  async preload(): Promise<void> {
    const defs: Record<SoundId, Float32Array> = {
      place: synth(0.12, 520, 280, 0.1, 0.4),
      demolish: synth(0.25, 180, 60, 0.5, 0.5),
      error: synth(0.18, 160, 110, 0.05, 0.35),
      ui: synth(0.06, 700, 600, 0, 0.2),
      horn: synth(1.1, 140, 220, 0.05, 0.5),
      arrow: synth(0.1, 900, 300, 0.7, 0.25),
      hit: synth(0.08, 200, 90, 0.6, 0.3),
      death: synth(0.3, 300, 70, 0.3, 0.4),
      gameover: synth(1.4, 330, 90, 0.1, 0.5),
    };
    for (const [id, samples] of Object.entries(defs) as [SoundId, Float32Array][]) {
      this.sounds.set(id, new Howl({ src: [toWavDataUri(samples)], format: ['wav'] }));
    }
    this.ambient = new Howl({
      src: [toWavDataUri(ambientLoop())],
      format: ['wav'],
      loop: true,
      volume: 0.16,
    });
  }

  /** Begin the looping background ambience (no-op while muted). */
  startAmbient(): void {
    if (this.muted || !this.ambient || this.ambient.playing()) return;
    this.ambient.play();
  }

  play(id: SoundId): void {
    if (this.muted) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(id) ?? -1000) < 90) return;
    this.lastPlayed.set(id, now);
    this.sounds.get(id)?.play();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // ignore
    }
    if (muted) this.ambient?.pause();
    else this.startAmbient();
  }

  isMuted(): boolean {
    return this.muted;
  }
}

/**
 * Seamless 6-second ambience: a soft A-minor-ish pad whose envelope is
 * zero at the loop boundaries, plus faint wind noise under the same
 * envelope so the loop point is inaudible.
 */
function ambientLoop(): Float32Array {
  const duration = 6;
  const n = SAMPLE_RATE * duration;
  const out = new Float32Array(n);
  const freqs = [110, 165, 220, 330]; // whole cycles within 6 s → no click
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.sin((Math.PI * i) / n) ** 2;
    let v = 0;
    for (let k = 0; k < freqs.length; k++) {
      v += Math.sin(2 * Math.PI * freqs[k] * t) * (0.5 / (k + 1));
    }
    // Faint wind: noise through a crude one-pole lowpass.
    v += (Math.random() * 2 - 1) * 0.12;
    out[i] = v * env * 0.28;
  }
  // Smooth the noise component cheaply.
  for (let i = 1; i < n; i++) out[i] = out[i - 1] * 0.6 + out[i] * 0.4;
  return out;
}
