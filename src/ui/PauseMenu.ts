import { events } from '../core/EventBus';
import type { Game } from '../core/Game';

/** Fullscreen pause overlay with resume and "new game" (two-tap confirm). */
export function createPauseMenu(uiRoot: HTMLElement, game: Game): void {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay';
  overlay.hidden = true;

  const card = document.createElement('div');
  card.className = 'pause-card';

  const heading = document.createElement('h2');
  heading.textContent = 'Pause';

  const resumeBtn = document.createElement('button');
  resumeBtn.textContent = 'Weiterspielen';
  resumeBtn.addEventListener('click', () => game.setPhase('playing'));

  const duelBtn = document.createElement('button');
  duelBtn.textContent = '⚔️ Burg-Duell';
  duelBtn.addEventListener('click', () => {
    events.emit('duel:openMenu', undefined);
    overlay.hidden = true;
    game.setPhase('playing');
  });

  const soundBtn = document.createElement('button');
  const soundLabel = (): string => (game.sound.isMuted() ? '🔇 Ton: aus' : '🔊 Ton: an');
  soundBtn.textContent = soundLabel();
  soundBtn.addEventListener('click', () => {
    game.sound.setMuted(!game.sound.isMuted());
    soundBtn.textContent = soundLabel();
  });

  const menuBtn = document.createElement('button');
  menuBtn.textContent = '🏰 Hauptmenü';
  menuBtn.addEventListener('click', () => game.setPhase('menu'));

  const newGameBtn = document.createElement('button');
  newGameBtn.className = 'danger';
  const NEW_GAME_LABEL = 'Neues Spiel';
  newGameBtn.textContent = NEW_GAME_LABEL;
  let confirming = false;
  newGameBtn.addEventListener('click', () => {
    if (!confirming) {
      confirming = true;
      newGameBtn.textContent = 'Sicher? Spielstand wird gelöscht!';
      return;
    }
    game.restartNewGame();
  });

  card.append(heading, resumeBtn, duelBtn, soundBtn, menuBtn, newGameBtn);
  overlay.appendChild(card);
  uiRoot.appendChild(overlay);

  events.on('game:phaseChanged', ({ phase }) => {
    overlay.hidden = phase !== 'paused';
    confirming = false;
    newGameBtn.textContent = NEW_GAME_LABEL;
  });
}
