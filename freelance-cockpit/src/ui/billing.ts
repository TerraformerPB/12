import { store, uid, todayISO, addDaysISO } from '../store';
import type { Invoice, LineItem, Quote } from '../types';
import { docTotals, fmtDate, fmtEUR } from '../domain/money';
import { nextDocNumber } from '../domain/numbering';
import { xrechnungXml } from '../domain/xrechnung';
import {
  contactById, contactLabel, createInvoiceFromQuote, createProjectFromQuote,
  currentVatRate, markInvoicePaid, setQuoteStatus,
} from '../actions';
import { documentHtml } from './print';
import {
  badge, confirmModal, dateInput, download, el, emptyHint, field, fieldRow, modal,
  numberInput, openPrintWindow, section, selectInput, table, textArea, textInput, toast,
} from './helpers';

// ---------- Positions-Editor ----------

interface ItemRow {
  description: HTMLInputElement;
  quantity: HTMLInputElement;
  unit: HTMLInputElement;
  unitPrice: HTMLInputElement;
  wrapper: HTMLElement;
}

function itemsEditor(items: LineItem[]): { element: HTMLElement; read: () => LineItem[] } {
  const rows: ItemRow[] = [];
  const list = el('div', {});
  const addRow = (item?: LineItem) => {
    const description = textInput(item?.description ?? '', { placeholder: 'Beschreibung' });
    const quantity = numberInput(item?.quantity ?? 1);
    const unit = textInput(item?.unit ?? 'Std.');
    const unitPrice = numberInput(item?.unitPrice ?? store.state.settings.defaultHourlyRate);
    const wrapper = el(
      'div', { class: 'field-row' },
      el('div', { class: 'field', style: 'flex:3' }, description),
      el('div', { class: 'field', style: 'flex:1' }, quantity),
      el('div', { class: 'field', style: 'flex:1' }, unit),
      el('div', { class: 'field', style: 'flex:1' }, unitPrice),
      el('button', { class: 'btn small danger', onclick: () => { wrapper.remove(); rows.splice(rows.findIndex((r) => r.wrapper === wrapper), 1); } }, '✕'),
    );
    rows.push({ description, quantity, unit, unitPrice, wrapper });
    list.append(wrapper);
  };
  for (const item of items) addRow(item);
  if (!items.length) addRow();
  const element = el(
    'div', {},
    el(
      'div', { class: 'field-row muted' },
      el('span', { style: 'flex:3' }, 'Beschreibung'),
      el('span', { style: 'flex:1' }, 'Menge'),
      el('span', { style: 'flex:1' }, 'Einheit'),
      el('span', { style: 'flex:1' }, 'Einzelpreis €'),
      el('span', {}, ''),
    ),
    list,
    el('button', { class: 'btn small', onclick: () => addRow() }, '+ Position'),
  );
  const read = (): LineItem[] =>
    rows
      .filter((r) => r.description.value.trim())
      .map((r) => ({
        id: uid(),
        description: r.description.value.trim(),
        quantity: parseFloat(r.quantity.value) || 0,
        unit: r.unit.value.trim() || 'Stk.',
        unitPrice: parseFloat(r.unitPrice.value) || 0,
      }));
  return { element, read };
}

function contactOptions(): { value: string; label: string }[] {
  return store.state.contacts.map((c) => ({ value: c.id, label: contactLabel(c.id) }));
}

// ---------- Angebot ----------

function quoteModal(existing?: Quote): void {
  if (!existing && store.state.contacts.length === 0) {
    toast('Bitte zuerst im CRM einen Kontakt anlegen.');
    return;
  }
  const s = store.state.settings;
  const today = todayISO();
  const quote: Quote = existing ?? {
    id: uid(),
    number: nextDocNumber(s.quotePrefix, new Date().getFullYear(), store.state.quotes.map((q) => q.number)),
    contactId: store.state.contacts[0].id,
    date: today,
    validUntil: addDaysISO(today, 30),
    vatRate: currentVatRate(),
    items: [],
    status: 'entwurf',
    notes: '',
  };
  const contact = selectInput(contactOptions(), quote.contactId);
  const date = dateInput(quote.date);
  const validUntil = dateInput(quote.validUntil);
  const notes = textArea(quote.notes, 2);
  const editor = itemsEditor(quote.items);
  modal(existing ? `Angebot ${quote.number} bearbeiten` : `Neues Angebot ${quote.number}`, el(
    'div', {},
    fieldRow(field('Kunde', contact), field('Datum', date), field('Gültig bis', validUntil)),
    editor.element,
    field('Anmerkungen', notes),
    el('p', { class: 'muted' }, quote.vatRate === 0 ? 'Kleinunternehmer: ohne USt. (§19 UStG)' : `zzgl. ${quote.vatRate} % USt.`),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        const items = editor.read();
        if (!items.length) { toast('Mindestens eine Position angeben.'); return; }
        quote.contactId = contact.value;
        quote.date = date.value;
        quote.validUntil = validUntil.value;
        quote.notes = notes.value;
        quote.items = items;
        store.update((st) => {
          if (!existing) st.quotes.push(quote);
        });
        close();
      },
    },
  ]);
}

const QUOTE_STATUS: Record<Quote['status'], { label: string; variant: '' | 'ok' | 'warn' | 'danger' | 'info' }> = {
  entwurf: { label: 'Entwurf', variant: '' },
  versendet: { label: 'Versendet', variant: 'info' },
  angenommen: { label: 'Angenommen', variant: 'ok' },
  abgelehnt: { label: 'Abgelehnt', variant: 'danger' },
};

function quoteActions(q: Quote): HTMLElement {
  const span = el('span', {});
  const add = (label: string, onclick: () => void, cls = 'btn small') =>
    span.append(el('button', { class: cls, onclick }, label), ' ');
  add('Bearbeiten', () => quoteModal(q));
  add('PDF', () => {
    const c = contactById(q.contactId);
    if (c) openPrintWindow(documentHtml('Angebot', q, c, store.state.settings));
  });
  if (q.status === 'entwurf') add('Versendet', () => setQuoteStatus(q.id, 'versendet'));
  if (q.status === 'entwurf' || q.status === 'versendet') {
    add('Angenommen ✓', () => {
      setQuoteStatus(q.id, 'angenommen');
      toast('Angebot angenommen — Lead auf „Won“ gesetzt.');
    }, 'btn small primary');
    add('Abgelehnt', () => setQuoteStatus(q.id, 'abgelehnt'));
  }
  if (q.status === 'angenommen') {
    add('→ Projekt', () => {
      const p = createProjectFromQuote(q);
      toast(`Projekt „${p.name}“ angelegt.`);
    }, 'btn small primary');
    add('→ Rechnung', () => {
      const inv = createInvoiceFromQuote(q);
      toast(`Rechnung ${inv.number} aus Angebot erstellt.`);
    });
  }
  add('Löschen', () => confirmModal(`Angebot ${q.number} löschen?`, () =>
    store.update((s) => { s.quotes = s.quotes.filter((x) => x.id !== q.id); })), 'btn small danger');
  return span;
}

// ---------- Rechnung ----------

function invoiceModal(existing?: Invoice): void {
  if (!existing && store.state.contacts.length === 0) {
    toast('Bitte zuerst im CRM einen Kontakt anlegen.');
    return;
  }
  const s = store.state.settings;
  const today = todayISO();
  const invoice: Invoice = existing ?? {
    id: uid(),
    number: nextDocNumber(s.invoicePrefix, new Date().getFullYear(), store.state.invoices.map((i) => i.number)),
    contactId: store.state.contacts[0].id,
    date: today,
    dueDate: addDaysISO(today, s.paymentTermDays),
    servicePeriod: '',
    vatRate: currentVatRate(),
    items: [],
    status: 'entwurf',
  };
  const contact = selectInput(contactOptions(), invoice.contactId);
  const date = dateInput(invoice.date);
  const dueDate = dateInput(invoice.dueDate);
  const servicePeriod = textInput(invoice.servicePeriod, { placeholder: 'z. B. 01.06.–30.06.2026' });
  const editor = itemsEditor(invoice.items);
  modal(existing ? `Rechnung ${invoice.number} bearbeiten` : `Neue Rechnung ${invoice.number}`, el(
    'div', {},
    fieldRow(field('Kunde', contact), field('Rechnungsdatum', date), field('Zahlbar bis', dueDate)),
    field('Leistungszeitraum', servicePeriod),
    editor.element,
    el('p', { class: 'muted' }, invoice.vatRate === 0 ? 'Kleinunternehmer: ohne USt. (§19 UStG)' : `zzgl. ${invoice.vatRate} % USt.`),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        const items = editor.read();
        if (!items.length) { toast('Mindestens eine Position angeben.'); return; }
        invoice.contactId = contact.value;
        invoice.date = date.value;
        invoice.dueDate = dueDate.value;
        invoice.servicePeriod = servicePeriod.value;
        invoice.items = items;
        store.update((st) => {
          if (!existing) st.invoices.push(invoice);
        });
        close();
      },
    },
  ]);
}

const INVOICE_STATUS: Record<Invoice['status'], { label: string; variant: '' | 'ok' | 'warn' | 'danger' | 'info' }> = {
  entwurf: { label: 'Entwurf', variant: '' },
  versendet: { label: 'Versendet', variant: 'info' },
  bezahlt: { label: 'Bezahlt', variant: 'ok' },
  storniert: { label: 'Storniert', variant: 'danger' },
};

function invoiceActions(inv: Invoice): HTMLElement {
  const span = el('span', {});
  const add = (label: string, onclick: () => void, cls = 'btn small') =>
    span.append(el('button', { class: cls, onclick }, label), ' ');
  if (inv.status === 'entwurf') add('Bearbeiten', () => invoiceModal(inv));
  add('PDF', () => {
    const c = contactById(inv.contactId);
    if (c) openPrintWindow(documentHtml('Rechnung', inv, c, store.state.settings));
  });
  add('XRechnung', () => {
    const c = contactById(inv.contactId);
    if (!c) return;
    download(`${inv.number}-xrechnung.xml`, xrechnungXml(inv, c, store.state.settings), 'application/xml');
    toast('XRechnung (UBL-XML) heruntergeladen.');
  });
  if (inv.status === 'entwurf') add('Versendet', () => store.update((s) => {
    const i = s.invoices.find((x) => x.id === inv.id);
    if (i) i.status = 'versendet';
  }));
  if (inv.status === 'entwurf' || inv.status === 'versendet') {
    add('Bezahlt ✓', () => {
      markInvoicePaid(inv.id, todayISO());
      toast('Als bezahlt markiert — erscheint automatisch in der EÜR.');
    }, 'btn small primary');
    add('Stornieren', () => confirmModal(`Rechnung ${inv.number} stornieren?`, () =>
      store.update((s) => {
        const i = s.invoices.find((x) => x.id === inv.id);
        if (i) i.status = 'storniert';
      })), 'btn small danger');
  }
  return span;
}

// ---------- Hauptansicht ----------

export function renderBilling(root: HTMLElement): void {
  const kleinunternehmer = store.state.settings.kleinunternehmer;
  root.append(
    el('h1', {}, 'Angebote & Rechnungen'),
    el('p', { class: 'subtitle' },
      kleinunternehmer
        ? 'Besteuerung: Kleinunternehmer (§19 UStG) — Belege ohne USt. Umstellbar in den Einstellungen.'
        : `Besteuerung: Regelbesteuerung (${store.state.settings.defaultVatRate} % USt). Umstellbar in den Einstellungen.`),
    el(
      'div', { class: 'toolbar' },
      el('button', { class: 'btn primary', onclick: () => quoteModal() }, '+ Angebot'),
      el('button', { class: 'btn primary', onclick: () => invoiceModal() }, '+ Rechnung'),
    ),
    section(
      'Angebote',
      store.state.quotes.length
        ? table(
            ['Nummer', 'Kunde', 'Datum', 'Netto', 'Status', ''],
            [...store.state.quotes].reverse().map((q) => [
              q.number,
              contactLabel(q.contactId),
              fmtDate(q.date),
              el('span', { class: 'num' }, fmtEUR(docTotals(q.items, q.vatRate).net)),
              badge(QUOTE_STATUS[q.status].label, QUOTE_STATUS[q.status].variant),
              quoteActions(q),
            ]),
          )
        : emptyHint('Noch keine Angebote — per „+ Angebot“ oder direkt aus einem Lead erstellen.'),
    ),
    section(
      'Rechnungen',
      store.state.invoices.length
        ? table(
            ['Nummer', 'Kunde', 'Datum', 'Brutto', 'Status', ''],
            [...store.state.invoices].reverse().map((inv) => [
              inv.number,
              contactLabel(inv.contactId),
              fmtDate(inv.date),
              el('span', { class: 'num' }, fmtEUR(docTotals(inv.items, inv.vatRate).gross)),
              badge(INVOICE_STATUS[inv.status].label, INVOICE_STATUS[inv.status].variant),
              invoiceActions(inv),
            ]),
          )
        : emptyHint('Noch keine Rechnungen — aus Angebot, Projektzeiten oder per „+ Rechnung“ erstellen.'),
    ),
    section(
      'E-Rechnung (Pflicht im B2B seit 2025)',
      el('p', { class: 'muted' },
        'Der Button „XRechnung“ erzeugt eine strukturierte E-Rechnung im XRechnung-Format (UBL 2.1, EN 16931). ' +
        'Damit erfüllst du die B2B-Pflicht zur E-Rechnung. Vor dem produktiven Einsatz beim ersten Kunden das XML ' +
        'einmal mit einem Validator (z. B. dem KoSIT-Validator) gegenprüfen. ZUGFeRD (PDF mit eingebettetem XML) ' +
        'kann alternativ genutzt werden — XRechnung wird von allen Pflicht-Empfängern akzeptiert.'),
    ),
  );
}
