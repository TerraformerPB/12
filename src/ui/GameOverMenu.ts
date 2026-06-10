import { events } from '../core/EventBus';
import type { Game } from '../core/Game';

/** Fullscreen overlay shown when the warehouse falls. */
export function createGameOverMenu(uiRoot: HTMLElement, game: Game): void {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay';
  overlay.hidden = true;

  const card = document.createElement('div');
  card.className = 'pause-card';

  const heading = document.createElement('h2');
  heading.textContent = '💀 Die Burg ist gefallen';

  const stats = document.createElement('p');
  stats.className = 'gameover-stats';

  const newGameBtn = document.createElement('button');
  newGameBtn.textContent = 'Neues Spiel';
  newGameBtn.addEventListener('click', () => {
    overlay.hidden = true;
    game.restartNewGame();
  });

  card.append(heading, stats, newGameBtn);
  overlay.appendChild(card);
  uiRoot.appendChild(overlay);

  events.on('game:over', ({ wavesSurvived, kills }) => {
    stats.textContent = `Überstandene Wellen: ${wavesSurvived} · Besiegte Gegner: ${kills}`;
    overlay.hidden = false;
  });
}
