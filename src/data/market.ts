import type { ResourceId } from './config';

/** Static base prices in gold per unit (phase 12; dynamic prices later). */
export const SELL_PRICE: Partial<Record<ResourceId, number>> = {
  wood: 1, stone: 1, ore: 2, weapons: 4, wheat: 1, flour: 2, bread: 2, fish: 1, beer: 2,
};
/** Buying costs a markup over the sell price. */
export const BUY_MARKUP = 2;
/** Trade guild research improves both directions. */
export const TRADE_GUILD_SELL_FACTOR = 1.25;
export const TRADE_GUILD_BUY_FACTOR = 0.85;
/** Units per trade tap. */
export const TRADE_BATCH = 5;
