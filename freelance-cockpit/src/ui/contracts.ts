import { store, uid, todayISO } from '../store';
import type { ContractTemplate, StoredDocument } from '../types';
import { fmtDate } from '../domain/money';
import { fillPlaceholders } from '../domain/placeholders';
import { contactById, contactLabel } from '../actions';
import {
  badge, confirmModal, copyToClipboard, download, el, emptyHint, field, fieldRow,
  modal, section, selectInput, table, textArea, textInput, toast,
} from './helpers';

function templateModal(existing?: ContractTemplate): void {
  const tpl: ContractTemplate = existing ?? { id: uid(), name: '', kind: 'sonstiges', body: '' };
  const name = textInput(tpl.name);
  const kind = selectInput(
    [
      { value: 'dienstvertrag', label: 'Dienstvertrag' },
      { value: 'werkvertrag', label: 'Werkvertrag' },
      { value: 'avv', label: 'AV-Vertrag (DSGVO)' },
      { value: 'nda', label: 'NDA' },
      { value: 'sonstiges', label: 'Sonstiges' },
    ],
    tpl.kind,
  );
  const body = textArea(tpl.body, 14);
  modal(existing ? 'Vorlage bearbeiten' : 'Neue Vertragsvorlage', el(
    'div', {},
    fieldRow(field('Name', name), field('Typ', kind)),
    field('Text — Platzhalter: {auftraggeber}, {auftragnehmer}, {projekt}, {stundensatz}, {ort}, {datum} …', body),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!name.value.trim()) { toast('Name fehlt.'); return; }
        tpl.name = name.value.trim();
        tpl.kind = kind.value as ContractTemplate['kind'];
        tpl.body = body.value;
        store.update((s) => {
          if (!existing) s.contractTemplates.push(tpl);
        });
        close();
      },
    },
  ]);
}

/** Vorlage mit Kundendaten füllen und als Dokument beim Kunden ablegen. */
function generateModal(tpl: ContractTemplate): void {
  const contacts = store.state.contacts.map((c) => ({ value: c.id, label: contactLabel(c.id) }));
  if (!contacts.length) { toast('Bitte zuerst im CRM einen Kontakt anlegen.'); return; }
  const contactSel = selectInput(contacts, contacts[0].value);
  const project = textInput('', { placeholder: 'Projekt / Gegenstand' });
  const preview = el('pre', { class: 'doc-preview' });
  const s = store.state.settings;

  const buildText = (): string => {
    const c = contactById(contactSel.value);
    const values: Record<string, string> = {
      auftraggeber: c ? `${c.company || c.name}${c.address ? ', ' + c.address.replace(/\n/g, ', ') : ''}` : '',
      auftragnehmer: `${s.companyName || s.ownerName}, ${s.address.replace(/\n/g, ', ')}`,
      projekt: project.value,
      leistung: project.value,
      stundensatz: String(s.defaultHourlyRate),
      ort: s.address.split('\n')[1]?.replace(/^\d+\s*/, '') ?? '',
      datum: fmtDate(todayISO()),
      beginn: fmtDate(todayISO()),
    };
    return fillPlaceholders(tpl.body, values);
  };
  const renderPreview = () => { preview.textContent = buildText(); };
  contactSel.addEventListener('change', renderPreview);
  project.addEventListener('input', renderPreview);
  renderPreview();

  modal('Vertrag erstellen: ' + tpl.name, el(
    'div', {},
    fieldRow(field('Kunde', contactSel), field('Projekt', project)),
    el('p', { class: 'muted' }, 'Verbleibende {platzhalter} nach der Ablage im Dokument ausfüllen.'),
    preview,
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    { label: 'Kopieren', onClick: () => copyToClipboard(buildText()) },
    {
      label: 'Beim Kunden ablegen',
      primary: true,
      onClick: (close) => {
        const c = contactById(contactSel.value);
        const doc: StoredDocument = {
          id: uid(),
          contactId: contactSel.value,
          name: `${tpl.name} — ${c?.company || c?.name || ''}`,
          kind: tpl.kind,
          content: buildText(),
          createdAt: todayISO(),
        };
        store.update((st) => st.documents.push(doc));
        toast('Dokument abgelegt.');
        close();
      },
    },
  ]);
}

function viewDocument(doc: StoredDocument): void {
  const content = textArea(doc.content, 18);
  modal(doc.name, el('div', {}, content), [
    { label: 'Schließen', onClick: (close) => close() },
    { label: 'Als .txt herunterladen', onClick: () => download(doc.name.replace(/[^\wäöüß -]/gi, '') + '.txt', content.value, 'text/plain;charset=utf-8') },
    {
      label: 'Änderungen speichern',
      primary: true,
      onClick: (close) => {
        store.update((s) => {
          const d = s.documents.find((x) => x.id === doc.id);
          if (d) d.content = content.value;
        });
        close();
      },
    },
  ]);
}

const KIND_LABEL: Record<string, string> = {
  dienstvertrag: 'Dienstvertrag',
  werkvertrag: 'Werkvertrag',
  avv: 'AV-Vertrag',
  nda: 'NDA',
  sonstiges: 'Sonstiges',
};

export function renderContracts(root: HTMLElement): void {
  root.append(
    el('h1', {}, 'Verträge & Dokumente'),
    el('p', { class: 'subtitle' }, 'Vorlagen (Dienstvertrag, Werkvertrag, AV-Vertrag, NDA) und Ablage pro Kunde. Muster ohne Gewähr — im Zweifel juristisch prüfen lassen.'),
    el(
      'div', { class: 'toolbar' },
      el('button', { class: 'btn primary', onclick: () => templateModal() }, '+ Vorlage'),
    ),
    section(
      'Vertragsvorlagen',
      table(
        ['Name', 'Typ', ''],
        store.state.contractTemplates.map((t) => [
          t.name,
          badge(KIND_LABEL[t.kind] ?? t.kind, 'info'),
          el(
            'span', {},
            el('button', { class: 'btn small primary', onclick: () => generateModal(t) }, 'Für Kunden erstellen'),
            ' ',
            el('button', { class: 'btn small', onclick: () => templateModal(t) }, 'Bearbeiten'),
            ' ',
            el('button', { class: 'btn small danger', onclick: () =>
              confirmModal(`Vorlage „${t.name}“ löschen?`, () =>
                store.update((s) => { s.contractTemplates = s.contractTemplates.filter((x) => x.id !== t.id); })),
            }, 'Löschen'),
          ),
        ]),
      ),
    ),
    section(
      'Dokumentenablage (pro Kunde)',
      store.state.documents.length
        ? table(
            ['Erstellt', 'Dokument', 'Kunde', 'Typ', ''],
            [...store.state.documents].reverse().map((d) => [
              fmtDate(d.createdAt),
              d.name,
              d.contactId ? contactLabel(d.contactId) : '—',
              badge(KIND_LABEL[d.kind] ?? d.kind),
              el(
                'span', {},
                el('button', { class: 'btn small', onclick: () => viewDocument(d) }, 'Öffnen'),
                ' ',
                el('button', { class: 'btn small danger', onclick: () =>
                  confirmModal(`Dokument „${d.name}“ löschen?`, () =>
                    store.update((s) => { s.documents = s.documents.filter((x) => x.id !== d.id); })),
                }, 'Löschen'),
              ),
            ]),
          )
        : emptyHint('Noch keine Dokumente abgelegt — über „Für Kunden erstellen“ aus einer Vorlage erzeugen.'),
    ),
  );
}
