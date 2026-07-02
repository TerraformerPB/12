import { store, uid, todayISO } from '../store';
import type { Milestone, Project, TimeEntry } from '../types';
import { fmtDate, fmtEUR, fmtHours, round2 } from '../domain/money';
import { contactLabel, createInvoiceFromTimeEntries } from '../actions';
import {
  badge, confirmModal, dateInput, el, emptyHint, field, fieldRow, modal,
  numberInput, section, selectInput, table, textArea, textInput, toast,
} from './helpers';

const STATUS_LABEL: Record<Project['status'], string> = {
  aktiv: 'Aktiv',
  pausiert: 'Pausiert',
  abgeschlossen: 'Abgeschlossen',
};

function unbilledEntries(projectId: string): TimeEntry[] {
  return store.state.timeEntries.filter((t) => t.projectId === projectId && !t.invoiceId);
}

// ---------- Projekt-Dialog ----------

function projectModal(existing?: Project): void {
  if (!existing && store.state.contacts.length === 0) {
    toast('Bitte zuerst im CRM einen Kontakt anlegen.');
    return;
  }
  const project: Project = existing ?? {
    id: uid(),
    name: '',
    contactId: store.state.contacts[0].id,
    status: 'aktiv',
    hourlyRate: store.state.settings.defaultHourlyRate,
    milestones: [],
    notes: '',
  };
  const name = textInput(project.name);
  const contact = selectInput(store.state.contacts.map((c) => ({ value: c.id, label: contactLabel(c.id) })), project.contactId);
  const status = selectInput(
    (Object.keys(STATUS_LABEL) as Project['status'][]).map((k) => ({ value: k, label: STATUS_LABEL[k] })),
    project.status,
  );
  const rate = numberInput(project.hourlyRate);
  const notes = textArea(project.notes, 2);
  modal(existing ? 'Projekt bearbeiten' : 'Neues Projekt', el(
    'div', {},
    fieldRow(field('Projektname', name), field('Kunde', contact)),
    fieldRow(field('Status', status), field('Stundensatz €', rate)),
    field('Notizen', notes),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!name.value.trim()) { toast('Projektname fehlt.'); return; }
        project.name = name.value.trim();
        project.contactId = contact.value;
        project.status = status.value as Project['status'];
        project.hourlyRate = parseFloat(rate.value) || 0;
        project.notes = notes.value;
        store.update((s) => {
          if (!existing) s.projects.push(project);
        });
        close();
      },
    },
  ]);
}

// ---------- Meilenstein ----------

function milestoneModal(project: Project, existing?: Milestone): void {
  const ms: Milestone = existing ?? { id: uid(), title: '', dueDate: todayISO(), done: false };
  const title = textInput(ms.title);
  const due = dateInput(ms.dueDate);
  modal(existing ? 'Meilenstein bearbeiten' : 'Neuer Meilenstein', el(
    'div', {},
    fieldRow(field('Titel', title), field('Fällig am', due)),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!title.value.trim()) { toast('Titel fehlt.'); return; }
        ms.title = title.value.trim();
        ms.dueDate = due.value;
        store.update((s) => {
          const p = s.projects.find((x) => x.id === project.id);
          if (p && !existing) p.milestones.push(ms);
        });
        close();
      },
    },
  ]);
}

// ---------- Zeiterfassung ----------

function timeEntryModal(projectId?: string): void {
  const projects = store.state.projects.filter((p) => p.status !== 'abgeschlossen');
  if (!projects.length) { toast('Kein aktives Projekt vorhanden.'); return; }
  const projectSel = selectInput(projects.map((p) => ({ value: p.id, label: p.name })), projectId ?? projects[0].id);
  const date = dateInput(todayISO());
  const hours = numberInput(1, { step: '0.25', min: '0' });
  const description = textInput('', { placeholder: 'Was wurde gemacht?' });
  modal('Zeit erfassen', el(
    'div', {},
    fieldRow(field('Projekt', projectSel), field('Datum', date)),
    fieldRow(field('Stunden', hours), field('Beschreibung', description)),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        const h = parseFloat(hours.value);
        if (!h || h <= 0) { toast('Stunden angeben.'); return; }
        store.update((s) => {
          s.timeEntries.push({
            id: uid(),
            projectId: projectSel.value,
            date: date.value,
            minutes: Math.round(h * 60),
            description: description.value.trim(),
          });
        });
        close();
      },
    },
  ]);
}

// ---------- Projekt-Karte ----------

function projectCard(project: Project): HTMLElement {
  const entries = store.state.timeEntries.filter((t) => t.projectId === project.id);
  const unbilled = unbilledEntries(project.id);
  const totalMin = entries.reduce((s, e) => s + e.minutes, 0);
  const unbilledMin = unbilled.reduce((s, e) => s + e.minutes, 0);
  const unbilledValue = round2((unbilledMin / 60) * project.hourlyRate);

  const milestones = project.milestones.length
    ? table(
        ['', 'Meilenstein', 'Fällig', ''],
        project.milestones.map((m) => {
          const checkbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
          checkbox.checked = m.done;
          checkbox.addEventListener('change', () =>
            store.update((s) => {
              const p = s.projects.find((x) => x.id === project.id);
              const ms = p?.milestones.find((x) => x.id === m.id);
              if (ms) ms.done = checkbox.checked;
            }),
          );
          return [
            checkbox,
            m.done ? el('s', {}, m.title) : m.title,
            fmtDate(m.dueDate),
            el('button', { class: 'btn small danger', onclick: () =>
              store.update((s) => {
                const p = s.projects.find((x) => x.id === project.id);
                if (p) p.milestones = p.milestones.filter((x) => x.id !== m.id);
              }),
            }, '✕'),
          ];
        }),
      )
    : emptyHint('Keine Meilensteine.');

  const timeRows = entries.length
    ? table(
        ['Datum', 'Dauer', 'Beschreibung', 'Status', ''],
        [...entries].reverse().slice(0, 8).map((e) => [
          fmtDate(e.date),
          fmtHours(e.minutes),
          e.description,
          e.invoiceId ? badge('abgerechnet', 'ok') : badge('offen', 'warn'),
          e.invoiceId
            ? ''
            : el('button', { class: 'btn small danger', onclick: () =>
                store.update((s) => { s.timeEntries = s.timeEntries.filter((x) => x.id !== e.id); }),
              }, '✕'),
        ]),
      )
    : emptyHint('Noch keine Zeiten erfasst.');

  return el(
    'section', { class: 'card' },
    el('h2', {}, `${project.name} — ${contactLabel(project.contactId)} `, badge(STATUS_LABEL[project.status], project.status === 'aktiv' ? 'ok' : project.status === 'pausiert' ? 'warn' : 'info')),
    el('p', { class: 'muted' },
      `Stundensatz ${fmtEUR(project.hourlyRate)} · erfasst ${fmtHours(totalMin)} · nicht abgerechnet ${fmtHours(unbilledMin)} (${fmtEUR(unbilledValue)})`),
    el(
      'div', { class: 'toolbar' },
      el('button', { class: 'btn small', onclick: () => projectModal(project) }, 'Bearbeiten'),
      el('button', { class: 'btn small', onclick: () => milestoneModal(project) }, '+ Meilenstein'),
      el('button', { class: 'btn small', onclick: () => timeEntryModal(project.id) }, '+ Zeit'),
      unbilled.length
        ? el('button', { class: 'btn small primary', onclick: () => {
            const inv = createInvoiceFromTimeEntries(project, unbilled);
            toast(`Rechnung ${inv.number} mit ${unbilled.length} Positionen erstellt (Entwurf).`);
          } }, `Zeiten abrechnen → Rechnung (${fmtEUR(unbilledValue)})`)
        : null,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn small danger', onclick: () =>
        confirmModal(`Projekt „${project.name}“ samt Zeiteinträgen löschen?`, () =>
          store.update((s) => {
            s.projects = s.projects.filter((x) => x.id !== project.id);
            s.timeEntries = s.timeEntries.filter((t) => t.projectId !== project.id);
          })),
      }, 'Löschen'),
    ),
    el('h2', {}, 'Meilensteine'),
    milestones,
    el('h2', {}, 'Zeiterfassung (letzte Einträge)'),
    timeRows,
  );
}

export function renderProjects(root: HTMLElement): void {
  root.append(
    el('h1', {}, 'Projekte & Zeiterfassung'),
    el('p', { class: 'subtitle' }, 'Meilensteine, Stunden pro Kunde/Projekt — und daraus direkt Rechnungspositionen.'),
    el(
      'div', { class: 'toolbar' },
      el('button', { class: 'btn primary', onclick: () => projectModal() }, '+ Projekt'),
      el('button', { class: 'btn', onclick: () => timeEntryModal() }, '+ Zeit erfassen'),
    ),
  );
  if (!store.state.projects.length) {
    root.append(section('Projekte', emptyHint('Noch keine Projekte — anlegen oder aus einem angenommenen Angebot erzeugen.')));
    return;
  }
  for (const p of store.state.projects) root.append(projectCard(p));
}
