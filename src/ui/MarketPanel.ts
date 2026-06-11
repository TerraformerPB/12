import { events } from '../core/EventBus';
import { RESOURCE_IDS, RESOURCE_INFO, type ResourceId } from '../data/config';
import {
  BUY_MARKUP,
  SELL_PRICE,
  TRADE_BATCH,
  TRADE_GUILD_BUY_FACTOR,
  TRADE_GUILD_SELL_FACTOR,
} from '../data/market';
import type { Game } from '../core/Game';

const TAX_LABELS = ['Keine', 'Niedrig', 'Mittel', 'Hoch'];

/**
 * Market overlay (opened from a market building): sell/buy goods for gold
 * in batches and set the tax level. Prices reflect the trade guild tech.
 */
export function createMarketPanel(uiRoot: HTMLElement, game: Game): { open(): void } {
  const panel = document.createElement('div');
  panel.className = 'stats-panel market-panel';
  panel.hidden = true;

  const heading = document.createElement('h3');
  heading.textContent = '🪙 Marktplatz';
  const body = document.createElement('div');
  body.className = 'stats-body';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Schließen';
  closeBtn.addEventListener('click', () => close());
  panel.append(heading, body, closeBtn);
  uiRoot.appendChild(panel);

  const tradables = RESOURCE_IDS.filter((r) => (SELL_PRICE[r] ?? 0) > 0);

  const sellPrice = (r: ResourceId): number => {
    const factor = game.techs.has('tradeGuild') ? TRADE_GUILD_SELL_FACTOR : 1;
    return Math.round(TRADE_BATCH * (SELL_PRICE[r] ?? 0) * factor);
  };
  const buyPrice = (r: ResourceId): number => {
    const factor = game.techs.has('tradeGuild') ? TRADE_GUILD_BUY_FACTOR : 1;
    return Math.ceil(TRADE_BATCH * (SELL_PRICE[r] ?? 0) * BUY_MARKUP * factor);
  };

  const render = (): void => {
    body.replaceChildren();

    const gold = document.createElement('div');
    gold.className = 'row stats-section';
    gold.textContent = `🪙 Gold: ${game.store.get('gold')}`;
    body.appendChild(gold);

    for (const r of tradables) {
      const row = document.createElement('div');
      row.className = 'row market-row';
      const label = document.createElement('span');
      label.className = 'market-label';
      label.textContent = `${RESOURCE_INFO[r].icon} ${game.store.get(r)}`;
      const sellBtn = document.createElement('button');
      sellBtn.textContent = `${TRADE_BATCH} verkaufen (+${sellPrice(r)}🪙)`;
      sellBtn.disabled = game.store.get(r) < TRADE_BATCH;
      sellBtn.addEventListener('click', () => game.trade(r, TRADE_BATCH));
      const buyBtn = document.createElement('button');
      buyBtn.textContent = `${TRADE_BATCH} kaufen (−${buyPrice(r)}🪙)`;
      buyBtn.disabled = game.store.get('gold') < buyPrice(r);
      buyBtn.addEventListener('click', () => game.trade(r, -TRADE_BATCH));
      row.append(label, sellBtn, buyBtn);
      body.appendChild(row);
    }

    const taxTitle = document.createElement('div');
    taxTitle.className = 'row stats-section';
    taxTitle.textContent = 'Steuern (Gold gegen Moral)';
    body.appendChild(taxTitle);
    const taxRow = document.createElement('div');
    taxRow.className = 'row market-row';
    TAX_LABELS.forEach((name, level) => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.classList.toggle('researched', game.taxLevel === level);
      btn.addEventListener('click', () => {
        game.setTaxLevel(level);
        render();
      });
      taxRow.appendChild(btn);
    });
    body.appendChild(taxRow);
  };

  const onResources = (): void => {
    if (!panel.hidden) render();
  };
  events.on('resources:changed', onResources);

  const close = (): void => {
    panel.hidden = true;
  };

  return {
    open(): void {
      render();
      panel.hidden = false;
    },
  };
}
