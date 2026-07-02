import { store, uid, todayISO } from '../store';
import type { Expense, IncomeEntry } from '../types';
import { fmtDate, fmtEUR } from '../domain/money';
import { bookingRows, euerSummary, ustvaQuarters } from '../domain/euer';
import { datevCsv } from '../domain/datev';
import {
  badge, confirmModal, dateInput, download, el, emptyHint, field, fieldRow, modal,
  numberInput, section, selectInput, table, textInput, toast,
} from './helpers';

const EXPENSE_CATEGORIES = [
  'Software', 'Hardware', 'Hosting/Server', 'Telefon/Internet', 'Fortbildung',
  'Reisekosten', 'Versicherungen', 'Büro', 'Fremdleistungen', 'Sonstige Ausgaben',
];

let selectedYear = new Date().getFullYear();

function expenseModal(existing?: Expense): void {
  const ex: Expense = existing ?? {
    id: uid(), date: todayISO(), description: '', category: EXPENSE_CATEGORIES[0],
    netAmount: 0, vatRate: store.state.settings.defaultVatRate,
  };
  const date = dateInput(ex.date);
  const description = textInput(ex.description);
  const category = selectInput(EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })), ex.category);
  const net = numberInput(ex.netAmount);
  const vat = selectInput(
    [{ value: '19', label: '19 %' }, { value: '7', label: '7 %' }, { value: '0', label: '0 % / keine' }],
    String(ex.vatRate),
  );
  modal(existing ? 'Ausgabe bearbeiten' : 'Neue Ausgabe', el(
    'div', {},
    fieldRow(field('Datum', date), field('Kategorie', category)),
    field('Beschreibung', description),
    fieldRow(field('Netto €', net), field('Vorsteuer', vat)),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!description.value.trim()) { toast('Beschreibung fehlt.'); return; }
        ex.date = date.value;
        ex.description = description.value.trim();
        ex.category = category.value;
        ex.netAmount = parseFloat(net.value) || 0;
        ex.vatRate = parseFloat(vat.value) || 0;
        store.update((s) => {
          if (!existing) s.expenses.push(ex);
        });
        close();
      },
    },
  ]);
}

function incomeModal(): void {
  const date = dateInput(todayISO());
  const description = textInput('', { placeholder: 'z. B. Zinsen, Verkauf Gebrauchtgerät' });
  const net = numberInput(0);
  const vat = selectInput(
    [{ value: '19', label: '19 %' }, { value: '7', label: '7 %' }, { value: '0', label: '0 % / keine' }],
    store.state.settings.kleinunternehmer ? '0' : '19',
  );
  modal('Sonstige Einnahme (ohne Rechnung)', el(
    'div', {},
    el('p', { class: 'muted' }, 'Bezahlte Rechnungen landen automatisch in der EÜR — hier nur Einnahmen ohne Rechnung erfassen.'),
    fieldRow(field('Datum', date), field('Netto €', net), field('USt', vat)),
    field('Beschreibung', description),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!description.value.trim()) { toast('Beschreibung fehlt.'); return; }
        const entry: IncomeEntry = {
          id: uid(), date: date.value, description: description.value.trim(),
          netAmount: parseFloat(net.value) || 0, vatRate: parseFloat(vat.value) || 0,
        };
        store.update((s) => s.incomes.push(entry));
        close();
      },
    },
  ]);
}

export function renderFinance(root: HTMLElement): void {
  const s = store.state;
  const rows = bookingRows(s.invoices, s.incomes, s.expenses, selectedYear);
  const summary = euerSummary(rows);
  const quarters = ustvaQuarters(rows);

  const years: number[] = [];
  for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 5; y--) years.push(y);
  const yearSel = selectInput(years.map((y) => ({ value: String(y), label: String(y) })), String(selectedYear));
  yearSel.addEventListener('change', () => {
    selectedYear = parseInt(yearSel.value, 10);
    document.dispatchEvent(new CustomEvent('rerender'));
  });
  yearSel.style.width = 'auto';

  const kpis = el(
    'div', { class: 'kpi-grid' },
    kpi('Betriebseinnahmen (netto)', fmtEUR(summary.incomeNet)),
    kpi('Betriebsausgaben (netto)', fmtEUR(summary.expenseNet)),
    kpi('Gewinn (EÜR)', fmtEUR(summary.profit)),
    kpi('USt-Zahllast', s.settings.kleinunternehmer ? 'entfällt (§19)' : fmtEUR(summary.vatDue)),
  );

  const ustvaSection = s.settings.kleinunternehmer
    ? section('USt-Voranmeldung', el('p', { class: 'muted' },
        'Als Kleinunternehmer (§19 UStG) entfällt die Umsatzsteuer-Voranmeldung. ' +
        'Umsatzgrenzen im Blick behalten (25.000 € Vorjahr / 100.000 € laufendes Jahr, Stand 2025).'))
    : section(
        'USt-Voranmeldung — Vorbereitung ' + selectedYear,
        el('p', { class: 'muted' }, 'Werte je Quartal für ELSTER: vereinnahmte USt, gezahlte Vorsteuer, Zahllast (Ist-Versteuerung).'),
        table(
          ['Quartal', 'USt vereinnahmt', 'Vorsteuer gezahlt', 'Zahllast'],
          quarters.map((q) => [
            `Q${q.quarter}`,
            el('span', { class: 'num' }, fmtEUR(q.vatCollected)),
            el('span', { class: 'num' }, fmtEUR(q.inputTax)),
            el('span', { class: 'num' }, fmtEUR(q.vatDue)),
          ]),
        ),
      );

  root.append(
    el('h1', {}, 'Finanzen / EÜR'),
    el('p', { class: 'subtitle' }, 'Einnahmen-Überschuss-Rechnung, Ausgaben, USt-Voranmeldung und DATEV-Export.'),
    el(
      'div', { class: 'toolbar' },
      el('span', {}, 'Jahr: '),
      yearSel,
      el('button', { class: 'btn primary', onclick: () => expenseModal() }, '+ Ausgabe'),
      el('button', { class: 'btn', onclick: () => incomeModal() }, '+ Sonstige Einnahme'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onclick: () => {
        if (!rows.length) { toast('Keine Buchungen im gewählten Jahr.'); return; }
        download(`datev-buchungsstapel-${selectedYear}.csv`, datevCsv(rows, selectedYear), 'text/csv;charset=utf-8');
        toast('DATEV-Buchungsstapel (CSV) heruntergeladen — fürs Steuerbüro.');
      } }, 'DATEV-Export (CSV)'),
    ),
    kpis,
    section(
      `Buchungen ${selectedYear} (Zufluss/Abfluss)`,
      rows.length
        ? table(
            ['Datum', 'Beschreibung', 'Kategorie', 'Art', 'Netto', 'USt', 'Brutto'],
            rows.map((r) => [
              fmtDate(r.date),
              r.description,
              r.category,
              badge(r.kind === 'einnahme' ? 'Einnahme' : 'Ausgabe', r.kind === 'einnahme' ? 'ok' : 'warn'),
              el('span', { class: 'num' }, fmtEUR(r.net)),
              el('span', { class: 'num' }, fmtEUR(r.vat)),
              el('span', { class: 'num' }, fmtEUR(r.gross)),
            ]),
          )
        : emptyHint('Keine Buchungen — bezahlte Rechnungen erscheinen hier automatisch.'),
    ),
    ustvaSection,
    section(
      'Ausgaben verwalten',
      s.expenses.length
        ? table(
            ['Datum', 'Beschreibung', 'Kategorie', 'Netto', ''],
            [...s.expenses].sort((a, b) => b.date.localeCompare(a.date)).map((ex) => [
              fmtDate(ex.date),
              ex.description,
              ex.category,
              el('span', { class: 'num' }, fmtEUR(ex.netAmount)),
              el(
                'span', {},
                el('button', { class: 'btn small', onclick: () => expenseModal(ex) }, 'Bearbeiten'),
                ' ',
                el('button', { class: 'btn small danger', onclick: () =>
                  confirmModal('Ausgabe löschen?', () =>
                    store.update((st) => { st.expenses = st.expenses.filter((x) => x.id !== ex.id); })),
                }, 'Löschen'),
              ),
            ]),
          )
        : emptyHint('Noch keine Ausgaben erfasst.'),
    ),
  );
}

function kpi(label: string, value: string): HTMLElement {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value' }, value));
}
