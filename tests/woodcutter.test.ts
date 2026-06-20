import { describe, expect, it } from 'vitest';
import { FOREST_WOOD_PER_TILE, LUMBERJACK_RANGE } from '../src/data/config';
import { Building } from '../src/entities/Building';
import { EconomySystem, ResourceStore } from '../src/systems/EconomySystem';
import { Woodcutter } from '../src/entities/Woodcutter';
import { IsoGrid, Terrain } from '../src/world/IsoGrid';

function makeEconomy(grid: IsoGrid, hut: Building, gatherers: Woodcutter[], onFell: () => void) {
  let id = 100;
  return new EconomySystem({
    grid,
    store: new ResourceStore(),
    buildings: new Map([[hut.id, hut]]),
    workers: [],
    gatherers,
    getWarehouse: () => null,
    nextEntityId: () => id++,
    getSoldierCount: () => 0,
    getSpeedFactor: () => 1,
    fellForestTile: () => {},
    fellTileAt: (tile) => {
      grid.setTerrain(tile.x, tile.y, Terrain.Grass);
      onFell();
    },
    depleteOreTile: () => {},
    getFarmFactor: () => 1,
    onConstructionFinished: () => {},
  });
}

describe('lumberjack woodcutter (range harvesting)', () => {
  it('reaches forest beyond adjacency and hauls wood into the hut', () => {
    const grid = new IsoGrid(20, 20);
    const hut = new Building(1, 'lumberjack', 4, 4, false);
    hut.assignedWorkers = 1;
    // A forest tile 4 rows south of the 2×2 footprint: not adjacent, in range.
    const treeY = hut.y + hut.h + 2;
    grid.setTerrain(hut.x, treeY, Terrain.Forest);
    expect(hut.adjacentTerrainTile(grid, Terrain.Forest)).toBeNull();
    expect(treeY - (hut.y + hut.h - 1)).toBeLessThanOrEqual(LUMBERJACK_RANGE);

    const gatherers: Woodcutter[] = [];
    const eco = makeEconomy(grid, hut, gatherers, () => {});

    eco.tick(); // spawns the woodcutter
    expect(gatherers.length).toBe(1);
    expect(gatherers[0].homeId).toBe(hut.id);

    let delivered = 0;
    for (let t = 0; t < 600; t++) {
      eco.tick();
      delivered += hut.outputStore;
      hut.outputStore = 0; // drain so the hut never fills up
    }
    expect(delivered).toBeGreaterThan(0);
  });

  it('fells the worked tile after enough wood and despawns when unstaffed', () => {
    const grid = new IsoGrid(20, 20);
    const hut = new Building(1, 'lumberjack', 4, 4, false);
    hut.assignedWorkers = 1;
    // A patch so the cutter keeps finding forest after felling the first tile.
    for (let dy = 2; dy < 5; dy++) grid.setTerrain(hut.x, hut.y + hut.h + dy, Terrain.Forest);

    const gatherers: Woodcutter[] = [];
    let felled = 0;
    const eco = makeEconomy(grid, hut, gatherers, () => felled++);

    for (let t = 0; t < FOREST_WOOD_PER_TILE * 200; t++) {
      eco.tick();
      hut.outputStore = 0;
    }
    expect(felled).toBeGreaterThanOrEqual(1);

    // Unstaffing the hut removes its woodcutter.
    hut.assignedWorkers = 0;
    eco.tick();
    expect(gatherers.length).toBe(0);
  });
});
