import { events } from '../core/EventBus';
import {
  CARAVAN_BATCH,
  GIFT_GOLD_COST,
  RESOURCE_INFO,
  TRIBUTE_GOLD_COST,
} from '../data/config';
import { FACTION_IDS, bestExport, getFaction, relationStatus } from '../data/factions';
import { nextRank, rankFor } from '../data/ranks';
import type { Game } from '../core/Game';

const REFRESH_MS = 1000;

/**
 * Diplomacy panel of the empire scenario (🤝 in the HUD): neighbour
 * relations, gift/caravan/peace actions and the prestige/rank progress.
 */
export function createDiplomacyPanel(uiRoot: HTMLElement, game: Game): { toggle(): void } {
  const panel = document.createElement('div');
  panel.className = 'stats-panel diplomacy-panel';
  panel.hidden = true;

  const heading = document.createElement('h3');
  heading.textContent = '🤝 Diplomatie & Handel';
  const body = document.createElement('div');
  body.className = 'stats-body';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Schließen';
  closeBtn.addEventListener('click', () => toggle());
  panel.append(heading, body, closeBtn);
  uiRoot.appendChild(panel);

  let timer = 0;

  const render = (): void => {
    body.replaceChildren();

    // Rank / prestige progress.
    const rank = rankFor(game.prestige);
    const next = nextRank(game.prestige);
    const rankRow = document.createElement('div');
    rankRow.className = 'row stats-section';
    rankRow.textContent = next
      ? `${rank.icon} ${rank.name} — ${Math.floor(game.prestige)} / ${next.prestige} Prestige bis ${next.name}`
      : `${rank.icon} ${rank.name} — höchster Rang erreicht!`;
    body.appendChild(rankRow);

    for (const id of FACTION_IDS) {
      const faction = getFaction(id);
      const relation = game.diplomacy.relations[id];
      const atWar = game.diplomacy.atWar(id);

      const title = document.createElement('div');
      title.className = 'row stats-section';
      title.textContent = `${faction.icon} ${faction.name} — ${relationStatus(relation)}`;
      body.appendChild(title);

      const bar = document.createElement('div');
      bar.className = 'relation-bar';
      const fill = document.createElement('div');
      fill.style.width = `${Math.round(relation)}%`;
      fill.className = atWar ? 'war' : relation >= 60 ? 'good' : '';
      bar.appendChild(fill);
      body.appendChild(bar);

      const desc = document.createElement('div');
      desc.className = 'row diplomacy-desc';
      desc.textContent =
        relation >= 75 ? `${faction.description} · 🤝 Bündnis: +15% Preise` : faction.description;
      body.appendChild(desc);

      // Open delivery contract of this faction.
      const contract = game.diplomacy.contractOf(id);
      if (contract) {
        const cRow = document.createElement('div');
        cRow.className = 'row market-row';
        const label = document.createElement('span');
        label.className = 'market-label contract-label';
        label.textContent = `📜 ${contract.amount}×${RESOURCE_INFO[contract.resource].icon} in ${Math.ceil(contract.ticksLeft / 20 / 60)}min`;
        const btn = document.createElement('button');
        btn.textContent = `Liefern (+${contract.reward}🪙)`;
        btn.disabled = game.store.get(contract.resource) < contract.amount;
        btn.addEventListener('click', () => {
          game.diplomacy.fulfillContract(id);
          render();
        });
        cRow.append(label, btn);
        body.appendChild(cRow);
      }

      const row = document.createElement('div');
      row.className = 'row market-row';
      if (atWar) {
        const peaceBtn = document.createElement('button');
        peaceBtn.textContent = `🕊️ Frieden (${TRIBUTE_GOLD_COST}🪙)`;
        peaceBtn.addEventListener('click', () => {
          game.diplomacy.offerPeace(id);
          render();
        });
        row.appendChild(peaceBtn);
      } else {
        const giftBtn = document.createElement('button');
        giftBtn.textContent = `🎁 Geschenk (${GIFT_GOLD_COST}🪙)`;
        giftBtn.disabled = game.store.get('gold') < GIFT_GOLD_COST;
        giftBtn.addEventListener('click', () => {
          game.diplomacy.sendGift(id);
          render();
        });
        // Live price: saturation dampens, alliances boost.
        const ware = bestExport(id);
        const gold = Math.round(CARAVAN_BATCH * game.diplomacy.effectivePrice(id, ware));
        const caravanBtn = document.createElement('button');
        caravanBtn.textContent = `🐪 ${CARAVAN_BATCH}×${RESOURCE_INFO[ware].icon} (+${gold}🪙)`;
        caravanBtn.disabled = game.store.get(ware) < CARAVAN_BATCH;
        caravanBtn.addEventListener('click', () => {
          game.diplomacy.sendCaravan(id, ware);
          render();
        });
        row.append(giftBtn, caravanBtn);
      }
      body.appendChild(row);
    }

    if (game.diplomacy.caravans.length > 0) {
      const title = document.createElement('div');
      title.className = 'row stats-section';
      title.textContent = 'Karawanen unterwegs';
      body.appendChild(title);
      for (const c of game.diplomacy.caravans) {
        const row = document.createElement('div');
        row.className = 'row';
        row.textContent = `🐪 ${c.amount}×${RESOURCE_INFO[c.resource].icon} → ${getFaction(c.factionId).icon} (${Math.ceil(c.ticksLeft / 20)}s)`;
        body.appendChild(row);
      }
    }
  };

  events.on('diplomacy:changed', () => {
    if (!panel.hidden) render();
  });

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
