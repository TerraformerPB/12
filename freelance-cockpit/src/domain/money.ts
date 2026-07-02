import type { LineItem } from '../types';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineTotal(item: LineItem): number {
  return round2(item.quantity * item.unitPrice);
}

export interface DocTotals {
  net: number;
  vat: number;
  gross: number;
}

/** Summen eines Belegs; vatRate 0 = Kleinunternehmer (§19 UStG). */
export function docTotals(items: LineItem[], vatRate: number): DocTotals {
  const net = round2(items.reduce((sum, i) => sum + lineTotal(i), 0));
  const vat = round2((net * vatRate) / 100);
  return { net, vat, gross: round2(net + vat) };
}

export function fmtEUR(n: number): string {
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('de-DE');
}

export function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}
