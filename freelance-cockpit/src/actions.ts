import { store, uid, todayISO, addDaysISO } from './store';
import type { Contact, Invoice, Lead, Project, Quote, TimeEntry } from './types';
import { nextDocNumber } from './domain/numbering';
import { round2 } from './domain/money';

// Modulübergreifende Aktionen — hier steckt die Verzahnung:
// Kontaktformular → Lead → Angebot → Projekt → Zeiterfassung → Rechnung → EÜR.

export function contactById(id: string): Contact | undefined {
  return store.state.contacts.find((c) => c.id === id);
}

export function contactLabel(id: string): string {
  const c = contactById(id);
  if (!c) return '—';
  return c.company ? `${c.company} (${c.name})` : c.name;
}

/** Aktueller Steuersatz für neue Belege (0 bei Kleinunternehmer §19 UStG). */
export function currentVatRate(): number {
  const s = store.state.settings;
  return s.kleinunternehmer ? 0 : s.defaultVatRate;
}

// ---------- Website → CRM ----------

export function createLeadFromWebsiteForm(input: {
  name: string;
  email: string;
  company: string;
  message: string;
}): Lead {
  const today = todayISO();
  let lead!: Lead;
  store.update((s) => {
    let contact = s.contacts.find((c) => c.email && c.email.toLowerCase() === input.email.toLowerCase());
    if (!contact) {
      contact = {
        id: uid(),
        name: input.name,
        company: input.company,
        email: input.email,
        phone: '',
        address: '',
        notes: 'Kontakt über Website-Formular angelegt.',
        createdAt: today,
      };
      s.contacts.push(contact);
    }
    lead = {
      id: uid(),
      contactId: contact.id,
      title: input.message.slice(0, 60) || 'Anfrage über Website',
      value: 0,
      stage: 'kontakt',
      source: 'Website',
      followUpDate: addDaysISO(today, 2),
      notes: input.message,
      createdAt: today,
    };
    s.leads.push(lead);
  });
  return lead;
}

// ---------- Lead → Angebot ----------

export function createQuoteFromLead(lead: Lead): Quote {
  const s = store.state.settings;
  const today = todayISO();
  const year = new Date().getFullYear();
  const quote: Quote = {
    id: uid(),
    number: nextDocNumber(s.quotePrefix, year, store.state.quotes.map((q) => q.number)),
    contactId: lead.contactId,
    leadId: lead.id,
    date: today,
    validUntil: addDaysISO(today, 30),
    vatRate: currentVatRate(),
    items: [
      {
        id: uid(),
        description: lead.title,
        quantity: lead.value > 0 ? round2(lead.value / s.defaultHourlyRate) : 1,
        unit: 'Std.',
        unitPrice: s.defaultHourlyRate,
      },
    ],
    status: 'entwurf',
    notes: '',
  };
  store.update((st) => {
    st.quotes.push(quote);
    const l = st.leads.find((x) => x.id === lead.id);
    if (l) l.stage = 'angebot';
  });
  return quote;
}

// ---------- Angebot → Won/Lost + Projekt ----------

export function setQuoteStatus(quoteId: string, status: Quote['status']): void {
  store.update((s) => {
    const q = s.quotes.find((x) => x.id === quoteId);
    if (!q) return;
    q.status = status;
    if (q.leadId) {
      const lead = s.leads.find((l) => l.id === q.leadId);
      if (lead) {
        if (status === 'angenommen') lead.stage = 'won';
        else if (status === 'abgelehnt') lead.stage = 'lost';
      }
    }
  });
}

export function createProjectFromQuote(quote: Quote): Project {
  const project: Project = {
    id: uid(),
    name: quote.items[0]?.description || `Projekt zu ${quote.number}`,
    contactId: quote.contactId,
    quoteId: quote.id,
    status: 'aktiv',
    hourlyRate: store.state.settings.defaultHourlyRate,
    milestones: [],
    notes: `Aus Angebot ${quote.number} erstellt.`,
  };
  store.update((s) => s.projects.push(project));
  return project;
}

// ---------- Angebot / Zeiterfassung → Rechnung ----------

function newInvoiceBase(contactId: string): Invoice {
  const s = store.state.settings;
  const today = todayISO();
  const year = new Date().getFullYear();
  return {
    id: uid(),
    number: nextDocNumber(s.invoicePrefix, year, store.state.invoices.map((i) => i.number)),
    contactId,
    date: today,
    dueDate: addDaysISO(today, s.paymentTermDays),
    servicePeriod: '',
    vatRate: currentVatRate(),
    items: [],
    status: 'entwurf',
  };
}

export function createInvoiceFromQuote(quote: Quote): Invoice {
  const invoice = newInvoiceBase(quote.contactId);
  invoice.quoteId = quote.id;
  invoice.items = quote.items.map((i) => ({ ...i, id: uid() }));
  store.update((s) => s.invoices.push(invoice));
  return invoice;
}

/** Erzeugt aus nicht abgerechneten Zeiteinträgen Rechnungspositionen. */
export function createInvoiceFromTimeEntries(project: Project, entries: TimeEntry[]): Invoice {
  const invoice = newInvoiceBase(project.contactId);
  invoice.projectId = project.id;
  const dates = entries.map((e) => e.date).sort();
  if (dates.length) invoice.servicePeriod = `${dates[0]} bis ${dates[dates.length - 1]}`;
  invoice.items = entries.map((e) => ({
    id: uid(),
    description: `${e.date} — ${e.description || 'Projektarbeit'} (${project.name})`,
    quantity: round2(e.minutes / 60),
    unit: 'Std.',
    unitPrice: project.hourlyRate,
  }));
  store.update((s) => {
    s.invoices.push(invoice);
    for (const e of entries) {
      const entry = s.timeEntries.find((t) => t.id === e.id);
      if (entry) entry.invoiceId = invoice.id;
    }
  });
  return invoice;
}

// ---------- Rechnung → EÜR ----------

/** „Bezahlt“ genügt: die EÜR liest bezahlte Rechnungen automatisch als Einnahme. */
export function markInvoicePaid(invoiceId: string, paidDate: string): void {
  store.update((s) => {
    const inv = s.invoices.find((i) => i.id === invoiceId);
    if (inv) {
      inv.status = 'bezahlt';
      inv.paidDate = paidDate;
    }
  });
}
