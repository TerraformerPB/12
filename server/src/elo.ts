/** Elo rating for online duels. Everyone starts at 1000. */

export const ELO_START = 1000;
const K = 32;

/** Rating deltas for attacker/defender after one duel. */
export function eloDeltas(
  attacker: number,
  defender: number,
  attackerWon: boolean,
): { attacker: number; defender: number } {
  const expected = 1 / (1 + 10 ** ((defender - attacker) / 400));
  const score = attackerWon ? 1 : 0;
  const delta = Math.round(K * (score - expected));
  return { attacker: delta, defender: -delta };
}
