import { events } from '../core/EventBus';
import { loadScores } from '../core/Highscores';
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

  const scoreList = document.createElement('ol');
  scoreList.className = 'score-list';

  const reviveBtn = document.createElement('button');
  reviveBtn.textContent = '📺 Weiterspielen (Werbung)';
  reviveBtn.addEventListener('click', async () => {
    overlay.hidden = true;
    const revived = await game.reviveViaAd();
    if (!revived) overlay.hidden = false;
  });

  const newGameBtn = document.createElement('button');
  newGameBtn.textContent = 'Neues Spiel';
  newGameBtn.addEventListener('click', () => {
    overlay.hidden = true;
    game.restartNewGame();
  });

  const continueBtn = document.createElement('button');
  continueBtn.textContent = 'Weiterspielen';
  continueBtn.addEventListener('click', () => {
    overlay.hidden = true;
    game.continueEndlessAfterVictory();
  });

  card.append(heading, stats, scoreList, reviveBtn, continueBtn, newGameBtn);
  overlay.appendChild(card);
  uiRoot.appendChild(overlay);

  const renderScores = (): void => {
    scoreList.replaceChildren();
    for (const s of loadScores()) {
      const li = document.createElement('li');
      li.textContent = `${s.waves} Wellen · ${s.kills} Gegner (${s.date})`;
      scoreList.appendChild(li);
    }
  };

  events.on('game:over', ({ wavesSurvived, kills }) => {
    heading.textContent = '💀 Die Burg ist gefallen';
    stats.textContent = `Überstandene Wellen: ${wavesSurvived} · Besiegte Gegner: ${kills}`;
    renderScores();
    reviveBtn.hidden = !game.canRevive();
    continueBtn.hidden = true;
    overlay.hidden = false;
  });

  events.on('game:victory', ({ scenario, kills }) => {
    heading.textContent = '🏆 Sieg!';
    stats.textContent = `Szenario „${scenario}“ geschafft · Besiegte Gegner: ${kills}`;
    renderScores();
    reviveBtn.hidden = true;
    continueBtn.hidden = false;
    overlay.hidden = false;
  });
}
