import { store, uid, todayISO } from '../store';
import type { Asset, AssetType, BillingInterval } from '../types';
import { fmtDate, fmtEUR } from '../domain/money';
import { cancellationDeadline, monthlyRunningCost, upcomingAlerts } from '../domain/inventory';
import {
  badge, confirmModal, dateInput, el, emptyHint, field, fieldRow, modal,
  numberInput, section, selectInput, table, textArea, textInput, toast,
} from './helpers';

const TYPE_LABEL: Record<AssetType, string> = {
  hardware: 'Hardware',
  lizenz: 'Software-Lizenz',
  domain: 'Domain',
  server: 'Server',
  abo: 'Abo',
};

const INTERVAL_LABEL: Record<BillingInterval, string> = {
  einmalig: 'einmalig',
  monatlich: 'monatlich',
  jaehrlich: 'jährlich',
};

function assetModal(existing?: Asset): void {
  const asset: Asset = existing ?? {
    id: uid(), type: 'abo', name: '', vendor: '', cost: 0,
    interval: 'monatlich', renewalDate: '', cancelPeriodDays: 30, notes: '',
  };
  const type = selectInput((Object.keys(TYPE_LABEL) as AssetType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] })), asset.type);
  const name = textInput(asset.name);
  const vendor = textInput(asset.vendor);
  const cost = numberInput(asset.cost);
  const interval = selectInput(
    (Object.keys(INTERVAL_LABEL) as BillingInterval[]).map((i) => ({ value: i, label: INTERVAL_LABEL[i] })),
    asset.interval,
  );
  const renewal = dateInput(asset.renewalDate ?? '');
  const cancelDays = numberInput(asset.cancelPeriodDays, { step: '1', min: '0' });
  const notes = textArea(asset.notes, 2);
  modal(existing ? 'Eintrag bearbeiten' : 'Neuer Inventar-Eintrag', el(
    'div', {},
    fieldRow(field('Typ', type), field('Name', name), field('Anbieter', vendor)),
    fieldRow(field('Kosten € (netto, je Intervall)', cost), field('Intervall', interval)),
    fieldRow(field('Nächste Verlängerung / Ablauf', renewal), field('Kündigungsfrist (Tage)', cancelDays)),
    field('Notizen', notes),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!name.value.trim()) { toast('Name fehlt.'); return; }
        asset.type = type.value as AssetType;
        asset.name = name.value.trim();
        asset.vendor = vendor.value.trim();
        asset.cost = parseFloat(cost.value) || 0;
        asset.interval = interval.value as BillingInterval;
        asset.renewalDate = renewal.value || undefined;
        asset.cancelPeriodDays = parseInt(cancelDays.value, 10) || 0;
        asset.notes = notes.value;
        store.update((s) => {
          if (!existing) s.assets.push(asset);
        });
        close();
      },
    },
  ]);
}

export function renderAssets(root: HTMLElement): void {
  const assets = store.state.assets;
  const alerts = upcomingAlerts(assets, todayISO(), 30);

  root.append(
    el('h1', {}, 'Inventar & Abos'),
    el('p', { class: 'subtitle' }, 'Hardware, Software-Lizenzen, Domains, Server und Abos — mit Kündigungsfristen-Alerts.'),
    el(
      'div', { class: 'toolbar' },
      el('button', { class: 'btn primary', onclick: () => assetModal() }, '+ Eintrag'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted' }, `Laufende Kosten: ${fmtEUR(monthlyRunningCost(assets))} / Monat`),
    ),
    alerts.length
      ? section(
          'Kündigungsfristen (nächste 30 Tage)',
          table(
            ['Frist endet', 'Eintrag', 'Verlängert am', 'Status'],
            alerts.map((a) => [
              fmtDate(a.deadline),
              `${a.asset.name} (${TYPE_LABEL[a.asset.type]}, ${a.asset.vendor})`,
              fmtDate(a.asset.renewalDate ?? ''),
              a.overdue
                ? badge('Frist verpasst — verlängert sich', 'danger')
                : badge(`noch ${a.daysLeft} Tag(e) kündbar`, a.daysLeft <= 7 ? 'warn' : 'info'),
            ]),
          ),
        )
      : section('Kündigungsfristen', emptyHint('Keine Fristen in den nächsten 30 Tagen.')),
    section(
      'Alle Einträge',
      assets.length
        ? table(
            ['Typ', 'Name', 'Anbieter', 'Kosten', 'Verlängerung', 'Kündbar bis', ''],
            assets.map((a) => {
              const deadline = cancellationDeadline(a);
              return [
                badge(TYPE_LABEL[a.type], 'info'),
                a.name,
                a.vendor,
                `${fmtEUR(a.cost)} ${INTERVAL_LABEL[a.interval]}`,
                a.renewalDate ? fmtDate(a.renewalDate) : '—',
                deadline ? fmtDate(deadline) : '—',
                el(
                  'span', {},
                  el('button', { class: 'btn small', onclick: () => assetModal(a) }, 'Bearbeiten'),
                  ' ',
                  el('button', { class: 'btn small danger', onclick: () =>
                    confirmModal(`„${a.name}“ löschen?`, () =>
                      store.update((s) => { s.assets = s.assets.filter((x) => x.id !== a.id); })),
                  }, 'Löschen'),
                ),
              ];
            }),
          )
        : emptyHint('Noch keine Einträge.'),
    ),
  );
}
