/** Win-condition game modes selectable in the main menu (phase 12). */

export interface ScenarioView {
  wavesSurvived: number;
  gold: number;
  /** Empire scenario: accumulated prestige. */
  prestige: number;
}

export interface ScenarioDef {
  id: ScenarioId;
  name: string;
  description: string;
  /** null = endless (no victory). */
  isWon: ((v: ScenarioView) => boolean) | null;
}

export const SCENARIOS = {
  endless: {
    id: 'endless',
    name: 'Endlos',
    description: 'Überlebe so lange wie möglich.',
    isWon: null,
  },
  survive10: {
    id: 'survive10',
    name: 'Zehn Wellen',
    description: 'Überstehe 10 Angriffswellen.',
    isWon: (v) => v.wavesSurvived >= 10,
  },
  goldRush: {
    id: 'goldRush',
    name: 'Goldrausch',
    description: 'Horte 300 Gold (Marktplatz!).',
    isWon: (v) => v.gold >= 300,
  },
  empire: {
    id: 'empire',
    name: 'Wirtschaft',
    description: 'Keine Wellen — Diplomatie, Handel & Ränge. Werde Herzog!',
    isWon: (v) => v.prestige >= 1200,
  },
} as const satisfies Record<string, Omit<ScenarioDef, 'id'> & { id: string }>;

export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
export function getScenario(id: ScenarioId): ScenarioDef {
  return SCENARIOS[id] as ScenarioDef;
}
