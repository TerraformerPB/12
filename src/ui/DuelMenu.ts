import { events } from '../core/EventBus';
import { armySummary, computeArmy } from '../data/duel';
import { ENEMY_DEFS, type EnemyDefId } from '../data/enemies';
import type { Game } from '../core/Game';

const ENEMY_NAMES = Object.fromEntries(
  Object.values(ENEMY_DEFS).map((d) => [d.id, d.name]),
) as Record<EnemyDefId, string>;

/**
 * Burg-Duell UI: share/import castle codes, the in-duel HUD and the
 * result screen. Opened from the pause menu via the 'duel:openMenu' event.
 */
export function createDuelMenu(uiRoot: HTMLElement, game: Game): void {
  // --- dialog ---
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
    'Tausche Burg-Codes mit anderen Spielern. Deine Vorräte (Brot, Waffen, Fisch) und Soldaten bestimmen deine Angriffsarmee.';

  const ownLabel = document.createElement('div');
  ownLabel.className = 'duel-label';
  ownLabel.textContent = 'Dein Burg-Code (teilen):';
  const ownCode = document.createElement('textarea');
  ownCode.className = 'duel-code';
  ownCode.readOnly = true;
  ownCode.rows = 3;
  const copyBtn = document.createElement('button');
  copyBtn.textContent = '📋 Code kopieren';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ownCode.value);
      copyBtn.textContent = '✓ Kopiert!';
    } catch {
      ownCode.select();
      copyBtn.textContent = 'Manuell kopieren (markiert)';
    }
    window.setTimeout(() => (copyBtn.textContent = '📋 Code kopieren'), 1500);
  });

  const armyInfo = document.createElement('div');
  armyInfo.className = 'duel-label duel-army';

  const inLabel = document.createElement('div');
  inLabel.className = 'duel-label';
  inLabel.textContent = 'Gegnerischen Code einfügen:';
  const inCode = document.createElement('textarea');
  inCode.className = 'duel-code';
  inCode.rows = 3;
  inCode.placeholder = 'BURG1.…';

  const attackBtn = document.createElement('button');
  attackBtn.textContent = '⚔️ Angreifen!';
  attackBtn.addEventListener('click', () => {
    if (game.startDuel(inCode.value)) {
      overlay.hidden = true;
      inCode.value = '';
    }
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Schließen';
  closeBtn.addEventListener('click', () => (overlay.hidden = true));

  card.append(heading, intro, ownLabel, ownCode, copyBtn, armyInfo, inLabel, inCode, attackBtn, closeBtn);
  overlay.appendChild(card);
  uiRoot.appendChild(overlay);

  events.on('duel:openMenu', () => {
    ownCode.value = game.exportCastleCode();
    const army = computeArmy(game.store.snapshot(), game.soldiers.length);
    armyInfo.textContent =
      army.length > 0
        ? `Deine Armee: ${armySummary(army, ENEMY_NAMES)}`
        : 'Deine Armee: zu wenig Vorräte — sammle Brot, Waffen oder Fisch!';
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

  events.on('duel:status', ({ queued, alive }) => {
    hud.hidden = !game.duelMode;
    hudText.textContent =
      queued > 0
        ? `⚔️ Reserve: ${queued} · Im Feld: ${alive} — Kartenrand antippen!`
        : `⚔️ Im Feld: ${alive}`;
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

  events.on('duel:ended', ({ victory, unitsLost, buildingsDestroyed, seconds }) => {
    hud.hidden = true;
    resultHeading.textContent = victory ? '🏆 Burg erobert!' : '🛡️ Angriff abgewehrt';
    resultStats.textContent = `Gebäude zerstört: ${buildingsDestroyed} · Verlorene Truppen: ${unitsLost} · Dauer: ${seconds}s`;
    result.hidden = false;
  });
}
