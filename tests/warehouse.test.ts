import { describe, expect, it } from 'vitest';
import { Building } from '../src/entities/Building';
import { ResourceStore } from '../src/systems/EconomySystem';

describe('warehouse local storage', () => {
  it('exposes capacity, occupancy and free space', () => {
    const wh = new Building(1, 'warehouse', 0, 0, false);
    expect(wh.isWarehouse).toBe(true);
    expect(wh.storageCapacity).toBe(400);
    wh.stock.wood = 30;
    wh.stock.stone = 20;
    expect(wh.totalStored()).toBe(50);
    expect(wh.freeCapacity()).toBe(350);
    wh.incomingStock = 10;
    expect(wh.freeCapacity()).toBe(340);
  });

  it('small warehouse has a smaller cap that grows with level', () => {
    const small = new Building(1, 'smallWarehouse', 0, 0, false);
    expect(small.storageCapacity).toBe(100);
    small.level = 2;
    expect(small.storageCapacity).toBe(125); // +25% per level
  });

  it('reserved stock reduces availability', () => {
    const wh = new Building(1, 'warehouse', 0, 0, false);
    wh.stock.wheat = 5;
    wh.reservedStock.wheat = 2;
    expect(wh.availableStock('wheat')).toBe(3);
  });

  it('round-trips stock and targets through save; producers store nothing', () => {
    const wh = new Building(1, 'warehouse', 0, 0, false);
    wh.stock.wood = 30;
    wh.storageTargets.stone = 40;
    const restored = Building.fromSave(wh.toSave());
    expect(restored.stock.wood).toBe(30);
    expect(restored.targetFor('stone')).toBe(40);

    const mill = new Building(2, 'mill', 4, 4, false);
    expect(mill.toSave().stock).toBeUndefined();
    expect(mill.toSave().storageTargets).toBeUndefined();
  });
});

describe('ResourceStore network facade', () => {
  it('sums warehouse stock and fills main-first up to capacity, overflow to loose', () => {
    const main = new Building(1, 'warehouse', 0, 0, false); // cap 400
    const small = new Building(2, 'smallWarehouse', 5, 5, false); // cap 100
    const store = new ResourceStore(() => [main, small], () => main);

    store.add('wood', 50);
    expect(store.get('wood')).toBe(50);
    expect(main.stock.wood).toBe(50); // main first

    store.add('wood', 400); // main fills to 400 (+350), small gets the rest (50)
    expect(main.totalStored()).toBe(400);
    expect(small.totalStored()).toBe(50);
    expect(store.get('wood')).toBe(450);

    store.add('wood', 60); // small fills to 100, then 10 overflow into loose
    expect(small.totalStored()).toBe(100);
    expect(store.looseSnapshot().wood).toBe(10);
    expect(store.get('wood')).toBe(510);
  });

  it('pay drains loose first, then warehouses, and reports affordability on the sum', () => {
    const main = new Building(1, 'warehouse', 0, 0, false);
    const small = new Building(2, 'smallWarehouse', 5, 5, false);
    const store = new ResourceStore(() => [main, small], () => main);
    main.stock.stone = 30;
    small.stock.stone = 10;

    expect(store.get('stone')).toBe(40);
    expect(store.canAfford({ stone: 40 })).toBe(true);
    expect(store.canAfford({ stone: 41 })).toBe(false);

    store.pay({ stone: 35 });
    expect(store.get('stone')).toBe(5);
    expect(main.stock.stone + small.stock.stone).toBe(5);
  });

  it('keeps currency (gold) in the treasury, never in warehouse capacity', () => {
    const main = new Building(1, 'warehouse', 0, 0, false);
    const store = new ResourceStore(() => [main], () => main);
    store.add('gold', 100);
    expect(store.get('gold')).toBe(100);
    expect(main.stock.gold).toBe(0); // not physically stored
    expect(main.totalStored()).toBe(0); // gold occupies no capacity
    store.add('wood', 50);
    expect(main.totalStored()).toBe(50);
  });

  it('detached store (no warehouses) works purely on the loose pool', () => {
    const store = new ResourceStore();
    store.setLoose({ gold: 100 });
    expect(store.get('gold')).toBe(100);
    store.pay({ gold: 40 });
    expect(store.get('gold')).toBe(60);
    store.add('gold', 5);
    expect(store.get('gold')).toBe(65);
  });
});
