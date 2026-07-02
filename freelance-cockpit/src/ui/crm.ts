import { store, uid, todayISO } from '../store';
import type { Contact, Lead, LeadStage, OutreachTemplate } from '../types';
import { fmtDate, fmtEUR } from '../domain/money';
import { fillPlaceholders } from '../domain/placeholders';
import { contactById, contactLabel, createQuoteFromLead } from '../actions';
import {
  badge, confirmModal, copyToClipboard, dateInput, el, emptyHint, field, fieldRow,
  modal, numberInput, section, selectInput, table, textArea, textInput, toast,
} from './helpers';

const STAGES: { id: LeadStage; label: string }[] = [
  { id: 'kontakt', label: 'Kontakt' },
  { id: 'erstgespraech', label: 'Erstgespräch' },
  { id: 'angebot', label: 'Angebot' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

export function stageLabel(stage: LeadStage): string {
  return STAGES.find((s) => s.id === stage)?.label ?? stage;
}

function contactOptions(): { value: string; label: string }[] {
  return store.state.contacts.map((c) => ({ value: c.id, label: contactLabel(c.id) }));
}

// ---------- Lead-Dialog ----------

function leadModal(existing?: Lead): void {
  if (!existing && store.state.contacts.length === 0) {
    toast('Bitte zuerst einen Kontakt anlegen.');
    contactModal();
    return;
  }
  const lead: Lead = existing ?? {
    id: uid(),
    contactId: store.state.contacts[0].id,
    title: '',
    value: 0,
    stage: 'kontakt',
    source: '',
    followUpDate: '',
    notes: '',
    createdAt: todayISO(),
  };
  const title = textInput(lead.title);
  const contact = selectInput(contactOptions(), lead.contactId);
  const value = numberInput(lead.value);
  const stage = selectInput(STAGES.map((s) => ({ value: s.id, label: s.label })), lead.stage);
  const source = textInput(lead.source);
  const followUp = dateInput(lead.followUpDate);
  const notes = textArea(lead.notes);
  const body = el(
    'div', {},
    fieldRow(field('Titel', title), field('Kontakt', contact)),
    fieldRow(field('Volumen (€ netto, geschätzt)', value), field('Phase', stage)),
    fieldRow(field('Quelle', source), field('Follow-up am', followUp)),
    field('Notizen', notes),
  );
  modal(existing ? 'Lead bearbeiten' : 'Neuer Lead', body, [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!title.value.trim()) { toast('Titel fehlt.'); return; }
        lead.title = title.value.trim();
        lead.contactId = contact.value;
        lead.value = parseFloat(value.value) || 0;
        lead.stage = stage.value as LeadStage;
        lead.source = source.value.trim();
        lead.followUpDate = followUp.value;
        lead.notes = notes.value;
        store.update((s) => {
          if (!existing) s.leads.push(lead);
        });
        close();
      },
    },
  ]);
}

// ---------- Kontakt-Dialog ----------

export function contactModal(existing?: Contact): void {
  const contact: Contact = existing ?? {
    id: uid(), name: '', company: '', email: '', phone: '', address: '', notes: '', createdAt: todayISO(),
  };
  const name = textInput(contact.name);
  const company = textInput(contact.company);
  const email = textInput(contact.email);
  const phone = textInput(contact.phone);
  const address = textArea(contact.address, 2);
  const notes = textArea(contact.notes, 3);
  const body = el(
    'div', {},
    fieldRow(field('Name', name), field('Firma', company)),
    fieldRow(field('E-Mail', email), field('Telefon', phone)),
    field('Anschrift (Straße / PLZ Ort)', address),
    field('Notizen', notes),
  );
  modal(existing ? 'Kontakt bearbeiten' : 'Neuer Kontakt', body, [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!name.value.trim()) { toast('Name fehlt.'); return; }
        contact.name = name.value.trim();
        contact.company = company.value.trim();
        contact.email = email.value.trim();
        contact.phone = phone.value.trim();
        contact.address = address.value;
        contact.notes = notes.value;
        store.update((s) => {
          if (!existing) s.contacts.push(contact);
        });
        close();
      },
    },
  ]);
}

// ---------- Outreach ----------

function templateModal(existing?: OutreachTemplate): void {
  const tpl: OutreachTemplate = existing ?? { id: uid(), name: '', channel: 'email', subject: '', body: '' };
  const name = textInput(tpl.name);
  const channel = selectInput(
    [{ value: 'email', label: 'Cold Mail' }, { value: 'linkedin', label: 'LinkedIn' }],
    tpl.channel,
  );
  const subject = textInput(tpl.subject);
  const body = textArea(tpl.body, 8);
  modal(existing ? 'Vorlage bearbeiten' : 'Neue Outreach-Vorlage', el(
    'div', {},
    fieldRow(field('Name', name), field('Kanal', channel)),
    field('Betreff (nur E-Mail)', subject),
    field('Text — Platzhalter: {name}, {firma}, {leistung}, {referenz}, {aufhaenger}, {absender}', body),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!name.value.trim()) { toast('Name fehlt.'); return; }
        tpl.name = name.value.trim();
        tpl.channel = channel.value as OutreachTemplate['channel'];
        tpl.subject = subject.value;
        tpl.body = body.value;
        store.update((s) => {
          if (!existing) s.outreachTemplates.push(tpl);
        });
        close();
      },
    },
  ]);
}

function useTemplateModal(tpl: OutreachTemplate): void {
  const contacts = contactOptions();
  const contactSel = selectInput(contacts, contacts[0]?.value ?? '');
  const preview = el('pre', { class: 'doc-preview' });
  const renderPreview = () => {
    const c = contactById(contactSel.value);
    const values: Record<string, string> = {
      name: c?.name ?? '',
      firma: c?.company ?? '',
      absender: store.state.settings.ownerName,
    };
    const subject = tpl.subject ? 'Betreff: ' + fillPlaceholders(tpl.subject, values) + '\n\n' : '';
    preview.textContent = subject + fillPlaceholders(tpl.body, values);
  };
  contactSel.addEventListener('change', renderPreview);
  renderPreview();
  modal('Vorlage verwenden: ' + tpl.name, el(
    'div', {},
    contacts.length ? field('Kontakt', contactSel) : emptyHint('Noch keine Kontakte — Platzhalter bleiben leer.'),
    el('p', { class: 'muted' }, 'Verbleibende {platzhalter} vor dem Versand manuell ersetzen.'),
    preview,
  ), [
    { label: 'Schließen', onClick: (close) => close() },
    { label: 'In Zwischenablage kopieren', primary: true, onClick: () => copyToClipboard(preview.textContent ?? '') },
  ]);
}

// ---------- Kanban ----------

function kanbanBoard(): HTMLElement {
  const board = el('div', { class: 'kanban' });
  const today = todayISO();
  for (const stage of STAGES) {
    const leads = store.state.leads.filter((l) => l.stage === stage.id);
    const col = el('div', { class: 'kanban-col' }, el('h3', {}, `${stage.label} (${leads.length})`));
    col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', (ev) => {
      ev.preventDefault();
      col.classList.remove('dragover');
      const leadId = ev.dataTransfer?.getData('text/lead-id');
      if (!leadId) return;
      store.update((s) => {
        const lead = s.leads.find((l) => l.id === leadId);
        if (lead) lead.stage = stage.id;
      });
    });
    for (const lead of leads) {
      const followUpBadge = lead.followUpDate
        ? badge('Follow-up ' + fmtDate(lead.followUpDate), lead.followUpDate < today ? 'danger' : lead.followUpDate === today ? 'warn' : 'info')
        : null;
      const card = el(
        'div', { class: 'kanban-card', draggable: true },
        el('div', { class: 'lead-title' }, lead.title),
        el('div', { class: 'lead-meta' }, `${contactLabel(lead.contactId)}${lead.value ? ' · ' + fmtEUR(lead.value) : ''}${lead.source ? ' · ' + lead.source : ''}`),
        followUpBadge,
        el(
          'div', { class: 'lead-actions' },
          el('button', { class: 'btn small', onclick: () => leadModal(lead) }, 'Bearbeiten'),
          stage.id !== 'won' && stage.id !== 'lost'
            ? el('button', { class: 'btn small primary', onclick: () => {
                const q = createQuoteFromLead(lead);
                toast(`Angebot ${q.number} erstellt — unter „Angebote & Rechnungen“ ausarbeiten.`);
              } }, '→ Angebot')
            : null,
          el('button', { class: 'btn small danger', onclick: () =>
            confirmModal(`Lead „${lead.title}“ löschen?`, () =>
              store.update((s) => { s.leads = s.leads.filter((l) => l.id !== lead.id); })),
          }, 'Löschen'),
        ),
      );
      card.addEventListener('dragstart', (ev) => ev.dataTransfer?.setData('text/lead-id', lead.id));
      col.append(card);
    }
    board.append(col);
  }
  return board;
}

// ---------- Follow-ups ----------

export function dueFollowUps(): Lead[] {
  const today = todayISO();
  return store.state.leads
    .filter((l) => l.followUpDate && l.followUpDate <= today && l.stage !== 'won' && l.stage !== 'lost')
    .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
}

function followUpSection(): HTMLElement {
  const due = dueFollowUps();
  if (!due.length) return section('Fällige Follow-ups', emptyHint('Nichts fällig — alles im grünen Bereich.'));
  return section(
    'Fällige Follow-ups',
    table(
      ['Fällig am', 'Lead', 'Kontakt', 'Phase', ''],
      due.map((l) => [
        badge(fmtDate(l.followUpDate), 'danger'),
        l.title,
        contactLabel(l.contactId),
        stageLabel(l.stage),
        el('button', { class: 'btn small', onclick: () => leadModal(l) }, 'Öffnen'),
      ]),
    ),
  );
}

// ---------- Hauptansicht ----------

export function renderCrm(root: HTMLElement): void {
  root.append(
    el('h1', {}, 'CRM & Kundengewinnung'),
    el('p', { class: 'subtitle' }, 'Lead-Pipeline, Kontakte, Follow-ups und Outreach-Vorlagen.'),
    el(
      'div', { class: 'toolbar' },
      el('button', { class: 'btn primary', onclick: () => leadModal() }, '+ Lead'),
      el('button', { class: 'btn', onclick: () => contactModal() }, '+ Kontakt'),
      el('button', { class: 'btn', onclick: () => templateModal() }, '+ Outreach-Vorlage'),
    ),
    section('Pipeline', kanbanBoard()),
    followUpSection(),
    section(
      'Kontakte',
      store.state.contacts.length
        ? table(
            ['Name', 'Firma', 'E-Mail', 'Telefon', ''],
            store.state.contacts.map((c) => [
              c.name,
              c.company,
              c.email,
              c.phone,
              el(
                'span', {},
                el('button', { class: 'btn small', onclick: () => contactModal(c) }, 'Bearbeiten'),
                ' ',
                el('button', { class: 'btn small danger', onclick: () =>
                  confirmModal(`Kontakt „${c.name}“ löschen? Zugehörige Leads bleiben bestehen.`, () =>
                    store.update((s) => { s.contacts = s.contacts.filter((x) => x.id !== c.id); })),
                }, 'Löschen'),
              ),
            ]),
          )
        : emptyHint('Noch keine Kontakte.'),
    ),
    section(
      'Outreach-Vorlagen (Cold Mail & LinkedIn)',
      table(
        ['Name', 'Kanal', ''],
        store.state.outreachTemplates.map((t) => [
          t.name,
          badge(t.channel === 'email' ? 'E-Mail' : 'LinkedIn', t.channel === 'email' ? 'info' : 'ok'),
          el(
            'span', {},
            el('button', { class: 'btn small primary', onclick: () => useTemplateModal(t) }, 'Verwenden'),
            ' ',
            el('button', { class: 'btn small', onclick: () => templateModal(t) }, 'Bearbeiten'),
            ' ',
            el('button', { class: 'btn small danger', onclick: () =>
              confirmModal(`Vorlage „${t.name}“ löschen?`, () =>
                store.update((s) => { s.outreachTemplates = s.outreachTemplates.filter((x) => x.id !== t.id); })),
            }, 'Löschen'),
          ),
        ]),
      ),
    ),
  );
}
