import { describe, expect, it } from 'vitest';
import { xrechnungXml } from '../src/domain/xrechnung';
import { initialState } from '../src/seed';
import type { Contact, Invoice } from '../src/types';

const contact: Contact = {
  id: 'c1', name: 'Julia Berger', company: 'Berger & Söhne GmbH',
  email: 'jb@example.com', phone: '', address: 'Lagerweg 12\n80331 München',
  notes: '', createdAt: '2026-01-01',
};

const invoice: Invoice = {
  id: 'i1', number: 'R-2026-042', contactId: 'c1',
  date: '2026-06-01', dueDate: '2026-06-15', servicePeriod: 'Mai 2026',
  vatRate: 19,
  items: [{ id: 'p1', description: 'Entwicklung <Modul A> & Tests', quantity: 8, unit: 'Std.', unitPrice: 95 }],
  status: 'versendet',
};

describe('XRechnung (UBL)', () => {
  it('enthält Pflichtangaben und XRechnung-3.0-CustomizationID', () => {
    const xml = xrechnungXml(invoice, contact, initialState().settings);
    expect(xml).toContain('xrechnung_3.0');
    expect(xml).toContain('<cbc:ID>R-2026-042</cbc:ID>');
    expect(xml).toContain('<cbc:IssueDate>2026-06-01</cbc:IssueDate>');
    expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">904.40</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="EUR">144.40</cbc:TaxAmount>');
  });

  it('escapt XML-Sonderzeichen in Freitexten', () => {
    const xml = xrechnungXml(invoice, contact, initialState().settings);
    expect(xml).toContain('Entwicklung &lt;Modul A&gt; &amp; Tests');
    expect(xml).toContain('Berger &amp; Söhne GmbH');
    expect(xml).not.toContain('<Modul A>');
  });

  it('weist Kleinunternehmer als steuerbefreit (Kategorie E) aus', () => {
    const xml = xrechnungXml({ ...invoice, vatRate: 0 }, contact, initialState().settings);
    expect(xml).toContain('<cbc:ID>E</cbc:ID>');
    expect(xml).toContain('§19 UStG');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">760.00</cbc:PayableAmount>');
  });

  it('zerlegt die Anschrift in Straße/PLZ/Ort', () => {
    const xml = xrechnungXml(invoice, contact, initialState().settings);
    expect(xml).toContain('<cbc:StreetName>Lagerweg 12</cbc:StreetName>');
    expect(xml).toContain('<cbc:PostalZone>80331</cbc:PostalZone>');
    expect(xml).toContain('<cbc:CityName>München</cbc:CityName>');
  });
});
