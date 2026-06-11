import './ui/styles.css';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Game } from './core/Game';
import { MAX_FRAME_DELTA_MS, TICK_MS } from './data/config';

/**
 * Bootstrap + game loop.
 * Logic runs at a fixed 20 TPS; rendering runs per animation frame and
 * interpolates unit movement with the accumulator remainder (alpha).
 */
async function main(): Promise<void> {
  const gameRoot = document.getElementById('game-root');
  const uiRoot = document.getElementById('ui-root');
  if (!gameRoot || !uiRoot) throw new Error('Root-Elemente fehlen in index.html');

  const game = new Game();
  await game.init(gameRoot, uiRoot);
  // Debug handle for the browser console and automated smoke tests;
  // not exposed in the native store build.
  if (!Capacitor.isNativePlatform()) {
    (window as { __game?: Game } & Window).__game = game;
  }
  game.handleResize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', () => {
    game.handleResize(window.innerWidth, window.innerHeight);
  });

  let last = performance.now();
  let accumulator = 0;

  const frame = (now: number): void => {
    // Clamp so a backgrounded tab never fast-forwards the simulation
    // (no offline progress in phase 1).
    let delta = now - last;
    last = now;
    if (delta > MAX_FRAME_DELTA_MS) delta = MAX_FRAME_DELTA_MS;

    if (!document.hidden) {
      accumulator += delta;
      while (accumulator >= TICK_MS) {
        game.tick();
        accumulator -= TICK_MS;
      }
      game.renderFrame(accumulator / TICK_MS);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.onHidden();
    } else {
      // Drop time spent hidden.
      last = performance.now();
      accumulator = 0;
    }
  });
  // iOS Safari does not always fire visibilitychange on navigation.
  window.addEventListener('pagehide', () => game.onHidden());

  // Native (Capacitor) lifecycle: save when the app goes to background,
  // Android back button cancels build mode before minimizing the app.
  if (Capacitor.isNativePlatform()) {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        game.onHidden();
      } else {
        last = performance.now();
        accumulator = 0;
      }
    });
    void App.addListener('backButton', () => {
      if (game.buildSystem.active) {
        game.buildSystem.cancel();
      } else if (game.phase === 'playing') {
        game.setPhase('paused');
      } else {
        void App.minimizeApp();
      }
    });
  }
}

main().catch((err) => {
  console.error('Spielstart fehlgeschlagen:', err);
  const el = document.createElement('div');
  el.className = 'fatal-error';
  el.textContent = 'Das Spiel konnte nicht gestartet werden. Bitte Seite neu laden.';
  document.body.appendChild(el);
});
