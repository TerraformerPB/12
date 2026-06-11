import { events } from '../core/EventBus';
import type { Game } from '../core/Game';

/** Slim goal banner below the HUD; hidden once all steps are done. */
export function createTutorialBanner(uiRoot: HTMLElement, game: Game): void {
  const banner = document.createElement('div');
  banner.className = 'tutorial-banner';
  banner.hidden = true;

  const icon = document.createElement('span');
  icon.textContent = '🎯';
  const text = document.createElement('span');
  text.className = 'tutorial-text';

  const skip = document.createElement('button');
  skip.className = 'tutorial-skip';
  skip.textContent = '✕';
  skip.title = 'Tutorial überspringen';
  skip.addEventListener('click', () => game.skipTutorial());

  banner.append(icon, text, skip);
  uiRoot.appendChild(banner);

  events.on('tutorial:changed', ({ text: stepText }) => {
    if (stepText === null) {
      banner.hidden = true;
      return;
    }
    text.textContent = stepText;
    banner.hidden = false;
  });
}
