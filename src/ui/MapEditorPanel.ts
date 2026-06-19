import { events } from '../core/EventBus';
import { Terrain } from '../world/IsoGrid';
import { deleteMap, exportMapCode, importMapCode, listMaps, loadMap, saveMap } from '../core/MapStore';
import { MAP_H, MAP_W } from '../data/config';
import type { EnemyDefId } from '../data/enemies';
import type { Game } from '../core/Game';

/**
 * Map editor toolbar (phase 'editor'): a terrain palette, an enemy-NPC palette,
 * brush size and save/load/play tools. The toolbar sits at the bottom so the
 * painted map stays visible; single-finger drag paints, two fingers pan/zoom.
 */

const BRUSHES: { id: Terrain; label: string; icon: string }[] = [
  { id: Terrain.Grass, label: 'Gras', icon: '🟩' },
  { id: Terrain.Water, label: 'Wasser', icon: '🟦' },
  { id: Terrain.Forest, label: 'Wald', icon: '🌲' },
  { id: Terrain.Rock, label: 'Fels', icon: '⛰️' },
  { id: Terrain.Ore, label: 'Erz', icon: '⛏️' },
  { id: Terrain.Sand, label: 'Sand', icon: '🏖️' },
  { id: Terrain.Path, label: 'Weg', icon: '🟫' },
  { id: Terrain.Snow, label: 'Schnee', icon: '❄️' },
  { id: Terrain.Meadow, label: 'Wiese', icon: '🌼' },
  { id: Terrain.Marsh, label: 'Sumpf', icon: '🟢' },
  { id: Terrain.Gravel, label: 'Geröll', icon: '⚪' },
];

const ENEMIES: { id: EnemyDefId; label: string; icon: string }[] = [
  { id: 'raider', label: 'Plünderer', icon: '🗡️' },
  { id: 'brute', label: 'Brecher', icon: '🪓' },
  { id: 'skirmisher', label: 'Plänkler', icon: '🏹' },
  { id: 'ram', label: 'Rammbock', icon: '🪵' },
  { id: 'catapult', label: 'Katapult', icon: '🎯' },
  { id: 'warlord', label: 'Kriegsherr', icon: '👑' },
];

export function createMapEditorPanel(uiRoot: HTMLElement, game: Game): void {
  const bar = document.createElement('div');
  bar.className = 'editor-bar';
  bar.hidden = true;

  // --- Terrain palette ---
  const palette = document.createElement('div');
  palette.className = 'editor-palette';
  const brushButtons = new Map<Terrain, HTMLButtonElement>();
  for (const b of BRUSHES) {
    const btn = document.createElement('button');
    btn.className = 'editor-brush';
    btn.innerHTML = `<span>${b.icon}</span>${b.label}`;
    btn.addEventListener('click', () => game.setEditorBrush(b.id));
    palette.appendChild(btn);
    brushButtons.set(b.id, btn);
  }

  // --- Enemy palette ---
  const enemyPalette = document.createElement('div');
  enemyPalette.className = 'editor-palette';
  const enemyButtons = new Map<EnemyDefId, HTMLButtonElement>();
  for (const e of ENEMIES) {
    const btn = document.createElement('button');
    btn.className = 'editor-brush';
    btn.innerHTML = `<span>${e.icon}</span>${e.label}`;
    btn.addEventListener('click', () => game.setEditorEnemy(e.id));
    enemyPalette.appendChild(btn);
    enemyButtons.set(e.id, btn);
  }
  const eraseBtn = document.createElement('button');
  eraseBtn.className = 'editor-brush';
  eraseBtn.innerHTML = `<span>🧽</span>Radierer`;
  eraseBtn.addEventListener('click', () => game.setEditorEraseEnemies());
  enemyPalette.appendChild(eraseBtn);

  // --- Brush size ---
  const sizeWrap = document.createElement('div');
  sizeWrap.className = 'editor-size';
  const sizeLabel = document.createElement('span');
  const sizeButtons: HTMLButtonElement[] = [];
  for (let s = 1; s <= 4; s++) {
    const btn = document.createElement('button');
    btn.className = 'editor-size-btn';
    btn.textContent = String(s);
    btn.addEventListener('click', () => game.setEditorBrushSize(s));
    sizeButtons.push(btn);
    sizeWrap.appendChild(btn);
  }
  sizeLabel.textContent = 'Pinsel';

  // --- Tools ---
  const tools = document.createElement('div');
  tools.className = 'editor-tools';
  const tool = (label: string, fn: () => void, cls = ''): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.className = `editor-tool ${cls}`.trim();
    btn.textContent = label;
    btn.addEventListener('click', fn);
    tools.appendChild(btn);
    return btn;
  };
  tool('🧹 Leeren', () => {
    if (confirm('Ganze Karte mit Gras überschreiben?')) game.fillEditor(Terrain.Grass);
  });
  tool('💀 Gegner weg', () => {
    if (confirm('Alle platzierten Gegner entfernen?')) game.clearEditorEnemies();
  });
  tool('💾 Speichern', () => saveCurrent());
  tool('📂 Laden', () => openLoad());
  tool('🔗 Teilen', () => openShare());
  tool('📥 Import', () => importCode());
  tool('▶ Spielen', () => game.playEditorMap(), 'primary');
  tool('✖ Beenden', () => game.exitMapEditor());

  const enemyLabel = document.createElement('span');
  enemyLabel.textContent = 'Gegner';

  const hint = document.createElement('div');
  hint.className = 'editor-hint';
  hint.textContent = 'Ziehen zum Malen/Platzieren · zwei Finger zum Bewegen/Zoomen';

  bar.append(palette, enemyLabel, enemyPalette, sizeLabel, sizeWrap, tools, hint);
  uiRoot.appendChild(bar);

  // --- Save / Load dialogs ---
  const dialog = document.createElement('div');
  dialog.className = 'pause-overlay menu-dialog';
  dialog.hidden = true;
  const card = document.createElement('div');
  card.className = 'pause-card';
  dialog.appendChild(card);
  uiRoot.appendChild(dialog);
  const closeDialog = (): void => {
    dialog.hidden = true;
  };

  function saveCurrent(): void {
    const name = prompt('Name der Karte:', '');
    if (name === null) return;
    if (saveMap(name, MAP_W, MAP_H, game.editorTerrain(), game.editorEnemiesData())) {
      events.emit('toast:show', { message: `Karte „${name.trim()}“ gespeichert` });
    } else {
      events.emit('toast:show', { message: 'Bitte einen gültigen Namen eingeben' });
    }
  }

  function openShare(): void {
    card.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = '🔗 Karte teilen';
    const info = document.createElement('p');
    info.className = 'gameover-stats';
    info.textContent = 'Diesen Code kopieren und weitergeben:';
    const area = document.createElement('textarea');
    area.className = 'editor-code';
    area.readOnly = true;
    area.value = exportMapCode(MAP_W, MAP_H, game.editorTerrain(), game.editorEnemiesData());
    area.addEventListener('focus', () => area.select());
    const copy = document.createElement('button');
    copy.textContent = '📋 Kopieren';
    copy.addEventListener('click', () => {
      area.select();
      void navigator.clipboard?.writeText(area.value).catch(() => {});
      events.emit('toast:show', { message: 'Code kopiert' });
    });
    const close = document.createElement('button');
    close.textContent = 'Schließen';
    close.addEventListener('click', closeDialog);
    card.append(h, info, area, copy, close);
    dialog.hidden = false;
  }

  function importCode(): void {
    const code = prompt('Karten-Code einfügen:', '');
    if (code === null) return;
    const map = importMapCode(code);
    if (map && map.width === MAP_W && map.height === MAP_H) {
      game.openMapEditor(map.terrain, map.enemies as { x: number; y: number; defId: EnemyDefId }[]);
      events.emit('toast:show', { message: 'Karte importiert' });
    } else {
      events.emit('toast:show', { message: 'Ungültiger Karten-Code' });
    }
  }

  function openLoad(): void {
    card.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = '📂 Karte laden';
    card.appendChild(h);
    const names = listMaps();
    if (names.length === 0) {
      const p = document.createElement('p');
      p.className = 'gameover-stats';
      p.textContent = 'Noch keine gespeicherten Karten.';
      card.appendChild(p);
    }
    for (const name of names) {
      const row = document.createElement('div');
      row.className = 'editor-load-row';
      const open = document.createElement('button');
      open.textContent = name;
      open.addEventListener('click', () => {
        const map = loadMap(name);
        if (map) {
          game.openMapEditor(map.terrain, map.enemies as { x: number; y: number; defId: EnemyDefId }[]);
          closeDialog();
        }
      });
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '🗑️';
      del.addEventListener('click', () => {
        if (confirm(`Karte „${name}“ löschen?`)) {
          deleteMap(name);
          openLoad();
        }
      });
      row.append(open, del);
      card.appendChild(row);
    }
    const close = document.createElement('button');
    close.textContent = 'Schließen';
    close.addEventListener('click', closeDialog);
    card.appendChild(close);
    dialog.hidden = false;
  }

  // --- Reactivity ---
  events.on('editor:changed', ({ brush, brushSize, tool, enemyType, enemyCount }) => {
    const terrainActive = tool === 'terrain';
    for (const [id, btn] of brushButtons) btn.classList.toggle('active', terrainActive && id === brush);
    for (const [id, btn] of enemyButtons) btn.classList.toggle('active', tool === 'enemy' && id === enemyType);
    eraseBtn.classList.toggle('active', tool === 'erase');
    sizeButtons.forEach((btn, i) => btn.classList.toggle('active', i + 1 === brushSize));
    enemyLabel.textContent = `Gegner (${enemyCount})`;
  });

  events.on('game:phaseChanged', ({ phase }) => {
    bar.hidden = phase !== 'editor';
    if (phase !== 'editor') dialog.hidden = true;
  });
}
