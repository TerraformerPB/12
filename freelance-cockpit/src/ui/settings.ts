import { store } from '../store';
import { el, field, fieldRow, numberInput, section, textArea, textInput, toast } from './helpers';

export function renderSettings(root: HTMLElement): void {
  const s = store.state.settings;
  const ownerName = textInput(s.ownerName);
  const companyName = textInput(s.companyName);
  const address = textArea(s.address, 2);
  const email = textInput(s.email);
  const phone = textInput(s.phone);
  const taxNumber = textInput(s.taxNumber);
  const vatId = textInput(s.vatId, { placeholder: 'DE123456789 (optional)' });
  const iban = textInput(s.iban);
  const bic = textInput(s.bic);
  const bank = textInput(s.bank);
  const hourlyRate = numberInput(s.defaultHourlyRate);
  const vatRate = numberInput(s.defaultVatRate);
  const paymentTerm = numberInput(s.paymentTermDays, { step: '1' });
  const quotePrefix = textInput(s.quotePrefix);
  const invoicePrefix = textInput(s.invoicePrefix);

  const kuToggle = el('input', { type: 'checkbox' }) as HTMLInputElement;
  kuToggle.checked = s.kleinunternehmer;

  root.append(
    el('h1', {}, 'Einstellungen'),
    el('p', { class: 'subtitle' }, 'Stammdaten für Angebote, Rechnungen, XRechnung, Verträge und Rechtstexte.'),
    section(
      'Besteuerung',
      el(
        'label', { style: 'display:flex;gap:10px;align-items:center;cursor:pointer' },
        kuToggle,
        el('span', {}, 'Kleinunternehmer nach §19 UStG (keine USt auf Belegen, keine USt-Voranmeldung)'),
      ),
      el('p', { class: 'muted' }, 'Gilt für neue Belege — bestehende Angebote/Rechnungen behalten ihren Steuersatz.'),
      fieldRow(field('USt-Satz bei Regelbesteuerung (%)', vatRate)),
    ),
    section(
      'Stammdaten',
      fieldRow(field('Inhaber/in', ownerName), field('Firmierung', companyName)),
      field('Anschrift (Straße / PLZ Ort)', address),
      fieldRow(field('E-Mail', email), field('Telefon', phone)),
      fieldRow(field('Steuernummer', taxNumber), field('USt-IdNr.', vatId)),
    ),
    section(
      'Bankverbindung',
      fieldRow(field('IBAN', iban), field('BIC', bic), field('Bank', bank)),
    ),
    section(
      'Belege',
      fieldRow(
        field('Standard-Stundensatz €', hourlyRate),
        field('Zahlungsziel (Tage)', paymentTerm),
        field('Angebots-Präfix', quotePrefix),
        field('Rechnungs-Präfix', invoicePrefix),
      ),
    ),
    el('button', { class: 'btn primary', onclick: () => {
      store.update((st) => {
        const set = st.settings;
        set.ownerName = ownerName.value.trim();
        set.companyName = companyName.value.trim();
        set.address = address.value;
        set.email = email.value.trim();
        set.phone = phone.value.trim();
        set.taxNumber = taxNumber.value.trim();
        set.vatId = vatId.value.trim();
        set.iban = iban.value.trim();
        set.bic = bic.value.trim();
        set.bank = bank.value.trim();
        set.kleinunternehmer = kuToggle.checked;
        set.defaultVatRate = parseFloat(vatRate.value) || 19;
        set.defaultHourlyRate = parseFloat(hourlyRate.value) || 0;
        set.paymentTermDays = parseInt(paymentTerm.value, 10) || 14;
        set.quotePrefix = quotePrefix.value.trim() || 'A';
        set.invoicePrefix = invoicePrefix.value.trim() || 'R';
      });
      toast('Einstellungen gespeichert.');
    } }, 'Speichern'),
  );
}
