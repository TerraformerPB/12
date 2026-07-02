import type { Expense, IncomeEntry, Invoice } from '../types';
import { docTotals, round2 } from './money';

export interface BookingRow {
  date: string;
  description: string;
  category: string;
  kind: 'einnahme' | 'ausgabe';
  net: number;
  vat: number;
  gross: number;
}

/**
 * Alle EÜR-relevanten Buchungen eines Jahres (Zufluss-/Abflussprinzip):
 * bezahlte Rechnungen (nach Zahldatum), manuelle Einnahmen, Ausgaben.
 */
export function bookingRows(
  invoices: Invoice[],
  incomes: IncomeEntry[],
  expenses: Expense[],
  year: number,
): BookingRow[] {
  const rows: BookingRow[] = [];
  for (const inv of invoices) {
    if (inv.status !== 'bezahlt' || !inv.paidDate) continue;
    if (!inv.paidDate.startsWith(String(year))) continue;
    const t = docTotals(inv.items, inv.vatRate);
    rows.push({
      date: inv.paidDate,
      description: `Rechnung ${inv.number}`,
      category: 'Umsatzerlöse',
      kind: 'einnahme',
      net: t.net,
      vat: t.vat,
      gross: t.gross,
    });
  }
  for (const inc of incomes) {
    if (!inc.date.startsWith(String(year))) continue;
    const vat = round2((inc.netAmount * inc.vatRate) / 100);
    rows.push({
      date: inc.date,
      description: inc.description,
      category: 'Sonstige Einnahmen',
      kind: 'einnahme',
      net: inc.netAmount,
      vat,
      gross: round2(inc.netAmount + vat),
    });
  }
  for (const ex of expenses) {
    if (!ex.date.startsWith(String(year))) continue;
    const vat = round2((ex.netAmount * ex.vatRate) / 100);
    rows.push({
      date: ex.date,
      description: ex.description,
      category: ex.category || 'Sonstige Ausgaben',
      kind: 'ausgabe',
      net: ex.netAmount,
      vat,
      gross: round2(ex.netAmount + vat),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export interface EuerSummary {
  incomeNet: number;
  expenseNet: number;
  profit: number;
  vatCollected: number; // vereinnahmte USt
  inputTax: number; // gezahlte Vorsteuer
  vatDue: number; // Zahllast
}

export function euerSummary(rows: BookingRow[]): EuerSummary {
  let incomeNet = 0;
  let expenseNet = 0;
  let vatCollected = 0;
  let inputTax = 0;
  for (const r of rows) {
    if (r.kind === 'einnahme') {
      incomeNet += r.net;
      vatCollected += r.vat;
    } else {
      expenseNet += r.net;
      inputTax += r.vat;
    }
  }
  return {
    incomeNet: round2(incomeNet),
    expenseNet: round2(expenseNet),
    profit: round2(incomeNet - expenseNet),
    vatCollected: round2(vatCollected),
    inputTax: round2(inputTax),
    vatDue: round2(vatCollected - inputTax),
  };
}

export interface UstvaQuarter {
  quarter: 1 | 2 | 3 | 4;
  vatCollected: number;
  inputTax: number;
  vatDue: number;
}

/** Vorbereitung der USt-Voranmeldung: Zahllast je Quartal. */
export function ustvaQuarters(rows: BookingRow[]): UstvaQuarter[] {
  const quarters: UstvaQuarter[] = [1, 2, 3, 4].map((q) => ({
    quarter: q as 1 | 2 | 3 | 4,
    vatCollected: 0,
    inputTax: 0,
    vatDue: 0,
  }));
  for (const r of rows) {
    const month = parseInt(r.date.slice(5, 7), 10);
    const q = quarters[Math.floor((month - 1) / 3)];
    if (r.kind === 'einnahme') q.vatCollected += r.vat;
    else q.inputTax += r.vat;
  }
  for (const q of quarters) {
    q.vatCollected = round2(q.vatCollected);
    q.inputTax = round2(q.inputTax);
    q.vatDue = round2(q.vatCollected - q.inputTax);
  }
  return quarters;
}
