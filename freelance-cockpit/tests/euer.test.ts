import { describe, expect, it } from 'vitest';
import { bookingRows, euerSummary, ustvaQuarters } from '../src/domain/euer';
import type { Expense, IncomeEntry, Invoice } from '../src/types';

const paidInvoice: Invoice = {
  id: 'i1', number: 'R-2026-001', contactId: 'c1',
  date: '2026-03-01', dueDate: '2026-03-15', servicePeriod: '',
  vatRate: 19,
  items: [{ id: 'p1', description: 'Arbeit', quantity: 10, unit: 'Std.', unitPrice: 100 }],
  status: 'bezahlt', paidDate: '2026-03-20',
};

const unpaidInvoice: Invoice = { ...paidInvoice, id: 'i2', number: 'R-2026-002', status: 'versendet', paidDate: undefined };
const lastYearInvoice: Invoice = { ...paidInvoice, id: 'i3', number: 'R-2025-009', paidDate: '2025-12-30' };

const expenses: Expense[] = [
  { id: 'e1', date: '2026-07-10', description: 'Lizenz', category: 'Software', netAmount: 100, vatRate: 19 },
];
const incomes: IncomeEntry[] = [
  { id: 'in1', date: '2026-08-01', description: 'Gerät verkauft', netAmount: 50, vatRate: 0 },
];

describe('EÜR', () => {
  it('zählt nur bezahlte Rechnungen des Jahres (Zuflussprinzip)', () => {
    const rows = bookingRows([paidInvoice, unpaidInvoice, lastYearInvoice], [], [], 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Rechnung R-2026-001');
    expect(rows[0].net).toBe(1000);
    expect(rows[0].vat).toBe(190);
  });

  it('summiert Gewinn und USt korrekt', () => {
    const rows = bookingRows([paidInvoice], incomes, expenses, 2026);
    const s = euerSummary(rows);
    expect(s.incomeNet).toBe(1050);
    expect(s.expenseNet).toBe(100);
    expect(s.profit).toBe(950);
    expect(s.vatCollected).toBe(190);
    expect(s.inputTax).toBe(19);
    expect(s.vatDue).toBe(171);
  });

  it('ordnet Buchungen dem richtigen Quartal zu', () => {
    const rows = bookingRows([paidInvoice], incomes, expenses, 2026);
    const q = ustvaQuarters(rows);
    expect(q[0].vatCollected).toBe(190); // Zahlung im März → Q1
    expect(q[2].inputTax).toBe(19); // Ausgabe im Juli → Q3
    expect(q[2].vatDue).toBe(-19);
    expect(q[3].vatCollected).toBe(0);
  });
});
