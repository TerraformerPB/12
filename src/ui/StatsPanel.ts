import { CART_CAPACITY, RESOURCE_IDS, RESOURCE_INFO, START_WORKERS, LUXURY_BEER_PER_POP, LUXURY_CLOTH_PER_POP, LUXURY_GOLD_PER_POP_L3 } from '../data/config';
import { getSoldierType } from '../data/soldiers';
import type { Game } from '../core/Game';
import { BUILDING_DEFS, getDef, type BuildingDefId } from '../data/buildings';
import { events } from '../core/EventBus';

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

  let activeTab: 'waren' | 'population' = 'waren';

  const tabContainer = document.createElement('div');
  tabContainer.className = 'stats-tabs';

  const tabWaren = document.createElement('button');
  tabWaren.className = 'tab-btn active';
  tabWaren.textContent = '📦 Waren & Betriebe';
  tabWaren.addEventListener('click', () => {
    activeTab = 'waren';
    tabWaren.classList.add('active');
    tabPop.classList.remove('active');
    render();
  });

  const tabPop = document.createElement('button');
  tabPop.className = 'tab-btn';
  tabPop.textContent = '👥 Bevölkerung';
  tabPop.addEventListener('click', () => {
    activeTab = 'population';
    tabPop.classList.add('active');
    tabWaren.classList.remove('active');
    render();
  });

  tabContainer.append(tabWaren, tabPop);

  const body = document.createElement('div');
  body.className = 'stats-body';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Schließen';
  closeBtn.addEventListener('click', () => toggle());
  panel.append(heading, tabContainer, body, closeBtn);
  uiRoot.appendChild(panel);

  let timer = 0;

  const togglePauseAll = (defId: BuildingDefId) => {
    const buildings = [...game.buildings.values()].filter(b => b.owner === 'player' && b.defId === defId);
    if (buildings.length === 0) return;
    const anyActive = buildings.some(b => !b.userPaused);
    for (const b of buildings) {
      b.userPaused = anyActive;
    }
    game.sound.play('place');
  };

  const adjustWorkersAll = (defId: BuildingDefId, delta: number) => {
    const buildings = [...game.buildings.values()].filter(
      (b) => b.owner === 'player' && b.defId === defId && !b.underConstruction
    );
    if (buildings.length === 0) return;
    if (delta > 0) {
      let assigned = false;
      for (const b of buildings) {
        if (b.assignedWorkers < b.workersRequired) {
          const free = game.freePopulation();
          if (free > 0) {
            game.assignWorker(b.id, 1);
            assigned = true;
            break;
          }
        }
      }
      if (!assigned && game.freePopulation() <= 0) {
        events.emit('toast:show', { message: 'Keine freie Bevölkerung vorhanden!' });
      }
    } else if (delta < 0) {
      for (const b of buildings) {
        if (b.assignedWorkers > 0) {
          game.assignWorker(b.id, -1);
          break;
        }
      }
    }
    game.sound.play('place');
  };

  /** Net production per minute per resource from staffed buildings. */
  const ratePerMinute = (): Partial<Record<(typeof RESOURCE_IDS)[number], number>> => {
    const rates: Partial<Record<(typeof RESOURCE_IDS)[number], number>> = {};
    for (const b of game.buildings.values()) {
      if (b.owner !== 'player') continue;
      const recipe = b.def.recipe;
      if (!recipe || b.productionHalted || b.userPaused) continue;
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
    const row = (text: string, cls = ''): HTMLElement => {
      const div = document.createElement('div');
      div.className = `row ${cls}`;
      div.textContent = text;
      body.appendChild(div);
      return div;
    };

    if (activeTab === 'waren') {
      row('Waren (Bestand · Produktion/min)', 'stats-section');
      const rates = ratePerMinute();
      for (const r of RESOURCE_IDS) {
        const stock = game.store.get(r);
        const rate = rates[r] ?? 0;
        if (stock === 0 && rate === 0) continue;
        const sign = rate > 0 ? '+' : '';
        row(`${RESOURCE_INFO[r].icon} ${RESOURCE_INFO[r].label}: ${stock} · ${sign}${rate.toFixed(1)}/min`);
      }

      row('Betriebe & Produktion', 'stats-section');
      const prodDefIds = Object.keys(BUILDING_DEFS).filter((id) => {
        const def = getDef(id as BuildingDefId);
        return def.recipe !== undefined;
      }) as BuildingDefId[];

      let hasAnyProd = false;
      for (const defId of prodDefIds) {
        const def = getDef(defId);
        const list = [...game.buildings.values()].filter((b) => b.owner === 'player' && b.defId === defId);
        if (list.length === 0) continue;
        hasAnyProd = true;

        const underConstructionCount = list.filter((b) => b.underConstruction).length;
        const pausedCount = list.filter((b) => b.userPaused).length;
        const haltedCount = list.filter((b) => b.productionHalted).length;

        const totalWorkersRequired = list.reduce(
          (sum, b) => sum + (b.underConstruction ? 0 : b.workersRequired),
          0
        );
        const totalWorkersAssigned = list.reduce((sum, b) => sum + b.assignedWorkers, 0);

        const div = document.createElement('div');
        div.className = 'row prod-mgmt-row';

        const label = document.createElement('span');
        label.className = 'prod-mgmt-label';
        label.innerHTML = `<strong>${def.name}</strong> (${list.length} gebaut): 👷 ${totalWorkersAssigned}/${totalWorkersRequired}`;

        let statusStr = '';
        if (pausedCount > 0) statusStr += ` ⏸️ ${pausedCount} pausiert`;
        if (haltedCount > 0) {
          const icon = def.placement === 'adjacentOre' ? '⛏️ erschöpft' : '🌲 kein Wald';
          statusStr += ` ${icon} (${haltedCount})`;
        }
        if (underConstructionCount > 0) statusStr += ` 🚧 ${underConstructionCount} im Bau`;
        if (statusStr) {
          const statusSpan = document.createElement('span');
          statusSpan.className = 'prod-mgmt-status';
          statusSpan.textContent = statusStr;
          label.appendChild(statusSpan);
        }

        const actions = document.createElement('div');
        actions.className = 'prod-mgmt-actions';

        const minusBtn = document.createElement('button');
        minusBtn.textContent = '−';
        minusBtn.className = 'staff-btn mini-btn';
        minusBtn.disabled = totalWorkersAssigned === 0;
        minusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          adjustWorkersAll(defId, -1);
          render();
        });

        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+';
        plusBtn.className = 'staff-btn mini-btn';
        plusBtn.disabled =
          totalWorkersRequired === 0 ||
          totalWorkersAssigned >= totalWorkersRequired ||
          game.freePopulation() <= 0;
        plusBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          adjustWorkersAll(defId, 1);
          render();
        });

        const allPaused = list.every((b) => b.userPaused);
        const pauseBtn = document.createElement('button');
        pauseBtn.textContent = allPaused ? '▶️' : '⏸️';
        pauseBtn.className = 'mini-btn';
        pauseBtn.title = allPaused ? 'Alle starten' : 'Alle pausieren';
        pauseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePauseAll(defId);
          render();
        });

        actions.append(minusBtn, plusBtn, pauseBtn);
        div.append(label, actions);
        body.appendChild(div);
      }
      if (!hasAnyProd) {
        row('Keine Produktionsbetriebe gebaut.');
      }
    } else {
      row('Berufe & Zahlen', 'stats-section');
      let numL1 = 0;
      let numL2 = 0;
      let numL3 = 0;
      for (const b of game.buildings.values()) {
        if (b.owner === 'player' && b.defId === 'hut' && !b.underConstruction) {
          if (b.level === 1) numL1++;
          else if (b.level === 2) numL2++;
          else if (b.level === 3) numL3++;
        }
      }
      const popBauern = START_WORKERS + numL1 * 2;
      const popBuerger = numL2 * 4;
      const popHaendler = numL3 * 6;
      const total = popBauern + popBuerger + popHaendler;

      const assigned = game.economy.assignedTotal();
      const carriers = game.workers.filter((w) => !w.isCart);
      const busy = carriers.filter((w) => w.job !== null).length;

      row(`Gesamtbevölkerung: ${total}`);
      row(`  • 🧑‍🌾 Bauern (Stufe 1): ${popBauern}`);
      row(`  • 🧑‍🏭 Bürger (Stufe 2): ${popBuerger}`);
      row(`  • 🧑‍💼 Händler (Stufe 3): ${popHaendler}`);
      row(`Träger: ${carriers.length} (davon ${busy} unterwegs)`);
      row(`In Betrieben beschäftigt: ${assigned}`);

      const byType = new Map<string, number>();
      for (const s of game.soldiers) byType.set(s.typeId, (byType.get(s.typeId) ?? 0) + 1);
      for (const [typeId, n] of byType) {
        row(`${getSoldierType(typeId as Parameters<typeof getSoldierType>[0]).name}: ${n}`);
      }
      const carts = game.workers.filter((w) => w.isCart).length;
      if (carts > 0) row(`Ochsenkarren: ${carts} (je ${CART_CAPACITY} Waren)`);

      row('Bedarfsdeckung', 'stats-section');
      const check = (satisfied: boolean) => satisfied ? '<span style="color:#2ecc71">✔</span>' : '<span style="color:#e74c3c">✘</span>';

      const bauernDiv = document.createElement('div');
      bauernDiv.className = 'needs-group';
      const breadStock = game.store.get('bread');
      const fishStock = game.store.get('fish');
      bauernDiv.innerHTML = `
        <div class="needs-class-title">🧑‍🌾 Bauern (Klasse I)</div>
        <ul class="needs-list">
          <li>${check(breadStock > 0)} Brot (${breadStock} auf Lager)</li>
          <li>${check(fishStock > 0)} Fisch (${fishStock} auf Lager)</li>
        </ul>
      `;
      body.appendChild(bauernDiv);

      if (popBuerger > 0 || game.empireMode) {
        const buergerDiv = document.createElement('div');
        buergerDiv.className = 'needs-group';
        const beerStock = game.store.get('beer');
        const clothStock = game.store.get('cloth');
        const needB = Math.ceil(popBuerger * LUXURY_BEER_PER_POP);
        const needC = Math.ceil(popBuerger * LUXURY_CLOTH_PER_POP);
        buergerDiv.innerHTML = `
          <div class="needs-class-title">🧑‍🏭 Bürger (Klasse II)</div>
          <ul class="needs-list">
            <li>${check(breadStock > 0)} Brot (${breadStock} auf Lager)</li>
            <li>${check(fishStock > 0)} Fisch (${fishStock} auf Lager)</li>
            <li>${check(beerStock >= needB)} Luxus: Bier (${beerStock}/${needB} auf Lager)</li>
            <li>${check(clothStock >= needC)} Luxus: Kleidung (${clothStock}/${needC} auf Lager)</li>
          </ul>
        `;
        body.appendChild(buergerDiv);
      }

      if (popHaendler > 0 || game.empireMode) {
        const haendlerDiv = document.createElement('div');
        haendlerDiv.className = 'needs-group';
        const beerStock = game.store.get('beer');
        const clothStock = game.store.get('cloth');
        const goldStock = game.store.get('gold');
        const needB = Math.ceil(popHaendler * LUXURY_BEER_PER_POP);
        const needC = Math.ceil(popHaendler * LUXURY_CLOTH_PER_POP);
        const needG = Math.ceil(popHaendler * LUXURY_GOLD_PER_POP_L3);
        haendlerDiv.innerHTML = `
          <div class="needs-class-title">🧑‍💼 Händler (Klasse III)</div>
          <ul class="needs-list">
            <li>${check(breadStock > 0)} Brot (${breadStock} auf Lager)</li>
            <li>${check(fishStock > 0)} Fisch (${fishStock} auf Lager)</li>
            <li>${check(beerStock >= needB)} Luxus: Bier (${beerStock}/${needB} auf Lager)</li>
            <li>${check(clothStock >= needC)} Luxus: Kleidung (${clothStock}/${needC} auf Lager)</li>
            <li>${check(goldStock >= needG)} Luxus: Gold (${goldStock}/${needG} auf Lager)</li>
          </ul>
        `;
        body.appendChild(haendlerDiv);
      }

      row('Infrastruktur', 'stats-section');
      const counts = new Map<string, number>();
      for (const b of game.buildings.values()) {
        if (b.owner !== 'player') continue;
        if (b.def.recipe !== undefined) continue;
        counts.set(b.def.name, (counts.get(b.def.name) ?? 0) + 1);
      }
      if (counts.size > 0) {
        row([...counts.entries()].map(([name, n]) => `${n}× ${name}`).join(' · '));
      } else {
        row('Keine Infrastruktur- oder Militärgebäude.');
      }
    }
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
