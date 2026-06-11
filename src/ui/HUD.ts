import { events } from '../core/EventBus';
import { RESOURCE_IDS, RESOURCE_INFO, type ResourceId } from '../data/config';
import type { Game } from '../core/Game';

/**
 * Top resource bar (DOM overlay). Listens to resource/population events
 * and pulses a chip whenever its value changes.
 */
export function createHUD(uiRoot: HTMLElement, game: Game): void {
  const bar = document.createElement('div');
  bar.className = 'hud';

  const chips = new Map<string, { el: HTMLElement; value: HTMLElement; last: string }>();

  const addChip = (key: string, icon: string, label: string): void => {
    const chip = document.createElement('div');
    chip.className = 'hud-chip';
    chip.title = label;
    const iconEl = document.createElement('span');
    iconEl.textContent = icon;
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = '0';
    chip.append(iconEl, value);
    bar.appendChild(chip);
    chips.set(key, { el: chip, value, last: '0' });
  };

  for (const r of RESOURCE_IDS) addChip(r, RESOURCE_INFO[r].icon, RESOURCE_INFO[r].label);
  addChip('population', '👷', 'Bevölkerung (genutzt/gesamt)');
  addChip('wave', '⚔️', 'Nächste Welle / Gegner');

  const spacer = document.createElement('div');
  spacer.className = 'hud-spacer';
  bar.appendChild(spacer);

  const statsBtn = document.createElement('button');
  statsBtn.className = 'pause-btn';
  statsBtn.textContent = '📊';
  statsBtn.setAttribute('aria-label', 'Übersicht');
  statsBtn.addEventListener('click', () => game.statsPanel?.toggle());
  bar.appendChild(statsBtn);

  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'pause-btn';
  pauseBtn.textContent = '⏸';
  pauseBtn.setAttribute('aria-label', 'Pause');
  pauseBtn.addEventListener('click', () => game.togglePause());
  bar.appendChild(pauseBtn);

  uiRoot.appendChild(bar);

  const update = (key: string, text: string): void => {
    const chip = chips.get(key);
    if (!chip || chip.last === text) return;
    chip.last = text;
    chip.value.textContent = text;
    chip.el.classList.remove('pulse');
    // Force a reflow so the pulse animation restarts.
    void chip.el.offsetWidth;
    chip.el.classList.add('pulse');
  };

  events.on('resources:changed', (resources: Record<ResourceId, number>) => {
    for (const r of RESOURCE_IDS) update(r, String(resources[r]));
  });
  events.on('population:changed', ({ used, total }) => {
    update('population', `${used}/${total}`);
  });
  events.on('wave:status', ({ wave, nextInSeconds, enemiesAlive }) => {
    if (enemiesAlive > 0) {
      update('wave', `W${wave} · ${enemiesAlive}`);
    } else {
      const m = Math.floor(nextInSeconds / 60);
      const s = nextInSeconds % 60;
      update('wave', `${m}:${String(s).padStart(2, '0')}`);
    }
  });
}
