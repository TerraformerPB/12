import { events } from '../core/EventBus';
import { RESOURCE_IDS, RESOURCE_INFO, TAX_GOLD_PER_POP, LUXURY_BEER_PER_POP, LUXURY_CLOTH_PER_POP, LUXURY_GOLD_PER_POP_L3 } from '../data/config';
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
  const pauseBtn = document.createElement('button');

  const demolishBtn = document.createElement('button');
  demolishBtn.className = 'demolish';
  demolishBtn.textContent = 'Abreißen (50% zurück)';

  // One recruit button per soldier type (data-driven; duel cards excluded).
  const recruitBtns: HTMLButtonElement[] = SOLDIER_TYPE_IDS.filter(
    (typeId) => getSoldierType(typeId).duelOnly !== true,
  ).map((typeId) => {
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

  buttons.append(closeBtn, ...recruitBtns, dismissBtn, tradeBtn, pauseBtn, repairBtn, upgradeBtn, demolishBtn);
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
  pauseBtn.addEventListener('click', () => {
    if (current && current.def.recipe) {
      current.userPaused = !current.userPaused;
      updateActions(current);
      renderStats(current);
    }
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
    pauseBtn.hidden = !b.def.recipe || b.underConstruction;
    if (!pauseBtn.hidden) {
      pauseBtn.textContent = b.userPaused ? '▶️ Fortsetzen' : '⏸️ Pausieren';
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
      // Net cost: the demolition refund of the old building is deducted.
      const cost = costLine(game.defUpgradeCost(b));
      upgradeBtn.textContent = `Ausbauen: ${upgradeTarget.name} (${cost || 'Gratis'})`;
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

  const getHouseTaxPerMin = (b: Building): { potential: number; actual: number } => {
    const intervalsPerMin = 60 / 15; // 4
    const pop = b.populationBonus;
    const taxLevel = game.taxLevel;
    if (taxLevel === 0) return { potential: 0, actual: 0 };
    
    const classMult = b.level === 1 ? 1.0 : b.level === 2 ? 2.0 : 5.0;
    const baseTaxPerInterval = pop * TAX_GOLD_PER_POP * classMult * taxLevel;
    const potential = baseTaxPerInterval * intervalsPerMin;
    
    if (!game.empireMode) {
      return { potential, actual: potential };
    }
    
    let actualMult = 1.0;
    
    let numL2 = 0;
    let numL3 = 0;
    for (const ob of game.buildings.values()) {
      if (ob.owner === 'player' && ob.defId === 'hut' && !ob.underConstruction) {
        if (ob.level === 2) numL2++;
        else if (ob.level === 3) numL3++;
      }
    }
    const popBuerger = numL2 * 4;
    const popHaendler = numL3 * 6;
    
    const beerStock = game.store.get('beer');
    const clothStock = game.store.get('cloth');
    const goldStock = game.store.get('gold');
    
    if (b.level === 2) {
      const needB = Math.ceil(popBuerger * LUXURY_BEER_PER_POP);
      const needC = Math.ceil(popBuerger * LUXURY_CLOTH_PER_POP);
      if (beerStock < needB) actualMult *= 0.5;
      if (clothStock < needC) actualMult *= 0.5;
    } else if (b.level === 3) {
      const needB = Math.ceil(popHaendler * LUXURY_BEER_PER_POP);
      const needC = Math.ceil(popHaendler * LUXURY_CLOTH_PER_POP);
      const needG = Math.ceil(popHaendler * LUXURY_GOLD_PER_POP_L3);
      if (beerStock < needB) actualMult *= 0.5;
      if (clothStock < needC) actualMult *= 0.5;
      if (goldStock < needG) actualMult *= 0.25;
    }
    
    return {
      potential,
      actual: baseTaxPerInterval * actualMult * intervalsPerMin
    };
  };

  const renderStats = (b: Building): void => {
    stats.replaceChildren();
    const addRow = (text: string, progress?: number): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'row';
      const span = document.createElement('span');
      span.innerHTML = text;
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
      return row;
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
      addRow(`❤️ Trefferpunkte: ${b.hp}/${b.maxHp}`, b.hp / b.maxHp);
    }
    const recipe = b.def.recipe;
    if (recipe) {
      const inputIcon = recipe.input ? `${RESOURCE_INFO[recipe.input].icon} ` : '';
      const inputLabel = recipe.input ? `${RESOURCE_INFO[recipe.input].label}` : '';
      const outputIcon = RESOURCE_INFO[recipe.output].icon;
      const outputLabel = RESOURCE_INFO[recipe.output].label;
      const recipeStr = recipe.input
        ? `<strong>Rezept:</strong> 1x ${inputIcon}${inputLabel} ➔ 1x ${outputIcon} ${outputLabel}`
        : `<strong>Rezept:</strong> ➔ 1x ${outputIcon} ${outputLabel}`;
      addRow(recipeStr);
      addRow(`<strong>Zyklusdauer:</strong> ${recipe.duration} Sekunden`);

      const staffEff = Math.round(b.staffingFactor * 100);
      const totalEff = Math.round(b.staffingFactor * b.levelFactor * 100);
      addRow(`<strong>Auslastung (Personal):</strong> ${staffEff}%`);
      addRow(`<strong>Gesamt-Produktivität:</strong> ${totalEff}%`);

      const progress = b.durationTicks > 0 ? b.progress / b.durationTicks : 0;
      if (b.userPaused) {
        addRow('⏸️ Produktion pausiert');
      } else if (b.productionHalted) {
        addRow(
          b.def.placement === 'adjacentOre'
            ? '⛏️ Erzader erschöpft — keine Ader in Reichweite!'
            : '🌲 Kein Wald mehr in Reichweite!',
        );
      } else {
        addRow(b.active ? 'Status: Produziert …' : 'Status: Wartet auf Material', b.active ? progress : 0);
      }
      if (recipe.input) {
        addRow(
          `${RESOURCE_INFO[recipe.input].icon} Eingangslager: ${b.inputStore}/${b.localCap}`,
        );
      }
      addRow(
        `${RESOURCE_INFO[recipe.output].icon} Ausgangslager: ${b.outputStore}/${b.localCap}`,
      );
    }
    if (b.defId === 'hut') {
      const className = b.level === 1 ? 'Bauern' : b.level === 2 ? 'Bürger' : 'Händler';
      addRow(`👥 Klasse: ${className} (Träger: +${b.populationBonus})`);
      addRow(`🎭 Lokale Moral: ${Math.round(game.morale)}%`);

      const taxInfo = getHouseTaxPerMin(b);
      addRow(`🪙 Steuereinnahmen: ${taxInfo.actual.toFixed(1)}/Min <small style="opacity: 0.7">(Potenzial: ${taxInfo.potential.toFixed(1)}/Min)</small>`);

      if (game.empireMode) {
        const check = (satisfied: boolean) => satisfied ? '<span style="color:#2ecc71">✔</span>' : '<span style="color:#e74c3c">✘</span>';
        
        let numL2 = 0;
        let numL3 = 0;
        for (const ob of game.buildings.values()) {
          if (ob.owner === 'player' && ob.defId === 'hut' && !ob.underConstruction) {
            if (ob.level === 2) numL2++;
            else if (ob.level === 3) numL3++;
          }
        }
        const popBuerger = numL2 * 4;
        const popHaendler = numL3 * 6;

        const breadStock = game.store.get('bread');
        const fishStock = game.store.get('fish');
        const beerStock = game.store.get('beer');
        const clothStock = game.store.get('cloth');
        const goldStock = game.store.get('gold');

        const needB_L2 = Math.ceil(popBuerger * LUXURY_BEER_PER_POP);
        const needC_L2 = Math.ceil(popBuerger * LUXURY_CLOTH_PER_POP);
        const needB_L3 = Math.ceil(popHaendler * LUXURY_BEER_PER_POP);
        const needC_L3 = Math.ceil(popHaendler * LUXURY_CLOTH_PER_POP);
        const needG_L3 = Math.ceil(popHaendler * LUXURY_GOLD_PER_POP_L3);

        let needsHTML = `<div class="needs-checklist-title">📋 Bedürfnis-Checkliste:</div><ul class="needs-list select-needs">`;
        needsHTML += `<li>${check(breadStock > 0)} Brot (Nahrung)</li>`;
        needsHTML += `<li>${check(fishStock > 0)} Fisch (Nahrung)</li>`;
        
        if (b.level === 2) {
          needsHTML += `<li>${check(beerStock >= needB_L2)} Bier (${beerStock}/${needB_L2} auf Lager)</li>`;
          needsHTML += `<li>${check(clothStock >= needC_L2)} Kleidung (${clothStock}/${needC_L2} auf Lager)</li>`;
        } else if (b.level === 3) {
          needsHTML += `<li>${check(beerStock >= needB_L3)} Bier (${beerStock}/${needB_L3} auf Lager)</li>`;
          needsHTML += `<li>${check(clothStock >= needC_L3)} Kleidung (${clothStock}/${needC_L3} auf Lager)</li>`;
          needsHTML += `<li>${check(goldStock >= needG_L3)} Gold (${goldStock}/${needG_L3} auf Lager)</li>`;
        }
        needsHTML += `</ul>`;
        
        const row = document.createElement('div');
        row.className = 'needs-checklist-container';
        row.innerHTML = needsHTML;
        stats.appendChild(row);
      } else {
        addRow('📋 Alle Bedürfnisse erfüllt (nur im Wirtschaftsmodus aktiv)');
      }
    } else if (b.def.population) {
      addRow(`👷 +${b.populationBonus} Bevölkerung`);
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
    let name = building.def.name;
    if (building.defId === 'hut') {
      name = building.level === 1 ? 'Bauernhaus' : building.level === 2 ? 'Bürgerhaus' : 'Händlerhaus';
    }
    title.textContent =
      building.level > 1 ? `${name} ⭐${building.level}` : name;
    desc.textContent = building.def.description;
    demolishBtn.hidden = building.defId === 'warehouse' || building.defId === 'keep';
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
