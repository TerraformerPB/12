import type { BuildingDefId } from '../data/buildings';
import type { TechId } from '../data/techs';

/**
 * Castle sharing codes for the offline duel mode ("Burg-Duell"):
 * a compact, copy-pasteable snapshot of a player's castle. The future
 * backend (phase 10) replaces manual code exchange with matchmaking but
 * can keep this exact format as its payload.
 */

export interface CastleSnapshot {
  v: 1;
  seed: number;
  overrides: [number, number, number][];
  buildings: { d: BuildingDefId; x: number; y: number; r: 0 | 1; l: number }[];
  soldiers: { x: number; y: number }[];
  techs: TechId[];
}

const PREFIX = 'BURG1.';

/** Unicode-safe base64url. */
function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string | null {
  try {
    const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeCastle(snapshot: Omit<CastleSnapshot, 'v'>): string {
  return PREFIX + toBase64Url(JSON.stringify({ v: 1, ...snapshot }));
}

export function decodeCastle(code: string): CastleSnapshot | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const json = fromBase64Url(trimmed.slice(PREFIX.length));
  if (!json) return null;
  try {
    const data = JSON.parse(json) as CastleSnapshot;
    if (data.v !== 1 || typeof data.seed !== 'number' || !Array.isArray(data.buildings)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
