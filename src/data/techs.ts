import type { ResourceId } from './config';

/**
 * Research upgrades (phase 4). A new tech = a new entry here plus an
 * effect lookup at the system that consumes it.
 */

export interface TechDef {
  id: TechId;
  name: string;
  cost: Partial<Record<ResourceId, number>>;
  description: string;
}

export const TECH_DEFS = {
  fastCarriers: {
    id: 'fastCarriers',
    name: 'Schnelle Träger',
    cost: { bread: 5, wood: 20 },
    description: 'Träger laufen 30% schneller.',
  },
  steelArrows: {
    id: 'steelArrows',
    name: 'Stahlpfeile',
    cost: { wood: 30, stone: 30 },
    description: 'Wachtürme verursachen 50% mehr Schaden.',
  },
  combatTraining: {
    id: 'combatTraining',
    name: 'Kampftraining',
    cost: { bread: 8 },
    description: 'Soldaten verursachen 50% mehr Schaden.',
  },
} as const satisfies Record<string, Omit<TechDef, 'id'> & { id: string }>;

export type TechId = keyof typeof TECH_DEFS;

export const TECH_IDS = Object.keys(TECH_DEFS) as TechId[];

export function getTechDef(id: TechId): TechDef {
  return TECH_DEFS[id] as TechDef;
}

/** Effect multipliers applied when the tech is researched. */
export const TECH_EFFECTS = {
  fastCarriersSpeed: 1.3,
  steelArrowsDamage: 1.5,
  combatTrainingDamage: 1.5,
} as const;
