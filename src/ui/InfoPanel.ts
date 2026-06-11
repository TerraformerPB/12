import { events } from '../core/EventBus';
import { LOCAL_STORE_CAP, RESOURCE_IDS, RESOURCE_INFO } from '../data/config';
import { SOLDIER_TYPE_IDS, getSoldierType } from '../data/soldiers';
import { getDef, type BuildingDefId } from '../data/buildings';
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

  // Staff assignment row (Settlers-style worker allocation).
  const staffRow = document.createElement('div');
  staffRow.className = 'staff-row';
  const staffLabel = document.createElement('span');
  const staffMinus = document.createElement('button');
  staffMinus.textContent = '−';
  staffMinus.className = 'staff-btn';
  const staffPlus = document.createElement('button');
  staffPlus.textContent = '+';
  staffPlus.className = 'staff-btn';
  staffRow.append(staffLabel, staffMinus, staffPlus);

  const upgradeBtn = document.createElement('button');
  const repairBtn = document.createElement('button');

  const demolishBtn = document.createElement('button');
  demolishBtn.className = 'demolish';
  demolishBtn.textContent = 'Abreißen (50% zurück)';

  // One recruit button per soldier type (data-driven).
  const recruitBtns: HTMLButtonElement[] = SOLDIER_TYPE_IDS.map((typeId) => {
    const type = getSoldierType(typeId);
    const costText = RESOURCE_IDS.filter((r) => (type.cost[r] ?? 0) > 0)
      .map((r) => `${RESOURCE_INFO[r].icon} ${type.cost[r]}`)
      .join(' ');
    const btn = document.createElement('button');
    btn.textContent = `${typeId === 'knight' ? '🛡️' : '⚔️'} ${type.name} (${costText})`;
    btn.addEventListener('click', () => {
      if (current) game.recruitSoldier(current.id, typeId);
    });
    return btn;
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'demolish';
  dismissBtn.textContent = 'Entlassen';

  const tradeBtn = document.createElement('button');
  tradeBtn.textContent = '🪙 Handeln';
  tradeBtn.addEventListener('click', () => game.marketPanel?.open());

  buttons.append(closeBtn, ...recruitBtns, dismissBtn, tradeBtn, repairBtn, upgradeBtn, demolishBtn);
  panel.append(title, desc, stats, staffRow, buttons);
  uiRoot.appendChild(panel);

  let current: Building | null = null;
  let currentSoldier: Soldier | null = null;
  let timer = 0;

  demolishBtn.addEventListener('click', () => {
    if (current) game.demolish(current.id);
  });
  staffMinus.addEventListener('click', () => {
    if (current) {
      game.assignWorker(current.id, -1);
      updateStaffRow(current);
    }
  });
  staffPlus.addEventListener('click', () => {
    if (current) {
      game.assignWorker(current.id, 1);
      updateStaffRow(current);
    }
  });
  upgradeBtn.addEventListener('click', () => {
    if (current) game.upgradeBuilding(current.id);
  });
  repairBtn.addEventListener('click', () => {
    if (current) {
      game.repairBuilding(current.id);
      if (current) updateActions(current);
    }
  });

  /** Refresh the action buttons that depend on live building state. */
  const updateActions = (b: Building): void => {
    updateStaffRow(b);
    tradeBtn.hidden = b.defId !== 'market' || b.underConstruction;
    for (const btn of recruitBtns) {
      btn.hidden = b.def.recruitsSoldiers !== true || b.underConstruction;
    }
    if (b.underConstruction) {
      // Sites can only be cancelled; everything else unlocks on completion.
      upgradeBtn.hidden = true;
      repairBtn.hidden = true;
      staffRow.hidden = true;
      return;
    }
    const costLine = (cost: Partial<Record<(typeof RESOURCE_IDS)[number], number>>): string =>
      RESOURCE_IDS.filter((r) => (cost[r] ?? 0) > 0)
        .map((r) => `${RESOURCE_INFO[r].icon} ${cost[r]}`)
        .join(' ');
    const upgradeTarget = b.def.upgradesTo ? getDef(b.def.upgradesTo as BuildingDefId) : null;
    if (upgradeTarget) {
      upgradeBtn.textContent = `Ausbauen: ${upgradeTarget.name} (${costLine(upgradeTarget.cost)})`;
      upgradeBtn.hidden = false;
    } else if (b.level < b.maxLevel) {
      upgradeBtn.textContent = `⭐ Stufe ${b.level + 1} (${costLine(game.levelUpgradeCost(b))})`;
      upgradeBtn.hidden = false;
    } else {
      upgradeBtn.hidden = true;
    }
    if (b.hp < b.maxHp) {
      const repairCost = game.repairCost(b);
      const costText = RESOURCE_IDS.filter((r) => (repairCost[r] ?? 0) > 0)
        .map((r) => `${RESOURCE_INFO[r].icon} ${repairCost[r]}`)
        .join(' ');
      repairBtn.textContent = costText ? `Reparieren (${costText})` : 'Reparieren (gratis)';
      repairBtn.hidden = false;
    } else {
      repairBtn.hidden = true;
    }
  };

  const updateStaffRow = (b: Building): void => {
    if (b.workersRequired === 0) {
      staffRow.hidden = true;
      return;
    }
    staffRow.hidden = false;
    staffLabel.textContent = `👷 Arbeiter: ${b.assignedWorkers}/${b.workersRequired}`;
    staffMinus.disabled = b.assignedWorkers === 0;
    staffPlus.disabled = b.assignedWorkers >= b.workersRequired;
  };
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

    if (b.underConstruction) {
      const missing = RESOURCE_IDS.filter((r) => (b.materialsRemaining[r] ?? 0) > 0)
        .map((r) => `${RESOURCE_INFO[r].icon} ${b.materialsRemaining[r]}`)
        .join(' ');
      if (missing) {
        addRow(`🚧 Wartet auf Material: ${missing}`);
      } else {
        addRow('🚧 Bau läuft …', 1 - b.buildTicks / Math.max(1, b.totalBuildTicks));
      }
      return;
    }
    if (b.hp < b.maxHp) {
      addRow(`❤️ ${b.hp}/${b.maxHp}`, b.hp / b.maxHp);
    }
    const recipe = b.def.recipe;
    if (recipe) {
      const progress = b.durationTicks > 0 ? b.progress / b.durationTicks : 0;
      if (b.productionHalted) {
        addRow('🌲 Kein Wald mehr in Reichweite!');
      } else {
        addRow(b.active ? 'Produziert …' : 'Wartet', b.active ? progress : 0);
      }
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
    title.textContent =
      building.level > 1 ? `${building.def.name} ⭐${building.level}` : building.def.name;
    desc.textContent = building.def.description;
    demolishBtn.hidden = building.def.isWarehouse === true;
    for (const b of recruitBtns) b.hidden = building.def.recruitsSoldiers !== true;
    dismissBtn.hidden = true;
    updateActions(building);
    renderStats(building);
    panel.hidden = false;
    timer = window.setInterval(() => {
      if (current) {
        renderStats(current);
        updateActions(current);
      }
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
    for (const b of recruitBtns) b.hidden = true;
    tradeBtn.hidden = true;
    upgradeBtn.hidden = true;
    repairBtn.hidden = true;
    staffRow.hidden = true;
    dismissBtn.hidden = false;
    panel.hidden = false;
  });
}
