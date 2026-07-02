import type { Asset } from '../types';
import { round2 } from './money';

function shiftISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Letzter Tag, an dem gekündigt werden kann (Verlängerung − Kündigungsfrist). */
export function cancellationDeadline(asset: Asset): string | undefined {
  if (!asset.renewalDate || asset.interval === 'einmalig') return undefined;
  return shiftISO(asset.renewalDate, -asset.cancelPeriodDays);
}

export interface AssetAlert {
  asset: Asset;
  deadline: string;
  daysLeft: number;
  overdue: boolean;
}

/** Kündigungsfristen, die innerhalb des Horizonts (Tage) fällig werden. */
export function upcomingAlerts(assets: Asset[], todayIso: string, horizonDays = 30): AssetAlert[] {
  const today = new Date(todayIso + 'T00:00:00').getTime();
  const alerts: AssetAlert[] = [];
  for (const asset of assets) {
    const deadline = cancellationDeadline(asset);
    if (!deadline) continue;
    const daysLeft = Math.round((new Date(deadline + 'T00:00:00').getTime() - today) / 86_400_000);
    if (daysLeft <= horizonDays) {
      alerts.push({ asset, deadline, daysLeft, overdue: daysLeft < 0 });
    }
  }
  alerts.sort((a, b) => a.daysLeft - b.daysLeft);
  return alerts;
}

/** Laufende Kosten pro Monat (Abos monatlich + jährliche anteilig). */
export function monthlyRunningCost(assets: Asset[]): number {
  let sum = 0;
  for (const a of assets) {
    if (a.interval === 'monatlich') sum += a.cost;
    else if (a.interval === 'jaehrlich') sum += a.cost / 12;
  }
  return round2(sum);
}
