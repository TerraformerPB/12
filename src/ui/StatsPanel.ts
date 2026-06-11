import { CART_CAPACITY, RESOURCE_IDS, RESOURCE_INFO } from '../data/config';
import { getSoldierType } from '../data/soldiers';
import type { Game } from '../core/Game';

const REFRESH_MS = 1000;

/**
 * Economy overview (quick-access 📊 button): stock + estimated net
 * production per minute, population breakdown and unit counts.
 */
export function createStatsPanel(uiRoot: HTMLElement, game: Game): { toggle(): void } {
  const panel = document.createElement('div');
  panel.className = 'stats-panel';
  panel.hidden = true;

  const heading = document.createElement('h3');
  heading.textContent = '📊 Übersicht';
  const body = document.createElement('div');
  body.className = 'stats-body';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Schließen';
  closeBtn.addEventListener('click', () => toggle());
  panel.append(heading, body, closeBtn);
  uiRoot.appendChild(panel);

  let timer = 0;

  /** Net production per minute per resource from staffed buildings. */
  const ratePerMinute = (): Partial<Record<(typeof RESOURCE_IDS)[number], number>> => {
    const rates: Partial<Record<(typeof RESOURCE_IDS)[number], number>> = {};
    for (const b of game.buildings.values()) {
      if (b.owner !== 'player') continue;
      const recipe = b.def.recipe;
      if (!recipe || b.productionHalted) continue;
      const speed = b.staffingFactor * b.levelFactor;
      if (speed <= 0) continue;
      const perMin = (60 / recipe.duration) * speed;
      rates[recipe.output] = (rates[recipe.output] ?? 0) + perMin;
      if (recipe.input) rates[recipe.input] = (rates[recipe.input] ?? 0) - perMin;
    }
    return rates;
  };

  const render = (): void => {
    body.replaceChildren();
    const row = (text: string, cls = ''): void => {
      const div = document.createElement('div');
      div.className = `row ${cls}`;
      div.textContent = text;
      body.appendChild(div);
    };

    row('Waren (Bestand · Produktion/min)', 'stats-section');
    const rates = ratePerMinute();
    for (const r of RESOURCE_IDS) {
      const stock = game.store.get(r);
      const rate = rates[r] ?? 0;
      if (stock === 0 && rate === 0) continue;
      const sign = rate > 0 ? '+' : '';
      row(`${RESOURCE_INFO[r].icon} ${RESOURCE_INFO[r].label}: ${stock} · ${sign}${rate.toFixed(1)}/min`);
    }

    row('Bevölkerung', 'stats-section');
    const total = game.economy.populationTotal();
    const assigned = game.economy.assignedTotal();
    const carriers = game.workers.filter((w) => !w.isCart);
    const busy = carriers.filter((w) => w.job !== null).length;
    row(`Gesamt: ${total}`);
    row(`Träger: ${carriers.length} (davon ${busy} unterwegs)`);
    row(`In Betrieben: ${assigned}`);
    const byType = new Map<string, number>();
    for (const s of game.soldiers) byType.set(s.typeId, (byType.get(s.typeId) ?? 0) + 1);
    for (const [typeId, n] of byType) {
      row(`${getSoldierType(typeId as Parameters<typeof getSoldierType>[0]).name}: ${n}`);
    }
    const carts = game.workers.filter((w) => w.isCart).length;
    if (carts > 0) row(`Ochsenkarren: ${carts} (je ${CART_CAPACITY} Waren)`);

    row('Anlage', 'stats-section');
    const counts = new Map<string, number>();
    for (const b of game.buildings.values()) {
      if (b.owner !== 'player') continue;
      counts.set(b.def.name, (counts.get(b.def.name) ?? 0) + 1);
    }
    row([...counts.entries()].map(([name, n]) => `${n}× ${name}`).join(' · '));
  };

  const toggle = (): void => {
    panel.hidden = !panel.hidden;
    window.clearInterval(timer);
    if (!panel.hidden) {
      render();
      timer = window.setInterval(render, REFRESH_MS);
    }
  };
  return { toggle };
}
