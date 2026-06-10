import { describe, expect, it } from 'vitest';
import { Building } from '../src/entities/Building';

describe('worker assignment gates production', () => {
  it('does not produce without assigned workers', () => {
    const b = new Building(1, 'lumberjack', 2, 2, false);
    expect(b.workersRequired).toBe(1);
    for (let i = 0; i < 200; i++) b.tickProduction();
    expect(b.outputStore).toBe(0);
  });

  it('produces at full speed when fully staffed', () => {
    const b = new Building(1, 'lumberjack', 2, 2, false);
    b.assignedWorkers = 1;
    for (let i = 0; i < b.durationTicks + 1; i++) b.tickProduction();
    expect(b.outputStore).toBe(1);
  });

  it('runs at half speed when half staffed', () => {
    const b = new Building(1, 'farm', 2, 2, false); // requires 2
    b.assignedWorkers = 1;
    for (let i = 0; i < b.durationTicks + 1; i++) b.tickProduction();
    expect(b.outputStore).toBe(0); // only ~50% progress so far
    for (let i = 0; i < b.durationTicks + 1; i++) b.tickProduction();
    expect(b.outputStore).toBe(1);
  });

  it('staffing factor is clamped at 1', () => {
    const b = new Building(1, 'mill', 2, 2, false);
    b.assignedWorkers = 5;
    expect(b.staffingFactor).toBe(1);
  });
});

describe('building levels', () => {
  it('higher levels raise hp, speed and hut population', () => {
    const hut = new Building(1, 'hut', 2, 2, false);
    const baseHp = hut.maxHp;
    const basePop = hut.populationBonus;
    hut.level = 3;
    expect(hut.maxHp).toBeGreaterThan(baseHp);
    expect(hut.populationBonus).toBeGreaterThan(basePop);

    const mill = new Building(2, 'mill', 4, 4, false);
    mill.level = 2;
    expect(mill.levelFactor).toBeGreaterThan(1);
  });

  it('roads cannot level up (they swap definitions instead)', () => {
    const road = new Building(3, 'road', 1, 1, false);
    expect(road.maxLevel).toBe(1);
  });

  it('levels survive the save roundtrip', () => {
    const tower = new Building(4, 'tower', 5, 5, false);
    tower.level = 3;
    tower.hp = tower.maxHp;
    const restored = Building.fromSave(tower.toSave());
    expect(restored.level).toBe(3);
    expect(restored.maxHp).toBe(tower.maxHp);
  });
});
