import type { Point } from '../world/IsoGrid';
import { Unit } from './Unit';

/**
 * Woodcutter phases.
 * idle:      waiting at the hut for a free tree / storage space.
 * toTree:    walking out to the targeted forest tile.
 * chopping:  standing at the tree, felling it (counts down chopTicks).
 * returning: walking the chopped wood back to the hut.
 */
export type WoodcutterPhase = 'idle' | 'toTree' | 'chopping' | 'returning';

/**
 * A woodcutter belongs to one lumberjack hut. It physically walks to a forest
 * tile within the hut's range, chops, and carries the wood back into the hut's
 * output store, from where carriers haul it to the warehouse. Movement comes
 * from `Unit`; the behaviour state machine lives in EconomySystem.
 *
 * Woodcutters are transient: they are derived from staffed lumberjacks and
 * respawn after a load, so they are not serialized.
 */
export class Woodcutter extends Unit {
  /** Id of the lumberjack hut this woodcutter works for. */
  readonly homeId: number;
  phase: WoodcutterPhase = 'idle';
  /** Forest tile currently being worked, null while idle/returning. */
  target: Point | null = null;
  /** Logic ticks left in the current chop. */
  chopTicks = 0;
  /** Whether a unit of wood is being carried home. */
  carrying = false;

  constructor(id: number, x: number, y: number, homeId: number) {
    super(id, x, y);
    this.homeId = homeId;
  }
}
