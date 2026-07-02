import { describe, expect, it } from 'vitest';
import { docTotals, lineTotal, round2 } from '../src/domain/money';
import type { LineItem } from '../src/types';

function item(quantity: number, unitPrice: number): LineItem {
  return { id: 'x', description: 'Test', quantity, unit: 'Std.', unitPrice };
}

describe('money', () => {
  it('rundet kaufmännisch auf 2 Stellen', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.674999)).toBe(2.67);
  });

  it('berechnet Positionssummen', () => {
    expect(lineTotal(item(7.5, 95))).toBe(712.5);
  });

  it('berechnet Netto/USt/Brutto bei Regelbesteuerung', () => {
    const t = docTotals([item(10, 95), item(2, 50)], 19);
    expect(t.net).toBe(1050);
    expect(t.vat).toBe(199.5);
    expect(t.gross).toBe(1249.5);
  });

  it('Kleinunternehmer (§19 UStG): keine USt', () => {
    const t = docTotals([item(10, 95)], 0);
    expect(t.vat).toBe(0);
    expect(t.gross).toBe(t.net);
  });
});
