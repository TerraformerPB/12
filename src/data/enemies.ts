/**
 * Data-driven enemy definitions (phase 4).
 * A new enemy type = a new entry here plus a slot in `waveComposition`.
 */

export interface EnemyDef {
  id: EnemyDefId;
  name: string;
  hp: number;
  /** Tiles per second. */
  speed: number;
  damage: number;
  /** Seconds between strikes. */
  attackInterval: number;
  /** Attack reach in tiles; melee when omitted. */
  range?: number;
  /** Siege vehicles ignore soldiers and only batter buildings. */
  ignoresSoldiers?: boolean;
  /** Placeholder art parameters. */
  art: { color: number; radius: number };
}

export const ENEMY_DEFS = {
  raider: {
    id: 'raider',
    name: 'Plünderer',
    hp: 20,
    speed: 1.5,
    damage: 2,
    attackInterval: 1.0,
    art: { color: 0x47324d, radius: 6.5 },
  },
  brute: {
    id: 'brute',
    name: 'Brecher',
    hp: 60,
    speed: 1.0,
    damage: 6,
    attackInterval: 1.4,
    art: { color: 0x5c2e2e, radius: 9 },
  },
  skirmisher: {
    id: 'skirmisher',
    name: 'Plänkler',
    hp: 14,
    speed: 1.7,
    damage: 3,
    attackInterval: 1.6,
    range: 4.5,
    art: { color: 0x3e5a46, radius: 6 },
  },
  ram: {
    id: 'ram',
    name: 'Rammbock',
    hp: 130,
    speed: 0.7,
    damage: 25,
    attackInterval: 3,
    ignoresSoldiers: true,
    art: { color: 0x5a4632, radius: 10 },
  },
} as const satisfies Record<string, Omit<EnemyDef, 'id'> & { id: string }>;

export type EnemyDefId = keyof typeof ENEMY_DEFS;

export function getEnemyDef(id: EnemyDefId): EnemyDef {
  return ENEMY_DEFS[id] as EnemyDef;
}

/** Which enemies make up wave `n` (raider count comes from waveSize). */
export function waveComposition(n: number, raiders: number): { defId: EnemyDefId; count: number }[] {
  const parts: { defId: EnemyDefId; count: number }[] = [{ defId: 'raider', count: raiders }];
  // Brutes join from wave 3 on, one more every third wave.
  const brutes = Math.floor(n / 3);
  if (brutes > 0) parts.push({ defId: 'brute', count: brutes });
  // Ranged skirmishers from wave 4 on.
  const skirmishers = Math.floor((n - 1) / 3);
  if (skirmishers > 0) parts.push({ defId: 'skirmisher', count: skirmishers });
  // Battering rams from wave 6 on.
  const rams = n >= 6 ? 1 + Math.floor((n - 6) / 3) : 0;
  if (rams > 0) parts.push({ defId: 'ram', count: rams });
  return parts;
}
