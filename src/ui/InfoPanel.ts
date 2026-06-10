import { events } from '../core/EventBus';
import {
  LOCAL_STORE_CAP,
  RESOURCE_IDS,
  RESOURCE_INFO,
  SOLDIER_RECRUIT_COST,
} from '../data/config';
import type { Building } from '../entities/Building';
import type { Soldier } from '../entities/Soldier';
import type { Game } from '../core/Game';

const REFRESH_MS = 250;

/**
 * Info panel for the selected building: production status, local stores
 * and the demolish action (50% refund). Refreshes periodically while open.
 */
export function createInfoPanel(uiRoot: HTMLElement, game: Game): void {
  const panel = document.createElement('div');
  panel.className = 'info-panel';
  panel.hidden = true;

  const title = document.createElement('h3');
  const desc = document.createElement('p');
  desc.className = 'desc';
  const stats = document.createElement('div');
  stats.className = 'stats';

  const buttons = document.createElement('div');
  buttons.className = 'buttons';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Schließen';
  closeBtn.addEventListener('click', () => game.select(null));

  const demolishBtn = document.createElement('button');
  demolishBtn.className = 'demolish';
  demolishBtn.textContent = 'Abreißen (50% zurück)';

  const recruitCostText = RESOURCE_IDS.filter((r) => (SOLDIER_RECRUIT_COST[r] ?? 0) > 0)
    .map((r) => `${RESOURCE_INFO[r].icon} ${SOLDIER_RECRUIT_COST[r]}`)
    .join('  ');
  const recruitBtn = document.createElement('button');
  recruitBtn.textContent = `Soldat rekrutieren (${recruitCostText})`;

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'demolish';
  dismissBtn.textContent = 'Entlassen';

  buttons.append(closeBtn, recruitBtn, dismissBtn, demolishBtn);
  panel.append(title, desc, stats, buttons);
  uiRoot.appendChild(panel);

  let current: Building | null = null;
  let currentSoldier: Soldier | null = null;
  let timer = 0;

  demolishBtn.addEventListener('click', () => {
    if (current) game.demolish(current.id);
  });
  recruitBtn.addEventListener('click', () => {
    if (current) game.recruitSoldier(current.id);
  });
  dismissBtn.addEventListener('click', () => {
    if (currentSoldier) game.dismissSoldier(currentSoldier.id);
  });

  const renderStats = (b: Building): void => {
    stats.replaceChildren();
    const addRow = (text: string, progress?: number): void => {
      const row = document.createElement('div');
      row.className = 'row';
      const span = document.createElement('span');
      span.textContent = text;
      row.appendChild(span);
      if (progress !== undefined) {
        const bar = document.createElement('div');
        bar.className = 'progress';
        const fill = document.createElement('div');
        fill.style.width = `${Math.round(progress * 100)}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
      }
      stats.appendChild(row);
    };

    const recipe = b.def.recipe;
    if (recipe) {
      const progress = b.durationTicks > 0 ? b.progress / b.durationTicks : 0;
      addRow(b.active ? 'Produziert …' : 'Wartet', b.active ? progress : 0);
      if (recipe.input) {
        addRow(
          `${RESOURCE_INFO[recipe.input].icon} Eingang: ${b.inputStore}/${LOCAL_STORE_CAP}`,
        );
      }
      addRow(
        `${RESOURCE_INFO[recipe.output].icon} Ausgang: ${b.outputStore}/${LOCAL_STORE_CAP}`,
      );
    }
    if (b.def.population) {
      addRow(`👷 +${b.def.population} Bevölkerung`);
    }
    if (b.def.isWarehouse) {
      addRow('Hier lagern alle Waren.');
    }
  };

  const stopTimer = (): void => {
    if (timer !== 0) {
      window.clearInterval(timer);
      timer = 0;
    }
  };

  events.on('building:selected', ({ building }) => {
    current = building;
    stopTimer();
    if (!building) {
      if (!currentSoldier) panel.hidden = true;
      return;
    }
    currentSoldier = null;
    title.textContent = building.def.name;
    desc.textContent = building.def.description;
    demolishBtn.hidden = building.def.isWarehouse === true;
    recruitBtn.hidden = building.def.recruitsSoldiers !== true;
    dismissBtn.hidden = true;
    renderStats(building);
    panel.hidden = false;
    timer = window.setInterval(() => {
      if (current) renderStats(current);
    }, REFRESH_MS);
  });

  events.on('soldier:selected', ({ soldier }) => {
    currentSoldier = soldier;
    if (!soldier) {
      if (!current) panel.hidden = true;
      return;
    }
    current = null;
    stopTimer();
    title.textContent = 'Soldat';
    desc.textContent = 'Tippe auf eine freie Stelle der Karte, um ihn dorthin zu schicken.';
    stats.replaceChildren();
    demolishBtn.hidden = true;
    recruitBtn.hidden = true;
    dismissBtn.hidden = false;
    panel.hidden = false;
  });
}
