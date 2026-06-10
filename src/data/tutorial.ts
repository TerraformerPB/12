import type { BuildingDefId } from './buildings';

/**
 * Guided onboarding (phase 4): a linear list of goals. The game checks the
 * current step's condition once per second and advances automatically.
 */

/** Snapshot of game state used by tutorial conditions (no Game import). */
export interface TutorialView {
  countBuildings(defId: BuildingDefId): number;
  soldierCount: number;
  wavesSurvived: number;
}

export interface TutorialStep {
  id: string;
  text: string;
  isDone(view: TutorialView): boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'lumberjack',
    text: 'Baue eine Holzfällerhütte — Menü „Bauen“ unten öffnen.',
    isDone: (v) => v.countBuildings('lumberjack') > 0,
  },
  {
    id: 'quarry',
    text: 'Baue einen Steinbruch direkt neben Fels (graue Hügel).',
    isDone: (v) => v.countBuildings('quarry') > 0,
  },
  {
    id: 'bread',
    text: 'Baue die Brot-Kette: Weizenfarm, Mühle und Bäckerei.',
    isDone: (v) =>
      v.countBuildings('farm') > 0 && v.countBuildings('mill') > 0 && v.countBuildings('bakery') > 0,
  },
  {
    id: 'hut',
    text: 'Baue eine Hütte für mehr Träger.',
    isDone: (v) => v.countBuildings('hut') > 0,
  },
  {
    id: 'defense',
    text: 'Errichte einen Wachturm — die erste Welle naht (⚔️ oben).',
    isDone: (v) => v.countBuildings('tower') > 0,
  },
  {
    id: 'soldier',
    text: 'Baue eine Kaserne und rekrutiere einen Soldaten (kostet Brot).',
    isDone: (v) => v.soldierCount > 0,
  },
  {
    id: 'survive',
    text: 'Überstehe die erste Angriffswelle!',
    isDone: (v) => v.wavesSurvived >= 1,
  },
];
