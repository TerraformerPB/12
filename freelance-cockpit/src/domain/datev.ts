import type { BookingRow } from './euer';

function fmtAmount(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

function fmtBelegdatum(iso: string): string {
  // DATEV: TTMM
  return iso.slice(8, 10) + iso.slice(5, 7);
}

function quote(s: string): string {
  return '"' + s.replace(/"/g, "''") + '"';
}

/**
 * Vereinfachter DATEV-Buchungsstapel (EXTF, SKR03) fürs Steuerbüro.
 * Einnahmen: Konto 1200 (Bank) an 8400 (Erlöse), Ausgaben umgekehrt
 * auf 4900 (betriebl. Aufwand). Der Steuerberater mappt die Konten final.
 */
export function datevCsv(rows: BookingRow[], year: number, consultantInfo = ''): string {
  const von = `${year}0101`;
  const bis = `${year}1231`;
  const header = [
    quote('EXTF'), '700', '21', quote('Buchungsstapel'), '13', '', '', '', '', '',
    '', '', '', quote(''), '', '', von, bis, quote(`EÜR ${year}${consultantInfo ? ' ' + consultantInfo : ''}`),
  ].join(';');
  const columns = [
    'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz',
    'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'Belegdatum', 'Belegfeld 1', 'Buchungstext',
  ].join(';');
  const lines = rows.map((r) => {
    const isIncome = r.kind === 'einnahme';
    return [
      fmtAmount(r.gross),
      quote(isIncome ? 'H' : 'S'),
      quote('EUR'),
      '1200',
      isIncome ? '8400' : '4900',
      fmtBelegdatum(r.date),
      quote(''),
      quote(r.description.slice(0, 60)),
    ].join(';');
  });
  return [header, columns, ...lines].join('\r\n') + '\r\n';
}
