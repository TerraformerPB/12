import { describe, expect, it } from 'vitest';
import { cancellationDeadline, monthlyRunningCost, upcomingAlerts } from '../src/domain/inventory';
import type { Asset } from '../src/types';

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: 'a', type: 'abo', name: 'Test', vendor: 'V', cost: 10,
    interval: 'monatlich', renewalDate: '2026-08-15', cancelPeriodDays: 14, notes: '',
    ...overrides,
  };
}

describe('Inventar / Kündigungsfristen', () => {
  it('berechnet die Kündigungsdeadline (Verlängerung − Frist)', () => {
    expect(cancellationDeadline(asset({}))).toBe('2026-08-01');
    expect(cancellationDeadline(asset({ cancelPeriodDays: 30, renewalDate: '2026-03-01' }))).toBe('2026-01-30');
  });

  it('einmalige Käufe haben keine Deadline', () => {
    expect(cancellationDeadline(asset({ interval: 'einmalig' }))).toBeUndefined();
    expect(cancellationDeadline(asset({ renewalDate: undefined }))).toBeUndefined();
  });

  it('meldet Fristen im Horizont inkl. überfälliger', () => {
    const assets = [
      asset({ id: 'soon', renewalDate: '2026-07-20', cancelPeriodDays: 10 }), // Deadline 10.07.
      asset({ id: 'late', renewalDate: '2026-12-24', cancelPeriodDays: 0 }), // weit weg
      asset({ id: 'missed', renewalDate: '2026-07-01', cancelPeriodDays: 7 }), // Deadline 24.06. → überfällig
    ];
    const alerts = upcomingAlerts(assets, '2026-07-02', 30);
    expect(alerts.map((a) => a.asset.id)).toEqual(['missed', 'soon']);
    expect(alerts[0].overdue).toBe(true);
    expect(alerts[1].daysLeft).toBe(8);
  });

  it('summiert laufende Monatskosten (jährlich anteilig)', () => {
    const assets = [
      asset({ cost: 12, interval: 'monatlich' }),
      asset({ cost: 120, interval: 'jaehrlich' }),
      asset({ cost: 999, interval: 'einmalig' }),
    ];
    expect(monthlyRunningCost(assets)).toBe(22);
  });
});
