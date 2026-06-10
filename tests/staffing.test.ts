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
