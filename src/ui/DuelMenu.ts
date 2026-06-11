import { events } from '../core/EventBus';
import {
  DUEL_AI_LEVELS,
  DUEL_AI_LEVEL_IDS,
  DUEL_BUDGETS,
  DUEL_BUDGET_IDS,
  DUEL_DEPLOY_COSTS,
  DUEL_DEPLOY_ICONS,
  DUEL_DEPLOY_IDS,
  type DuelAiLevelId,
} from '../data/duel';
import { loadDuelRating } from '../core/DuelRating';
import { RESOURCE_IDS, RESOURCE_INFO } from '../data/config';
import { getSoldierType } from '../data/soldiers';
import type { Game } from '../core/Game';

/**
 * Burg-Duell UI: budget selection for the mirrored 1v1, the in-duel HUD
 * (both warehouses' health) and the result screen. Opened from the main
 * or pause menu via the 'duel:openMenu' event.
 */
export function createDuelMenu(uiRoot: HTMLElement, game: Game): void {
  // --- setup dialog ---
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay';
  overlay.hidden = true;

  const card = document.createElement('div');
  card.className = 'pause-card duel-card';

  const heading = document.createElement('h2');
  heading.textContent = '⚔️ Burg-Duell';

  const intro = document.createElement('p');
  intro.className = 'gameover-stats';
  intro.textContent =
    'Gespiegelte Karte, gleiche Burg, gleiches Budget für beide Seiten. ' +
    'Setze Truppen direkt aufs Feld (Karten unten) — bezahlt aus deinem ' +
    'Vorrat. Erobere die Rohstoff-Lager auf dem Schlachtfeld für Nachschub ' +
    'und zerstöre das gegnerische Lagerhaus, bevor deins fällt. ' +
    'Dein Spielstand bleibt unberührt.';

  const ratingLine = document.createElement('div');
  ratingLine.className = 'duel-label';

  // Difficulty selector (trophy stakes scale with it).
  let selectedLevel: DuelAiLevelId = 'normal';
  const levelRow = document.createElement('div');
  levelRow.className = 'market-row';
  const levelBtns = new Map<DuelAiLevelId, HTMLButtonElement>();
  for (const id of DUEL_AI_LEVEL_IDS) {
    const btn = document.createElement('button');
    btn.textContent = `${DUEL_AI_LEVELS[id].name} (+${DUEL_AI_LEVELS[id].trophiesWin}🏆)`;
    btn.classList.toggle('researched', id === selectedLevel);
    btn.addEventListener('click', () => {
      selectedLevel = id;
      for (const [lid, b] of levelBtns) b.classList.toggle('researched', lid === selectedLevel);
    });
    levelRow.appendChild(btn);
    levelBtns.set(id, btn);
  }

  const budgetLabel = document.createElement('div');
  budgetLabel.className = 'duel-label';
  budgetLabel.textContent = 'Rohstoff-Budget wählen:';

  card.append(heading, intro, ratingLine, levelRow, budgetLabel);

  for (const id of DUEL_BUDGET_IDS) {
    const budget = DUEL_BUDGETS[id];
    const btn = document.createElement('button');
    btn.className = 'scenario-btn';
    const name = document.createElement('span');
    name.textContent = `${budget.name} — ${budget.description}`;
    const detail = document.createElement('span');
    detail.className = 'scenario-desc';
    detail.textContent = RESOURCE_IDS.filter(
      (r) => ((budget.resources as Partial<Record<typeof r, number>>)[r] ?? 0) > 0,
    )
      .map((r) => `${RESOURCE_INFO[r].icon} ${(budget.resources as Record<string, number>)[r]}`)
      .join('  ');
    btn.append(name, detail);
    btn.addEventListener('click', () => {
      if (game.startMirrorDuel(id, selectedLevel)) overlay.hidden = true;
    });
    card.appendChild(btn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Schließen';
  closeBtn.addEventListener('click', () => (overlay.hidden = true));
  card.appendChild(closeBtn);

  overlay.appendChild(card);
  uiRoot.appendChild(overlay);

  events.on('duel:openMenu', () => {
    const rating = loadDuelRating();
    ratingLine.textContent =
      rating.wins + rating.losses > 0
        ? `🏆 ${rating.trophies} Pokale · ${rating.wins} Siege / ${rating.losses} Niederlagen · Beste Serie: ${rating.bestStreak}`
        : '🏆 Noch kein Duell gespielt — hol dir die ersten Pokale!';
    overlay.hidden = false;
  });

  // --- in-duel HUD ---
  const hud = document.createElement('div');
  hud.className = 'duel-hud';
  hud.hidden = true;
  const hudText = document.createElement('span');
  const abortBtn = document.createElement('button');
  abortBtn.className = 'tutorial-skip';
  abortBtn.textContent = 'Aufgeben';
  abortBtn.addEventListener('click', () => game.abortDuel());
  hud.append(hudText, abortBtn);
  uiRoot.appendChild(hud);

  events.on('duel:status', ({ ownHp, foeHp, foes }) => {
    hud.hidden = !game.duelMode;
    hudText.textContent = `🏰 Du ${ownHp}% · Gegner ${foeHp}% 🏰 · Feinde im Feld: ${foes}`;
  });

  // --- deployment bar (Clash-style unit cards) ---
  const deploy = document.createElement('div');
  deploy.className = 'duel-deploy';
  deploy.hidden = true;
  const deployCards = new Map<(typeof DUEL_DEPLOY_IDS)[number], HTMLButtonElement>();
  const refreshCards = (): void => {
    for (const [typeId, btn] of deployCards) {
      btn.classList.toggle('selected', game.duelDeployType === typeId);
      btn.classList.toggle('unaffordable', !game.store.canAfford(DUEL_DEPLOY_COSTS[typeId]));
    }
  };
  for (const typeId of DUEL_DEPLOY_IDS) {
    const type = getSoldierType(typeId);
    const cost = DUEL_DEPLOY_COSTS[typeId];
    const btn = document.createElement('button');
    btn.className = 'duel-card-btn';
    const name = document.createElement('span');
    name.textContent = `${DUEL_DEPLOY_ICONS[typeId]} ${type.name}`;
    const costEl = document.createElement('span');
    costEl.className = 'scenario-desc';
    costEl.textContent = RESOURCE_IDS.filter((r) => (cost[r] ?? 0) > 0)
      .map((r) => `${RESOURCE_INFO[r].icon} ${cost[r]}`)
      .join(' ');
    btn.append(name, costEl);
    btn.addEventListener('click', () => {
      game.setDuelDeploy(typeId);
      refreshCards();
    });
    deploy.appendChild(btn);
    deployCards.set(typeId, btn);
  }
  const deployHint = document.createElement('span');
  deployHint.className = 'duel-label';
  deployHint.textContent = 'Karte wählen, dann auf deine Hälfte tippen';
  deploy.appendChild(deployHint);
  uiRoot.appendChild(deploy);

  events.on('duel:status', () => {
    deploy.hidden = !game.duelMode;
    refreshCards();
  });
  events.on('resources:changed', () => {
    if (game.duelMode) refreshCards();
  });

  // --- result ---
  const result = document.createElement('div');
  result.className = 'pause-overlay';
  result.hidden = true;
  const resultCard = document.createElement('div');
  resultCard.className = 'pause-card';
  const resultHeading = document.createElement('h2');
  const resultStats = document.createElement('p');
  resultStats.className = 'gameover-stats';
  const backBtn = document.createElement('button');
  backBtn.textContent = 'Zurück zur Burg';
  backBtn.addEventListener('click', () => (result.hidden = true));
  resultCard.append(resultHeading, resultStats, backBtn);
  result.appendChild(resultCard);
  uiRoot.appendChild(result);

  events.on('duel:ended', ({ victory, unitsLost, buildingsDestroyed, seconds, trophyDelta }) => {
    hud.hidden = true;
    deploy.hidden = true;
    resultHeading.textContent = victory ? '🏆 Burg erobert!' : '💀 Burg verloren';
    const trophies = trophyDelta >= 0 ? `+${trophyDelta}` : `${trophyDelta}`;
    resultStats.textContent =
      `${trophies} 🏆 (gesamt ${loadDuelRating().trophies}) · ` +
      `Feinde besiegt: ${unitsLost} · Gegnerische Gebäude zerstört: ${buildingsDestroyed} · Dauer: ${seconds}s`;
    result.hidden = false;
  });
}
