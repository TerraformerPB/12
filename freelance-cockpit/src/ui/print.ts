import type { Contact, Invoice, Quote, Settings } from '../types';
import { docTotals, fmtDate, fmtEUR, lineTotal } from '../domain/money';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function nl2br(s: string): string {
  return esc(s).replace(/\n/g, '<br>');
}

/**
 * Druckfertige HTML-Ansicht für Angebot/Rechnung.
 * Über den Browser-Druckdialog als PDF speichern.
 */
export function documentHtml(
  kind: 'Angebot' | 'Rechnung',
  doc: Quote | Invoice,
  contact: Contact,
  settings: Settings,
): string {
  const totals = docTotals(doc.items, doc.vatRate);
  const sellerName = settings.companyName || settings.ownerName;
  const isInvoice = kind === 'Rechnung';
  const inv = doc as Invoice;
  const quote = doc as Quote;

  const rows = doc.items
    .map(
      (i, idx) => `<tr>
        <td>${idx + 1}</td>
        <td>${esc(i.description)}</td>
        <td class="num">${i.quantity.toLocaleString('de-DE')} ${esc(i.unit)}</td>
        <td class="num">${fmtEUR(i.unitPrice)}</td>
        <td class="num">${fmtEUR(lineTotal(i))}</td>
      </tr>`,
    )
    .join('');

  const vatRow =
    doc.vatRate > 0
      ? `<tr><td>zzgl. ${doc.vatRate} % USt.</td><td class="num">${fmtEUR(totals.vat)}</td></tr>`
      : '';
  const kleinunternehmerNote =
    doc.vatRate === 0
      ? '<p class="note">Gemäß §19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).</p>'
      : '';

  const metaRows = [
    `<tr><td>${kind}snummer</td><td>${esc(doc.number)}</td></tr>`,
    `<tr><td>Datum</td><td>${fmtDate(doc.date)}</td></tr>`,
    isInvoice
      ? `<tr><td>Zahlbar bis</td><td>${fmtDate(inv.dueDate)}</td></tr>` +
        (inv.servicePeriod ? `<tr><td>Leistungszeitraum</td><td>${esc(inv.servicePeriod)}</td></tr>` : '')
      : `<tr><td>Gültig bis</td><td>${fmtDate(quote.validUntil)}</td></tr>`,
    settings.taxNumber ? `<tr><td>Steuernummer</td><td>${esc(settings.taxNumber)}</td></tr>` : '',
    settings.vatId ? `<tr><td>USt-IdNr.</td><td>${esc(settings.vatId)}</td></tr>` : '',
  ].join('');

  const outro = isInvoice
    ? `<p>Bitte überweisen Sie den Betrag von <strong>${fmtEUR(totals.gross)}</strong> bis zum ${fmtDate(inv.dueDate)} auf das unten genannte Konto.</p>`
    : `<p>Dieses Angebot ist gültig bis ${fmtDate(quote.validUntil)}. Ich freue mich auf die Zusammenarbeit!</p>`;

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${kind} ${esc(doc.number)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1d2733; margin: 40px auto; max-width: 760px; font-size: 14px; }
  .sender { font-size: 11px; color: #64748b; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin-bottom: 10px; }
  .head { display: flex; justify-content: space-between; margin-bottom: 32px; }
  .meta td { padding: 1px 10px 1px 0; font-size: 13px; }
  .meta td:first-child { color: #64748b; }
  h1 { font-size: 20px; margin: 24px 0 12px; }
  table.items { width: 100%; border-collapse: collapse; margin: 12px 0; }
  table.items th { text-align: left; border-bottom: 2px solid #1d2733; padding: 6px 8px; font-size: 12px; }
  table.items td { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  table.totals { margin-left: auto; margin-top: 8px; }
  table.totals td { padding: 3px 8px; }
  table.totals td:last-child { text-align: right; min-width: 110px; }
  table.totals tr.grand td { border-top: 2px solid #1d2733; font-weight: 700; }
  .note { font-size: 12.5px; color: #475569; }
  footer { margin-top: 48px; border-top: 1px solid #cbd5e1; padding-top: 10px; font-size: 11px; color: #64748b; display: flex; gap: 32px; }
  @media print { body { margin: 0; } }
</style></head><body>
  <div class="head">
    <div>
      <div class="sender">${esc(sellerName)} · ${esc(settings.address.replace(/\n/g, ' · '))}</div>
      <div><strong>${esc(contact.company || contact.name)}</strong><br>
      ${contact.company ? esc(contact.name) + '<br>' : ''}${nl2br(contact.address)}</div>
    </div>
    <table class="meta">${metaRows}</table>
  </div>
  <h1>${kind} ${esc(doc.number)}</h1>
  <table class="items">
    <thead><tr><th>Pos.</th><th>Beschreibung</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Gesamt</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><td>Summe netto</td><td class="num">${fmtEUR(totals.net)}</td></tr>
    ${vatRow}
    <tr class="grand"><td>Gesamtbetrag</td><td class="num">${fmtEUR(totals.gross)}</td></tr>
  </table>
  ${kleinunternehmerNote}
  ${outro}
  ${'notes' in doc && (doc as Quote).notes ? `<p class="note">${nl2br((doc as Quote).notes)}</p>` : ''}
  <footer>
    <div>${esc(sellerName)}<br>${nl2br(settings.address)}</div>
    <div>${esc(settings.email)}<br>${esc(settings.phone)}</div>
    <div>${esc(settings.bank)}<br>IBAN: ${esc(settings.iban)}<br>BIC: ${esc(settings.bic)}</div>
  </footer>
</body></html>`;
}
