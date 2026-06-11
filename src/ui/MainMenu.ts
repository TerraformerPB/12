import { events } from '../core/EventBus';
import { loadScores } from '../core/Highscores';
import type { Game } from '../core/Game';

/** Title screen shown at boot (phase 'menu'). */
export function createMainMenu(uiRoot: HTMLElement, game: Game): void {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay main-menu';
  overlay.hidden = true;

  const card = document.createElement('div');
  card.className = 'pause-card';

  const title = document.createElement('h1');
  title.className = 'main-title';
  title.textContent = '🏰 Burgspiel';
  const subtitle = document.createElement('p');
  subtitle.className = 'gameover-stats';
  subtitle.textContent = 'Wirtschaft aufbauen · Burg verteidigen · Duelle gewinnen';

  const continueBtn = document.createElement('button');
  continueBtn.textContent = '▶ Weiterspielen';
  continueBtn.addEventListener('click', () => game.setPhase('playing'));

  const newBtn = document.createElement('button');
  newBtn.textContent = 'Neues Spiel';
  let confirming = false;
  newBtn.addEventListener('click', () => {
    if (game.hasProgress() && !confirming) {
      confirming = true;
      newBtn.textContent = 'Sicher? Spielstand wird gelöscht!';
      return;
    }
    game.restartNewGame();
  });

  const duelBtn = document.createElement('button');
  duelBtn.textContent = '⚔️ Burg-Duell';
  duelBtn.addEventListener('click', () => {
    game.setPhase('playing');
    events.emit('duel:openMenu', undefined);
  });

  const scores = document.createElement('div');
  scores.className = 'duel-label';

  card.append(title, subtitle, continueBtn, newBtn, duelBtn, scores);
  overlay.appendChild(card);
  uiRoot.appendChild(overlay);

  events.on('game:phaseChanged', ({ phase }) => {
    overlay.hidden = phase !== 'menu';
    if (phase === 'menu') {
      confirming = false;
      newBtn.textContent = 'Neues Spiel';
      const best = loadScores()[0];
      scores.textContent = best
        ? `Bester Lauf: ${best.waves} Wellen · ${best.kills} Gegner`
        : '';
    }
  });
}
