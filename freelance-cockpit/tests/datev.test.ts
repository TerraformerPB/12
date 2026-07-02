import { describe, expect, it } from 'vitest';
import { datevCsv } from '../src/domain/datev';
import type { BookingRow } from '../src/domain/euer';

const rows: BookingRow[] = [
  { date: '2026-03-20', description: 'Rechnung R-2026-001', category: 'Umsatzerlöse', kind: 'einnahme', net: 1000, vat: 190, gross: 1190 },
  { date: '2026-07-10', description: 'IDE "Lizenz"', category: 'Software', kind: 'ausgabe', net: 100, vat: 19, gross: 119 },
];

describe('DATEV-Export', () => {
  it('erzeugt EXTF-Header und eine Zeile je Buchung', () => {
    const csv = datevCsv(rows, 2026);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('"EXTF"');
    expect(lines[0]).toContain('20260101;20261231');
    expect(lines).toHaveLength(2 + rows.length);
  });

  it('nutzt Komma-Dezimaltrennung, S/H-Kennzeichen und TTMM-Belegdatum', () => {
    const csv = datevCsv(rows, 2026);
    const lines = csv.trim().split('\r\n');
    expect(lines[2]).toContain('1190,00;"H";');
    expect(lines[2]).toContain(';2003;'); // 20.03. → 2003
    expect(lines[3]).toContain('119,00;"S";');
    expect(lines[3]).toContain(';1007;');
  });

  it('escapt doppelte Anführungszeichen im Buchungstext', () => {
    const csv = datevCsv(rows, 2026);
    expect(csv).toContain("IDE ''Lizenz''");
  });
});
