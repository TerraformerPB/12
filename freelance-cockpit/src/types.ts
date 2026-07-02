export type ID = string;

// ---------- CRM ----------

export interface Contact {
  id: ID;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string; // ISO-Datum
}

export type LeadStage = 'kontakt' | 'erstgespraech' | 'angebot' | 'won' | 'lost';

export interface Lead {
  id: ID;
  contactId: ID;
  title: string;
  value: number; // geschätztes Volumen in EUR (netto)
  stage: LeadStage;
  source: string; // z. B. "Website", "LinkedIn", "Empfehlung"
  followUpDate: string; // ISO-Datum oder ''
  notes: string;
  createdAt: string;
}

export type OutreachChannel = 'email' | 'linkedin';

export interface OutreachTemplate {
  id: ID;
  name: string;
  channel: OutreachChannel;
  subject: string; // bei LinkedIn leer
  body: string; // Platzhalter wie {name}, {firma}
}

// ---------- Angebote & Rechnungen ----------

export interface LineItem {
  id: ID;
  description: string;
  quantity: number;
  unit: string; // Std., Stk., pauschal …
  unitPrice: number; // netto
}

export type QuoteStatus = 'entwurf' | 'versendet' | 'angenommen' | 'abgelehnt';

export interface Quote {
  id: ID;
  number: string;
  contactId: ID;
  leadId?: ID;
  date: string;
  validUntil: string;
  vatRate: number; // Snapshot bei Erstellung (0 bei Kleinunternehmer)
  items: LineItem[];
  status: QuoteStatus;
  notes: string;
}

export type InvoiceStatus = 'entwurf' | 'versendet' | 'bezahlt' | 'storniert';

export interface Invoice {
  id: ID;
  number: string;
  contactId: ID;
  projectId?: ID;
  quoteId?: ID;
  date: string;
  dueDate: string;
  servicePeriod: string; // Leistungszeitraum, Freitext
  vatRate: number; // Snapshot bei Erstellung (0 bei Kleinunternehmer)
  items: LineItem[];
  status: InvoiceStatus;
  paidDate?: string;
}

// ---------- Projekte & Zeiterfassung ----------

export interface Milestone {
  id: ID;
  title: string;
  dueDate: string;
  done: boolean;
}

export type ProjectStatus = 'aktiv' | 'pausiert' | 'abgeschlossen';

export interface Project {
  id: ID;
  name: string;
  contactId: ID;
  quoteId?: ID;
  status: ProjectStatus;
  hourlyRate: number;
  milestones: Milestone[];
  notes: string;
}

export interface TimeEntry {
  id: ID;
  projectId: ID;
  date: string;
  minutes: number;
  description: string;
  invoiceId?: ID; // gesetzt = abgerechnet
}

// ---------- Finanzen / EÜR ----------

export interface Expense {
  id: ID;
  date: string;
  description: string;
  category: string;
  netAmount: number;
  vatRate: number; // gezahlte USt (Vorsteuer)
}

export interface IncomeEntry {
  id: ID;
  date: string;
  description: string;
  netAmount: number;
  vatRate: number;
}

// ---------- Inventar (Hardware, Lizenzen, Domains, Server, Abos) ----------

export type AssetType = 'hardware' | 'lizenz' | 'domain' | 'server' | 'abo';
export type BillingInterval = 'einmalig' | 'monatlich' | 'jaehrlich';

export interface Asset {
  id: ID;
  type: AssetType;
  name: string;
  vendor: string;
  cost: number; // Kosten pro Intervall (netto)
  interval: BillingInterval;
  renewalDate?: string; // nächste Verlängerung / Ablauf
  cancelPeriodDays: number; // Kündigungsfrist in Tagen vor Verlängerung
  notes: string;
}

// ---------- Verträge & Dokumente ----------

export type ContractKind = 'dienstvertrag' | 'werkvertrag' | 'avv' | 'nda' | 'sonstiges';

export interface ContractTemplate {
  id: ID;
  name: string;
  kind: ContractKind;
  body: string; // Platzhalter wie {auftraggeber}, {auftragnehmer}
}

export interface StoredDocument {
  id: ID;
  contactId?: ID; // Ablage pro Kunde
  name: string;
  kind: string;
  content: string;
  createdAt: string;
}

// ---------- Onlineauftritt ----------

export interface PortfolioProject {
  id: ID;
  title: string;
  description: string;
  tech: string;
}

export interface WebsiteConfig {
  tagline: string;
  skills: string; // kommagetrennt
  portfolio: PortfolioProject[];
}

// ---------- Einstellungen ----------

export interface Settings {
  ownerName: string;
  companyName: string;
  address: string; // mehrzeilig
  email: string;
  phone: string;
  taxNumber: string; // Steuernummer
  vatId: string; // USt-IdNr., optional
  iban: string;
  bic: string;
  bank: string;
  kleinunternehmer: boolean; // §19 UStG
  defaultVatRate: number; // Regelbesteuerung, i. d. R. 19
  defaultHourlyRate: number;
  quotePrefix: string;
  invoicePrefix: string;
  paymentTermDays: number;
  website: WebsiteConfig;
}

export interface AppState {
  version: number;
  contacts: Contact[];
  leads: Lead[];
  outreachTemplates: OutreachTemplate[];
  quotes: Quote[];
  invoices: Invoice[];
  projects: Project[];
  timeEntries: TimeEntry[];
  expenses: Expense[];
  incomes: IncomeEntry[];
  assets: Asset[];
  contractTemplates: ContractTemplate[];
  documents: StoredDocument[];
  settings: Settings;
}
