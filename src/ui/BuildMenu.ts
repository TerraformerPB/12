import { events } from '../core/EventBus';
import { BUILD_MENU_SECTIONS, getDef } from '../data/buildings';
import { RESOURCE_IDS, RESOURCE_INFO } from '../data/config';
import type { Game } from '../core/Game';

/**
 * Bottom-sheet build menu plus the floating action bar (rotate/cancel)
 * shown while build mode is active.
 */
export function createBuildMenu(uiRoot: HTMLElement, game: Game): void {
  // --- Bottom sheet ---
  const sheet = document.createElement('div');
  sheet.className = 'build-sheet';

  const handle = document.createElement('div');
  handle.className = 'build-sheet-handle';
  handle.textContent = '🔨 Bauen';
  handle.addEventListener('click', () => sheet.classList.toggle('open'));
  sheet.appendChild(handle);

  const content = document.createElement('div');
  content.className = 'build-content';
  sheet.appendChild(content);

  const cards = new Map<string, HTMLButtonElement>();

  for (const section of BUILD_MENU_SECTIONS) {
    const header = document.createElement('div');
    header.className = 'build-section-title';
    header.textContent = section.title;
    content.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'build-grid';
    content.appendChild(grid);

    for (const defId of section.ids) {
      const def = getDef(defId);
      const card = document.createElement('button');
      card.className = 'build-card';

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = def.name;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${def.footprint.w}×${def.footprint.h} · ${def.description}`;

      const cost = document.createElement('span');
      cost.className = 'cost';
      const costParts = RESOURCE_IDS.filter((r) => (def.cost[r] ?? 0) > 0).map(
        (r) => `${RESOURCE_INFO[r].icon} ${def.cost[r]}`,
      );
      cost.textContent = costParts.length > 0 ? costParts.join('  ') : 'Gratis';

      card.append(title, meta, cost);
      card.addEventListener('click', () => {
        game.buildSystem.enterBuildMode(defId);
        sheet.classList.remove('open');
      });
      grid.appendChild(card);
      cards.set(defId, card);
    }
  }

  uiRoot.appendChild(sheet);

  // Mark cards the player currently cannot afford.
  events.on('resources:changed', () => {
    for (const [defId, card] of cards) {
      const def = getDef(defId as Parameters<typeof getDef>[0]);
      card.classList.toggle('unaffordable', !game.store.canAfford(def.cost));
    }
  });

  // --- Build mode action bar ---
  const actions = document.createElement('div');
  actions.className = 'build-actions';
  actions.hidden = true;

  const label = document.createElement('span');
  label.className = 'label';

  const rotateBtn = document.createElement('button');
  rotateBtn.textContent = '↻ Drehen';
  rotateBtn.addEventListener('click', () => game.buildSystem.rotate());

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel';
  cancelBtn.textContent = 'Abbrechen';
  cancelBtn.addEventListener('click', () => game.buildSystem.cancel());

  actions.append(label, rotateBtn, cancelBtn);
  uiRoot.appendChild(actions);

  events.on('build:modeChanged', ({ defId }) => {
    if (defId === null) {
      actions.hidden = true;
      return;
    }
    const def = getDef(defId);
    label.textContent = def.name;
    // Rotation only matters for asymmetric footprints.
    rotateBtn.hidden = def.footprint.w === def.footprint.h;
    actions.hidden = false;
  });
}
