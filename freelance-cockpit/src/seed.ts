import type { AppState, ContractTemplate, OutreachTemplate, Settings } from './types';
import { todayISO, uid, addDaysISO } from './util';

function defaultOutreachTemplates(): OutreachTemplate[] {
  return [
    {
      id: uid(),
      name: 'Cold Mail — Erstansprache',
      channel: 'email',
      subject: 'Softwareentwicklung für {firma} — kurze Frage',
      body:
        'Hallo {name},\n\n' +
        'ich bin auf {firma} aufmerksam geworden und habe gesehen, dass ihr {aufhaenger}.\n\n' +
        'Ich unterstütze Unternehmen wie eures als Softwareentwickler bei {leistung} — ' +
        'zuletzt z. B. bei {referenz}.\n\n' +
        'Hätten Sie kommende Woche 20 Minuten für ein kurzes Gespräch, ob ich euch ' +
        'weiterhelfen kann?\n\n' +
        'Viele Grüße\n{absender}',
    },
    {
      id: uid(),
      name: 'Cold Mail — Follow-up',
      channel: 'email',
      subject: 'Re: Softwareentwicklung für {firma}',
      body:
        'Hallo {name},\n\n' +
        'ich wollte kurz nachfassen, ob meine letzte Mail angekommen ist. ' +
        'Falls das Thema {leistung} gerade nicht aktuell ist, freue ich mich über ein kurzes Signal — ' +
        'dann melde ich mich zu einem besseren Zeitpunkt wieder.\n\n' +
        'Viele Grüße\n{absender}',
    },
    {
      id: uid(),
      name: 'LinkedIn — Vernetzungsanfrage',
      channel: 'linkedin',
      subject: '',
      body:
        'Hallo {name}, ich entwickle Software für Unternehmen wie {firma} ' +
        '(Schwerpunkt {leistung}). Ich würde mich gern vernetzen — vielleicht ergibt sich ' +
        'ja ein Anknüpfungspunkt. Viele Grüße, {absender}',
    },
    {
      id: uid(),
      name: 'LinkedIn — Nachricht nach Vernetzung',
      channel: 'linkedin',
      subject: '',
      body:
        'Danke fürs Vernetzen, {name}! Kurz zu mir: Ich unterstütze Teams als ' +
        'Freelance-Entwickler bei {leistung}. Wenn bei {firma} gerade Kapazität fehlt ' +
        'oder ein Projekt ansteht, erzähle ich gern in 15 Minuten, wie ich arbeite. ' +
        'Wann würde es Ihnen passen?',
    },
  ];
}

const MUSTER_HINWEIS =
  'HINWEIS: Unverbindliches Muster, keine Rechtsberatung. Vor Verwendung juristisch prüfen lassen.\n\n';

function defaultContractTemplates(): ContractTemplate[] {
  return [
    {
      id: uid(),
      name: 'Dienstvertrag (Softwareentwicklung)',
      kind: 'dienstvertrag',
      body:
        MUSTER_HINWEIS +
        'DIENSTVERTRAG\n\n' +
        'zwischen\n{auftraggeber} (nachfolgend „Auftraggeber“)\nund\n{auftragnehmer} (nachfolgend „Auftragnehmer“)\n\n' +
        '§ 1 Vertragsgegenstand\nDer Auftragnehmer erbringt für den Auftraggeber Dienstleistungen im Bereich ' +
        'Softwareentwicklung, insbesondere: {leistung}. Ein konkreter Erfolg wird nicht geschuldet.\n\n' +
        '§ 2 Vergütung\nDie Vergütung beträgt {stundensatz} EUR je Stunde zzgl. gesetzlicher Umsatzsteuer. ' +
        'Abrechnung monatlich auf Basis eines Tätigkeitsnachweises, zahlbar innerhalb von 14 Tagen.\n\n' +
        '§ 3 Selbstständigkeit\nDer Auftragnehmer ist in der Gestaltung seiner Tätigkeit frei, unterliegt keinem ' +
        'Weisungsrecht und nutzt eigene Arbeitsmittel. Er ist berechtigt, für weitere Auftraggeber tätig zu sein.\n\n' +
        '§ 4 Vertraulichkeit\nBeide Parteien behandeln vertrauliche Informationen der jeweils anderen Partei geheim, ' +
        'auch über das Vertragsende hinaus.\n\n' +
        '§ 5 Laufzeit und Kündigung\nDer Vertrag beginnt am {beginn} und läuft auf unbestimmte Zeit. ' +
        'Er ist mit einer Frist von 14 Tagen zum Monatsende kündbar.\n\n' +
        '§ 6 Schlussbestimmungen\nÄnderungen bedürfen der Textform. Es gilt deutsches Recht. ' +
        'Gerichtsstand ist der Sitz des Auftragnehmers.\n\n' +
        '{ort}, {datum}\n\n____________________\nAuftraggeber\n\n____________________\nAuftragnehmer',
    },
    {
      id: uid(),
      name: 'Werkvertrag (Projekt mit Abnahme)',
      kind: 'werkvertrag',
      body:
        MUSTER_HINWEIS +
        'WERKVERTRAG\n\n' +
        'zwischen\n{auftraggeber} (nachfolgend „Auftraggeber“)\nund\n{auftragnehmer} (nachfolgend „Auftragnehmer“)\n\n' +
        '§ 1 Werk\nDer Auftragnehmer erstellt für den Auftraggeber folgendes Werk: {projekt}. ' +
        'Maßgeblich ist die als Anlage beigefügte Leistungsbeschreibung/das Angebot {angebotsnummer}.\n\n' +
        '§ 2 Vergütung\nDie Vergütung beträgt pauschal {pauschale} EUR zzgl. gesetzlicher Umsatzsteuer. ' +
        'Zahlungsplan: 50 % bei Beauftragung, 50 % nach Abnahme.\n\n' +
        '§ 3 Mitwirkung\nDer Auftraggeber stellt erforderliche Inhalte, Zugänge und Feedback rechtzeitig bereit. ' +
        'Verzögerungen aus fehlender Mitwirkung verschieben Termine entsprechend.\n\n' +
        '§ 4 Abnahme\nDer Auftraggeber prüft das Werk innerhalb von 14 Tagen nach Bereitstellung. ' +
        'Die Abnahme gilt als erteilt, wenn keine wesentlichen Mängel gerügt werden.\n\n' +
        '§ 5 Nutzungsrechte\nMit vollständiger Zahlung erhält der Auftraggeber die ausschließlichen, zeitlich und ' +
        'räumlich unbeschränkten Nutzungsrechte am Werk. Vorbestehende Komponenten und Open-Source-Bestandteile ' +
        'bleiben ausgenommen.\n\n' +
        '§ 6 Gewährleistung und Haftung\nEs gelten die gesetzlichen Gewährleistungsrechte. Die Haftung für einfache ' +
        'Fahrlässigkeit ist auf den vertragstypischen, vorhersehbaren Schaden begrenzt.\n\n' +
        '{ort}, {datum}\n\n____________________\nAuftraggeber\n\n____________________\nAuftragnehmer',
    },
    {
      id: uid(),
      name: 'AV-Vertrag (Auftragsverarbeitung, Art. 28 DSGVO)',
      kind: 'avv',
      body:
        MUSTER_HINWEIS +
        'VEREINBARUNG ZUR AUFTRAGSVERARBEITUNG (Art. 28 DSGVO)\n\n' +
        'zwischen\n{auftraggeber} (Verantwortlicher)\nund\n{auftragnehmer} (Auftragsverarbeiter)\n\n' +
        '§ 1 Gegenstand und Dauer\nDer Auftragsverarbeiter verarbeitet personenbezogene Daten im Auftrag des ' +
        'Verantwortlichen im Rahmen des Projekts {projekt}. Die Dauer entspricht dem Hauptvertrag.\n\n' +
        '§ 2 Art und Zweck, Datenarten, Betroffene\nArt/Zweck: {zweck}. Datenarten: {datenarten}. ' +
        'Kreis der Betroffenen: {betroffene}.\n\n' +
        '§ 3 Pflichten des Auftragsverarbeiters\nVerarbeitung nur auf dokumentierte Weisung; Vertraulichkeitsverpflichtung ' +
        'der eingesetzten Personen; technische und organisatorische Maßnahmen nach Art. 32 DSGVO; Unterstützung des ' +
        'Verantwortlichen bei Betroffenenrechten und Meldepflichten; Löschung oder Rückgabe der Daten nach Auftragsende.\n\n' +
        '§ 4 Unterauftragsverarbeiter\nDer Einsatz von Unterauftragsverarbeitern bedarf der vorherigen allgemeinen ' +
        'Genehmigung. Aktuelle Liste: {subunternehmer}.\n\n' +
        '§ 5 Kontrollrechte\nDer Verantwortliche kann sich vor Beginn und während der Verarbeitung von der Einhaltung ' +
        'der Maßnahmen überzeugen.\n\n' +
        '{ort}, {datum}\n\n____________________\nVerantwortlicher\n\n____________________\nAuftragsverarbeiter',
    },
    {
      id: uid(),
      name: 'NDA (Geheimhaltungsvereinbarung, beidseitig)',
      kind: 'nda',
      body:
        MUSTER_HINWEIS +
        'GEHEIMHALTUNGSVEREINBARUNG (NDA)\n\n' +
        'zwischen\n{auftraggeber}\nund\n{auftragnehmer}\n\n' +
        '§ 1 Zweck\nDie Parteien beabsichtigen eine Zusammenarbeit im Bereich {projekt} und werden einander dazu ' +
        'vertrauliche Informationen offenlegen.\n\n' +
        '§ 2 Vertrauliche Informationen\nAls vertraulich gelten alle nicht öffentlich bekannten Informationen, ' +
        'insbesondere Quellcode, Geschäftszahlen, Kundendaten und Produktpläne — unabhängig von der Form der Übermittlung.\n\n' +
        '§ 3 Pflichten\nDie Parteien nutzen vertrauliche Informationen ausschließlich für den in § 1 genannten Zweck, ' +
        'geben sie nur an Personen weiter, die sie zwingend benötigen und entsprechend verpflichtet sind, und schützen ' +
        'sie mit der Sorgfalt eines ordentlichen Kaufmanns.\n\n' +
        '§ 4 Ausnahmen\nDie Pflichten gelten nicht für Informationen, die öffentlich bekannt sind oder werden (ohne ' +
        'Pflichtverletzung), rechtmäßig von Dritten erlangt wurden oder nachweislich unabhängig entwickelt wurden.\n\n' +
        '§ 5 Laufzeit\nDiese Vereinbarung gilt ab Unterzeichnung; die Geheimhaltungspflichten bestehen für 3 Jahre ' +
        'nach Ende der Zusammenarbeit fort.\n\n' +
        '{ort}, {datum}\n\n____________________\nPartei 1\n\n____________________\nPartei 2',
    },
  ];
}

function defaultSettings(): Settings {
  return {
    ownerName: 'Max Mustermann',
    companyName: 'Max Mustermann Softwareentwicklung',
    address: 'Musterstraße 1\n12345 Musterstadt',
    email: 'mail@example.com',
    phone: '+49 170 0000000',
    taxNumber: '12/345/67890',
    vatId: '',
    iban: 'DE00 0000 0000 0000 0000 00',
    bic: 'XXXXDEXXXXX',
    bank: 'Musterbank',
    kleinunternehmer: false,
    defaultVatRate: 19,
    defaultHourlyRate: 95,
    quotePrefix: 'A',
    invoicePrefix: 'R',
    paymentTermDays: 14,
    website: {
      tagline: 'Individuelle Softwareentwicklung — von der Idee bis zum Betrieb.',
      skills: 'TypeScript, Node.js, React, PostgreSQL, CI/CD',
      portfolio: [],
    },
  };
}

export function initialState(): AppState {
  return {
    version: 1,
    contacts: [],
    leads: [],
    outreachTemplates: defaultOutreachTemplates(),
    quotes: [],
    invoices: [],
    projects: [],
    timeEntries: [],
    expenses: [],
    incomes: [],
    assets: [],
    contractTemplates: defaultContractTemplates(),
    documents: [],
    settings: defaultSettings(),
  };
}

/** Fügt anschauliche Demo-Daten in einen bestehenden State ein. */
export function applyDemoData(s: AppState): void {
  const today = todayISO();
  const year = today.slice(0, 4);
  const c1 = {
    id: uid(),
    name: 'Julia Berger',
    company: 'Berger Logistik GmbH',
    email: 'j.berger@example.com',
    phone: '+49 89 1234567',
    address: 'Lagerweg 12\n80331 München',
    notes: 'Über LinkedIn kennengelernt, sucht Dashboard für Tourenplanung.',
    createdAt: addDaysISO(today, -40),
  };
  const c2 = {
    id: uid(),
    name: 'Tom Schneider',
    company: 'Schneider & Partner Steuerberatung',
    email: 'schneider@example.com',
    phone: '+49 221 987654',
    address: 'Kanzleiplatz 3\n50667 Köln',
    notes: 'Empfehlung von Bestandskunde.',
    createdAt: addDaysISO(today, -20),
  };
  const c3 = {
    id: uid(),
    name: 'Aylin Kaya',
    company: 'Kaya Interior Design',
    email: 'aylin@example.com',
    phone: '',
    address: 'Designstraße 8\n10115 Berlin',
    notes: 'Kam über das Website-Kontaktformular.',
    createdAt: addDaysISO(today, -5),
  };
  s.contacts.push(c1, c2, c3);

  s.leads.push(
    {
      id: uid(),
      contactId: c1.id,
      title: 'Touren-Dashboard (React)',
      value: 18000,
      stage: 'angebot',
      source: 'LinkedIn',
      followUpDate: addDaysISO(today, 3),
      notes: 'Angebot versendet, Entscheidung diese Woche.',
      createdAt: addDaysISO(today, -35),
    },
    {
      id: uid(),
      contactId: c2.id,
      title: 'DATEV-Schnittstelle für Mandantenportal',
      value: 9500,
      stage: 'erstgespraech',
      source: 'Empfehlung',
      followUpDate: addDaysISO(today, -1),
      notes: 'Erstgespräch war positiv, Scope-Dokument nachreichen.',
      createdAt: addDaysISO(today, -15),
    },
    {
      id: uid(),
      contactId: c3.id,
      title: 'Portfolio-Website mit CMS',
      value: 4200,
      stage: 'kontakt',
      source: 'Website',
      followUpDate: addDaysISO(today, 1),
      notes: 'Anfrage über Kontaktformular.',
      createdAt: addDaysISO(today, -5),
    },
  );

  const vat = s.settings.kleinunternehmer ? 0 : s.settings.defaultVatRate;
  const quote = {
    id: uid(),
    number: `${s.settings.quotePrefix}-${year}-001`,
    contactId: c1.id,
    leadId: s.leads[s.leads.length - 3].id,
    date: addDaysISO(today, -10),
    validUntil: addDaysISO(today, 20),
    vatRate: vat,
    items: [
      { id: uid(), description: 'Konzeption & UX Touren-Dashboard', quantity: 24, unit: 'Std.', unitPrice: 95 },
      { id: uid(), description: 'Umsetzung Frontend (React)', quantity: 120, unit: 'Std.', unitPrice: 95 },
      { id: uid(), description: 'API-Anbindung & Deployment', quantity: 40, unit: 'Std.', unitPrice: 95 },
    ],
    status: 'versendet' as const,
    notes: 'Staffelung in 3 Meilensteinen möglich.',
  };
  s.quotes.push(quote);

  const project = {
    id: uid(),
    name: 'Mandantenportal Basis-Setup',
    contactId: c2.id,
    status: 'aktiv' as const,
    hourlyRate: 95,
    milestones: [
      { id: uid(), title: 'Kickoff & Architektur', dueDate: addDaysISO(today, -7), done: true },
      { id: uid(), title: 'Prototyp Schnittstelle', dueDate: addDaysISO(today, 14), done: false },
    ],
    notes: '',
  };
  s.projects.push(project);
  s.timeEntries.push(
    { id: uid(), projectId: project.id, date: addDaysISO(today, -3), minutes: 210, description: 'Kickoff-Workshop & Protokoll' },
    { id: uid(), projectId: project.id, date: addDaysISO(today, -2), minutes: 300, description: 'Architektur-Entwurf, Repo-Setup' },
    { id: uid(), projectId: project.id, date: addDaysISO(today, -1), minutes: 150, description: 'DATEV-Exportformat evaluiert' },
  );

  const invoice = {
    id: uid(),
    number: `${s.settings.invoicePrefix}-${year}-001`,
    contactId: c2.id,
    projectId: project.id,
    date: addDaysISO(today, -12),
    dueDate: addDaysISO(today, 2),
    servicePeriod: 'Vormonat',
    vatRate: vat,
    items: [{ id: uid(), description: 'Beratung & Vorprojekt (8 Std. à 95,00 €)', quantity: 8, unit: 'Std.', unitPrice: 95 }],
    status: 'bezahlt' as const,
    paidDate: addDaysISO(today, -4),
  };
  s.invoices.push(invoice);

  s.expenses.push(
    { id: uid(), date: addDaysISO(today, -25), description: 'IDE-Lizenz (Jahresabo)', category: 'Software', netAmount: 149, vatRate: 19 },
    { id: uid(), date: addDaysISO(today, -8), description: 'Fachbuch Systemdesign', category: 'Fortbildung', netAmount: 42.06, vatRate: 7 },
  );

  s.assets.push(
    { id: uid(), type: 'hardware', name: 'MacBook Pro 14"', vendor: 'Apple', cost: 2399, interval: 'einmalig', cancelPeriodDays: 0, notes: 'AfA über 3 Jahre' },
    { id: uid(), type: 'abo', name: 'Cloud-IDE Teamplan', vendor: 'JetBrains', cost: 16.9, interval: 'monatlich', renewalDate: addDaysISO(today, 12), cancelPeriodDays: 7, notes: '' },
    { id: uid(), type: 'domain', name: 'example-dev.de', vendor: 'INWX', cost: 9.9, interval: 'jaehrlich', renewalDate: addDaysISO(today, 30), cancelPeriodDays: 30, notes: '' },
    { id: uid(), type: 'server', name: 'VPS Produktion', vendor: 'Hetzner', cost: 14.9, interval: 'monatlich', renewalDate: addDaysISO(today, 20), cancelPeriodDays: 14, notes: 'CX32' },
  );

  s.settings.website.portfolio.push(
    { id: uid(), title: 'Touren-Dashboard für Logistiker', description: 'Echtzeit-Dashboard zur Tourenplanung mit Kartenansicht und Auslastungs-KPIs.', tech: 'React, TypeScript, PostgreSQL' },
    { id: uid(), title: 'Mandantenportal-Schnittstelle', description: 'Sichere Datenübergabe zwischen Kanzleisoftware und Mandanten inkl. DATEV-Export.', tech: 'Node.js, REST, OAuth2' },
  );
}
