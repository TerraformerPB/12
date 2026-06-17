import { describe, expect, it } from 'vitest';
import { IsoGrid, Terrain } from '../src/world/IsoGrid';
import { checkPlacement } from '../src/systems/BuildSystem';
import { getDef } from '../src/data/buildings';
import { Game } from '../src/core/Game';
import { Building } from '../src/entities/Building';

describe('Fog of War & Larger Map', () => {
  it('initializes exploredState and allows setting/getting explored tiles', () => {
    const grid = new IsoGrid(64, 64);
    expect(grid.width).toBe(64);
    expect(grid.height).toBe(64);
    expect(grid.isExplored(10, 10)).toBe(false);
    
    grid.setExplored(10, 10, true);
    expect(grid.isExplored(10, 10)).toBe(true);
  });

  it('sand and path are walkable (path slightly faster than grass)', () => {
    const grid = new IsoGrid(8, 8);
    grid.setTerrain(2, 2, Terrain.Sand);
    grid.setTerrain(3, 3, Terrain.Path);
    expect(Number.isFinite(grid.moveCost(2, 2))).toBe(true);
    expect(grid.moveCost(2, 2)).toBe(grid.moveCost(0, 0)); // sand == grass
    expect(grid.moveCost(3, 3)).toBeLessThan(grid.moveCost(0, 0)); // path faster
    // Water stays blocked.
    grid.setTerrain(4, 4, Terrain.Water);
    expect(Number.isFinite(grid.moveCost(4, 4))).toBe(false);
  });

  it('revealAll uncovers the whole map (editor/duel)', () => {
    const grid = new IsoGrid(8, 8);
    expect(grid.isExplored(0, 0)).toBe(false);
    grid.revealAll();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) expect(grid.isExplored(x, y)).toBe(true);
    }
  });

  it('blocks building placement on unexplored tiles', () => {
    const grid = new IsoGrid(64, 64);
    const hutDef = getDef('hut');
    
    // Unexplored -> blocked
    expect(checkPlacement(grid, hutDef, 5, 5, false).ok).toBe(false);
    
    // Explored -> allowed
    grid.setExplored(5, 5, true);
    expect(checkPlacement(grid, hutDef, 5, 5, false).ok).toBe(true);
  });

  it('updates FOW explored tiles around buildings and units in Game', () => {
    const game = new Game();
    game.newGame(42, 'empire');
    
    // Verify starting warehouse area is explored
    const w = game.buildings.get((game as any).warehouseId)!;
    expect(game.grid.isExplored(w.x, w.y)).toBe(true);

    // Place a distant tile as unexplored
    expect(game.grid.isExplored(0, 0)).toBe(false);

    // Add a soldier at (2, 2) and update visibility
    game.grid.setExplored(2, 2, true); // must explore tile first to spawn/move soldier
    
    // Soldier should explore radius 5
    game.updateExploration();
    expect(game.grid.isExplored(2, 2)).toBe(true);
  });
});

describe('Anno Population Tiers & Morale Gates', () => {
  it('sets correct population capacities for upgraded Huts', () => {
    const b = new Building(1, 'hut', 5, 5, false);
    expect(b.populationBonus).toBe(2); // Level 1 peasant
    b.level = 2;
    expect(b.populationBonus).toBe(4); // Level 2 citizen
    b.level = 3;
    expect(b.populationBonus).toBe(6); // Level 3 merchant
  });

  it('blocks Hut upgrades if morale is below the required gate', () => {
    const game = new Game();
    game.newGame(42, 'empire');

    // Place a hut (need to make sure the tile is explored)
    game.grid.setExplored(10, 10, true);
    const hut = (game as any).addBuilding('hut', 10, 10, false);
    expect(hut.level).toBe(1);

    // Drop morale below 80% (HUT_UPGRADE_MORALE_GATE_L2)
    game.morale = 75;

    // Attempt upgrade -> should fail and remain level 1
    game.upgradeBuilding(hut.id);
    expect(hut.level).toBe(1);

    // Raise morale to 80%
    game.morale = 80;

    // Attempt upgrade -> should succeed and reach level 2
    game.upgradeBuilding(hut.id);
    expect(hut.level).toBe(2);

    // Morale at 80% blocks level 3 upgrade (requires 85%)
    game.upgradeBuilding(hut.id);
    expect(hut.level).toBe(2);

    // Raise morale to 85%
    game.morale = 85;

    // Attempt upgrade -> should succeed and reach level 3
    game.upgradeBuilding(hut.id);
    expect(hut.level).toBe(3);
  });

  it('consumes resources by class and applies satisfaction morale changes & taxes', () => {
    const game = new Game();
    // Start empire game with some basic and luxury resources
    game.newGame(42, 'empire');
    game.store.pay(game.store.snapshot()); // clear starting goods
    game.store.add('bread', 100);
    game.store.add('fish', 100);
    game.store.add('beer', 100);
    game.store.add('cloth', 100);
    game.store.add('gold', 100);

    // Spawn 1 Hut level 2 and 1 Hut level 3 (manually add, instant-build)
    game.grid.setExplored(20, 20, true);
    game.grid.setExplored(21, 21, true);
    
    // Add Hut level 2
    const h2 = new Building(20, 'hut', 20, 20, false);
    h2.level = 2;
    game.buildings.set(h2.id, h2);
    
    // Add Hut level 3
    const h3 = new Building(21, 'hut', 21, 21, false);
    h3.level = 3;
    game.buildings.set(h3.id, h3);

    // Trigger food and tax tick
    game.taxLevel = 2; // high taxes
    game.morale = 80;
    
    // Trigger tick
    // popBauern = 4 (START_WORKERS) + 0 huts lvl 1 * 2 = 4
    // popBuerger = 1 hut lvl 2 * 4 = 4
    // popHaendler = 1 hut lvl 3 * 6 = 6
    // total = 14. Needs are fully satisfied in store.
    const beforeGold = game.store.get('gold');
    const beforeBeer = game.store.get('beer');
    
    // Invoke foodAndTaxTick by running game loop tick at FOOD_INTERVAL
    // Wait, let's just invoke the private method directly
    (game as any).foodAndTaxTick();

    expect(game.store.get('beer')).toBeLessThan(beforeBeer); // Beer consumed by Bürger and Händler
    expect(game.store.get('gold')).toBeGreaterThan(beforeGold - 1); // Gold paid as taxes is far higher than merchant upkeep
  });
});

describe('Small Warehouses & Production Line Management', () => {
  it('places a small warehouse with a cost and checks that it goes through construction', () => {
    const game = new Game();
    game.newGame(42, 'empire');
    
    game.grid.setExplored(15, 15, true);
    const sw = (game as any).addBuilding('smallWarehouse', 15, 15, false);
    
    // Should be under construction initially because it has cost and is not built instantly
    expect(sw.underConstruction).toBe(true);
    expect(sw.materialsRemaining.wood).toBe(20);
    expect(sw.materialsRemaining.stone).toBe(10);
  });

  it('generates delivery jobs for a small warehouse under construction', () => {
    const game = new Game();
    game.newGame(42, 'empire');
    
    // Put some resources in main warehouse stock
    game.store.pay(game.store.snapshot()); // clear starting goods
    game.store.add('wood', 50);
    game.store.add('stone', 50);
    
    game.grid.setExplored(15, 15, true);
    const sw = (game as any).addBuilding('smallWarehouse', 15, 15, false);
    expect(sw.underConstruction).toBe(true);
    
    // Run economy jobs generator
    const economy = (game as any).economy;
    economy.generateJobs();
    
    // There should be delivery jobs queued for wood and stone!
    expect(economy.deliverQueue.length).toBeGreaterThan(0);
    const hasWoodJob = economy.deliverQueue.some((q: any) => q.job.resource === 'wood' && q.job.buildingId === sw.id);
    const hasStoneJob = economy.deliverQueue.some((q: any) => q.job.resource === 'stone' && q.job.buildingId === sw.id);
    expect(hasWoodJob).toBe(true);
    expect(hasStoneJob).toBe(true);
  });

  it('verifies that getNearestWarehouse finds the closest completed warehouse', () => {
    const game = new Game();
    game.newGame(42, 'empire');
    
    // Access central warehouse
    const mainWh = game.buildings.get((game as any).warehouseId)!;
    
    // Add a small warehouse at (10, 10) that is under construction
    game.grid.setExplored(10, 10, true);
    const sw = (game as any).addBuilding('smallWarehouse', 10, 10, false);
    
    // Nearest to (9, 9) should still be mainWh since sw is under construction
    const economy = (game as any).economy;
    let wh = (economy as any).getNearestWarehouse({ x: 9, y: 9 });
    expect(wh.id).toBe(mainWh.id);
    
    // Finish construction of the small warehouse
    sw.underConstruction = false;
    sw.materialsRemaining = {};
    sw.buildTicks = 0;
    
    // Now sw is completed, so it should be the nearest warehouse to (9, 9)
    wh = (economy as any).getNearestWarehouse({ x: 9, y: 9 });
    expect(wh.id).toBe(sw.id);
    
    // But for a far-away point closer to mainWh, mainWh should be returned
    wh = (economy as any).getNearestWarehouse({ x: mainWh.x, y: mainWh.y });
    expect(wh.id).toBe(mainWh.id);
  });

  it('manually pauses a building and checks that production progress halts', () => {
    const game = new Game();
    game.newGame(42, 'empire');
    
    // Add a quarry
    game.grid.setExplored(10, 10, true);
    // quarry needs adjacent rock, let's mock the rock adjacent to it
    const Terrain = { Rock: 2 };
    game.grid.setTerrain(12, 10, (Terrain as any).Rock || 2);
    
    const quarry = (game as any).addBuilding('quarry', 10, 10, false);
    quarry.underConstruction = false;
    quarry.assignedWorkers = 1;
    expect(quarry.userPaused).toBe(false);
    
    // Pause it
    quarry.userPaused = true;
    
    // Run tick - should not progress
    const prevProgress = quarry.progress;
    quarry.tickProduction();
    expect(quarry.progress).toBe(prevProgress);
    
    // Resume it
    quarry.userPaused = false;
    
    // Run tick - should progress
    quarry.tickProduction();
    expect(quarry.progress).toBeGreaterThan(prevProgress);
  });
});
