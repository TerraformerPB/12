import type { Contact, Invoice, Settings } from '../types';
import { docTotals, lineTotal } from './money';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function amt(n: number): string {
  return n.toFixed(2);
}

/**
 * E-Rechnung als XRechnung (UBL 2.1, CustomizationID XRechnung 3.0).
 * Seit 2025 müssen inländische B2B-Rechnungen als E-Rechnung ausgestellt
 * werden können — dieses XML deckt die Pflichtfelder (BT) der EN 16931 ab.
 * Kleinunternehmer (§19 UStG) werden mit Steuerkategorie E und
 * Befreiungsgrund ausgewiesen.
 */
export function xrechnungXml(invoice: Invoice, buyer: Contact, settings: Settings): string {
  const totals = docTotals(invoice.items, invoice.vatRate);
  const isExempt = invoice.vatRate === 0;
  const taxCategory = isExempt ? 'E' : 'S';
  const sellerName = settings.companyName || settings.ownerName;
  const addressLines = settings.address.split('\n').map((l) => l.trim()).filter(Boolean);
  const street = addressLines[0] ?? '';
  const cityLine = addressLines[1] ?? '';
  const zipMatch = /^(\d{4,5})\s+(.*)$/.exec(cityLine);
  const zip = zipMatch ? zipMatch[1] : '';
  const city = zipMatch ? zipMatch[2] : cityLine;

  const buyerAddr = buyer.address.split('\n').map((l) => l.trim()).filter(Boolean);
  const bStreet = buyerAddr[0] ?? '';
  const bCityLine = buyerAddr[1] ?? '';
  const bZipMatch = /^(\d{4,5})\s+(.*)$/.exec(bCityLine);
  const bZip = bZipMatch ? bZipMatch[1] : '';
  const bCity = bZipMatch ? bZipMatch[2] : bCityLine;

  const taxExemption = isExempt
    ? '<cbc:TaxExemptionReason>Gemäß §19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)</cbc:TaxExemptionReason>'
    : '';

  const lines = invoice.items
    .map((item, idx) => {
      return `    <cac:InvoiceLine>
      <cbc:ID>${idx + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">${item.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="EUR">${amt(lineTotal(item))}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${esc(item.description)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${taxCategory}</cbc:ID>
          <cbc:Percent>${amt(invoice.vatRate)}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="EUR">${amt(item.unitPrice)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
    xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
    xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${invoice.date}</cbc:IssueDate>
  <cbc:DueDate>${invoice.dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>${esc(invoice.servicePeriod ? 'Leistungszeitraum: ' + invoice.servicePeriod : 'Rechnung')}</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(buyer.company || buyer.name)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${esc(settings.email)}</cbc:EndpointID>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(street)}</cbc:StreetName>
        <cbc:CityName>${esc(city)}</cbc:CityName>
        <cbc:PostalZone>${esc(zip)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(settings.vatId || settings.taxNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(sellerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>${esc(settings.ownerName)}</cbc:Name>
        <cbc:Telephone>${esc(settings.phone)}</cbc:Telephone>
        <cbc:ElectronicMail>${esc(settings.email)}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${esc(buyer.email)}</cbc:EndpointID>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(bStreet)}</cbc:StreetName>
        <cbc:CityName>${esc(bCity)}</cbc:CityName>
        <cbc:PostalZone>${esc(bZip)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(buyer.company || buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(settings.iban.replace(/\s/g, ''))}</cbc:ID>
      <cbc:Name>${esc(sellerName)}</cbc:Name>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms>
    <cbc:Note>Zahlbar bis ${invoice.dueDate} ohne Abzug.</cbc:Note>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${amt(totals.vat)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${amt(totals.net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${amt(totals.vat)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${taxCategory}</cbc:ID>
        <cbc:Percent>${amt(invoice.vatRate)}</cbc:Percent>
        ${taxExemption}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(totals.net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${amt(totals.net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${amt(totals.gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${amt(totals.gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</ubl:Invoice>
`;
}
