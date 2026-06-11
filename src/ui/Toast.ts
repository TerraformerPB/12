import { events } from '../core/EventBus';

const TOAST_DURATION_MS = 2000;

/** Short feedback messages ("Nicht genug Holz"), one at a time. */
export function createToast(uiRoot: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'toast';
  uiRoot.appendChild(el);

  let hideTimer = 0;
  events.on('toast:show', ({ message }) => {
    el.textContent = message;
    el.classList.add('visible');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => el.classList.remove('visible'), TOAST_DURATION_MS);
  });
}
