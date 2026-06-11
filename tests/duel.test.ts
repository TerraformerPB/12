import { describe, expect, it } from 'vitest';
import { decodeCastle, encodeCastle, type CastleSnapshot } from '../src/core/CastleCode';
import { DUEL_ARMY_CAP, computeArmy } from '../src/data/duel';

const RES = {
  wood: 0, stone: 0, ore: 0, weapons: 0, wheat: 0, flour: 0, bread: 0, fish: 0, beer: 0,
};

describe('castle codes', () => {
  it('round-trips a castle snapshot', () => {
    const snapshot: Omit<CastleSnapshot, 'v'> = {
      seed: 987654,
      overrides: [[3, 4, 0]],
      buildings: [
        { d: 'warehouse', x: 23, y: 23, r: 0, l: 2 },
        { d: 'tower', x: 19, y: 21, r: 0, l: 3 },
        { d: 'fishery', x: 10, y: 11, r: 1, l: 1 },
      ],
      soldiers: [{ x: 20, y: 20 }],
      techs: ['steelArrows'],
    };
    const code = encodeCastle(snapshot);
    expect(code.startsWith('BURG1.')).toBe(true);
    expect(decodeCastle(code)).toEqual({ v: 1, ...snapshot });
    // Whitespace from messengers is tolerated.
    expect(decodeCastle(`  ${code}\n`)).not.toBeNull();
  });

  it('rejects garbage and foreign prefixes', () => {
    expect(decodeCastle('quatsch')).toBeNull();
    expect(decodeCastle('BURG1.%%%')).toBeNull();
    expect(decodeCastle('BURG2.abc')).toBeNull();
  });
});

describe('duel army', () => {
  it('converts bread, weapons, fish and soldiers into troops', () => {
    const army = computeArmy({ ...RES, bread: 9, weapons: 10, fish: 12 }, 2);
    const count = (id: string): number => army.filter((a) => a === id).length;
    expect(count('raider')).toBe(3 + 4); // 9/3 bread + 2 soldiers × 2
    expect(count('brute')).toBe(2); // 10/5 weapons
    expect(count('skirmisher')).toBe(2); // 12/6 fish
  });

  it('returns an empty army without supplies', () => {
    expect(computeArmy({ ...RES }, 0)).toEqual([]);
  });

  it('caps the army size', () => {
    const army = computeArmy({ ...RES, bread: 900 }, 50);
    expect(army.length).toBe(DUEL_ARMY_CAP);
  });
});
