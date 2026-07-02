import { store, todayISO } from '../store';
import { applyDemoData, initialState } from '../seed';
import { docTotals, fmtDate, fmtEUR } from '../domain/money';
import { bookingRows, euerSummary } from '../domain/euer';
import { upcomingAlerts } from '../domain/inventory';
import { contactLabel } from '../actions';
import { dueFollowUps, stageLabel } from './crm';
import { badge, confirmModal, el, emptyHint, section, table, toast } from './helpers';

function kpi(label: string, value: string): HTMLElement {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value' }, value));
}

export function renderDashboard(root: HTMLElement): void {
  const s = store.state;
  const year = new Date().getFullYear();
  const openLeads = s.leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost');
  const pipelineValue = openLeads.reduce((sum, l) => sum + l.value, 0);
  const openInvoices = s.invoices.filter((i) => i.status === 'versendet' || i.status === 'entwurf');
  const openInvoiceSum = openInvoices.reduce((sum, i) => sum + docTotals(i.items, i.vatRate).gross, 0);
  const summary = euerSummary(bookingRows(s.invoices, s.incomes, s.expenses, year));
  const followUps = dueFollowUps();
  const alerts = upcomingAlerts(s.assets, todayISO(), 30);
  const unbilledMinutes = s.timeEntries.filter((t) => !t.invoiceId).reduce((sum, t) => sum + t.minutes, 0);

  const isEmpty =
    !s.contacts.length && !s.leads.length && !s.quotes.length && !s.invoices.length &&
    !s.projects.length && !s.expenses.length && !s.assets.length;

  root.append(
    el('h1', {}, 'Dashboard'),
    el('p', { class: 'subtitle' }, 'Alles ein Datenfluss:'),
    el(
      'div', { class: 'flow', style: 'margin-bottom:18px' },
      ...['Kontaktformular', 'Lead', 'Angebot', 'Projekt', 'Zeiterfassung', 'Rechnung', 'EÜR'].flatMap((step, i) => {
        const chip = el('span', { class: 'flow-step' }, step);
        return i === 0 ? [chip] : ['→', chip];
      }),
    ),
    el(
      'div', { class: 'kpi-grid' },
      kpi('Offene Leads', `${openLeads.length} (${fmtEUR(pipelineValue)})`),
      kpi('Offene Rechnungen', `${openInvoices.length} (${fmtEUR(openInvoiceSum)})`),
      kpi(`Gewinn ${year} (EÜR)`, fmtEUR(summary.profit)),
      kpi('Nicht abgerechnete Zeit', `${Math.round(unbilledMinutes / 6) / 10} h`),
    ),
  );

  if (isEmpty) {
    root.append(
      section(
        'Loslegen',
        el('p', {}, 'Noch keine Daten. Entweder direkt im CRM den ersten Kontakt anlegen — oder mit Demo-Daten den kompletten Datenfluss ausprobieren.'),
        el('button', { class: 'btn primary', onclick: () => {
          store.update((st) => applyDemoData(st));
          toast('Demo-Daten geladen.');
        } }, 'Demo-Daten laden'),
      ),
    );
  }

  root.append(
    section(
      'Fällige Follow-ups',
      followUps.length
        ? table(
            ['Fällig', 'Lead', 'Kontakt', 'Phase'],
            followUps.slice(0, 5).map((l) => [
              badge(fmtDate(l.followUpDate), 'danger'),
              l.title,
              contactLabel(l.contactId),
              stageLabel(l.stage),
            ]),
          )
        : emptyHint('Keine fälligen Follow-ups.'),
    ),
    section(
      'Kündigungsfristen (30 Tage)',
      alerts.length
        ? table(
            ['Frist', 'Eintrag', 'Status'],
            alerts.slice(0, 5).map((a) => [
              fmtDate(a.deadline),
              `${a.asset.name} (${a.asset.vendor})`,
              a.overdue ? badge('verpasst', 'danger') : badge(`${a.daysLeft} Tag(e)`, a.daysLeft <= 7 ? 'warn' : 'info'),
            ]),
          )
        : emptyHint('Keine Fristen in Sicht.'),
    ),
  );

  if (!isEmpty) {
    root.append(
      section(
        'Daten',
        el('p', { class: 'muted' }, 'Alle Daten liegen lokal im Browser (localStorage).'),
        el(
          'div', { class: 'toolbar' },
          el('button', { class: 'btn', onclick: () => {
            const blob = JSON.stringify(store.state, null, 2);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
            a.download = `freelance-cockpit-backup-${todayISO()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          } }, 'Backup exportieren (JSON)'),
          el('button', { class: 'btn danger', onclick: () =>
            confirmModal('Wirklich ALLE Daten löschen und neu starten?', () => {
              store.replace(initialState());
              toast('Zurückgesetzt.');
            }),
          }, 'Alles zurücksetzen'),
        ),
      ),
    );
  }
}
