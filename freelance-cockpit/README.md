# Freelance Cockpit

Business-Suite für Software-Freelancer als lokale Web-App (Vite + TypeScript,
keine Laufzeit-Abhängigkeiten, kein Backend). Alle Daten liegen im
`localStorage` des Browsers; ein JSON-Backup-Export ist eingebaut.

## Setup

```bash
cd freelance-cockpit
npm install
npm run dev       # Dev-Server auf Port 5274
npm test          # Unit-Tests (Vitest)
npm run build     # Statischer Build nach dist/ (relative Pfade)
npm run preview   # Build lokal testen (Port 4274)
```

Auf dem Dashboard gibt es einen Button **„Demo-Daten laden“**, der den
kompletten Datenfluss mit Beispieldaten befüllt.

## Module

| Modul | Inhalt |
| --- | --- |
| **CRM & Leads** | Kanban-Pipeline (Kontakt → Erstgespräch → Angebot → Won/Lost) mit Drag-&-Drop, Kontaktverwaltung, Follow-up-Reminder, Outreach-Vorlagen (Cold Mail, LinkedIn) mit Platzhaltern |
| **Angebote & Rechnungen** | Positions-Editor, PDF über Druckansicht, **XRechnung-Export** (UBL 2.1, EN 16931 — E-Rechnungs-Pflicht B2B seit 2025), Kleinunternehmer-Toggle (§19 UStG) vs. Regelbesteuerung |
| **Projekte & Zeiten** | Projekte mit Meilensteinen, Stundenerfassung pro Kunde/Projekt, „Zeiten abrechnen“ erzeugt direkt Rechnungspositionen |
| **Finanzen / EÜR** | Einnahmen-Überschuss-Rechnung (Zufluss/Abfluss), Ausgabenerfassung, USt-Voranmeldungs-Vorbereitung je Quartal, DATEV-Buchungsstapel-Export (CSV) |
| **Inventar & Abos** | Hardware, Software-Lizenzen, Domains, Server, Abos — mit Kündigungsfristen-Alerts und laufenden Monatskosten |
| **Verträge & Dokumente** | Muster-Vorlagen (Dienstvertrag, Werkvertrag, AV-Vertrag/DSGVO, NDA), Platzhalter-Befüllung mit Kundendaten, Ablage pro Kunde |
| **Onlineauftritt** | Portfolio-Site als exportierbares Standalone-HTML inkl. Kontaktformular, Impressum-/Datenschutz-Generator, Formular-Simulation, die Leads direkt ins CRM schreibt |

## Der Datenfluss (die Verzahnung)

```
Kontaktformular → Lead → Angebot → Projekt → Zeiterfassung → Rechnung → EÜR
```

- **Onlineauftritt:** „Kontaktformular-Eingang simulieren“ legt Kontakt + Lead an.
- **CRM:** Lead-Karte → „→ Angebot“ erzeugt ein Angebot und schiebt den Lead in die Phase „Angebot“.
- **Angebote:** „Angenommen“ setzt den Lead auf **Won**; „→ Projekt“ legt das Projekt an, „→ Rechnung“ übernimmt die Positionen.
- **Projekte:** „Zeiten abrechnen“ macht aus offenen Zeiteinträgen eine Rechnung (Einträge werden als abgerechnet markiert).
- **Rechnungen:** „Bezahlt ✓“ genügt — bezahlte Rechnungen erscheinen automatisch als Einnahme in der EÜR (Zuflussprinzip).

## Architektur

```
src/
  main.ts        Hash-Router + Sidebar, Re-Render bei jeder State-Änderung
  store.ts       AppState in localStorage, minimales Pub/Sub
  types.ts       Alle Datentypen
  seed.ts        Grundzustand, mitgelieferte Vorlagen, Demo-Daten
  actions.ts     Modulübergreifende Aktionen (der Datenfluss)
  domain/        Reine Logik, ohne DOM — vollständig unit-getestet:
                 money, numbering, euer, datev, xrechnung, inventory, placeholders
  ui/            Eine Datei pro Modul (DOM-Rendering), helpers.ts (Mini-DOM-Builder,
                 Modal, Tabelle, Toast), print.ts (Druck-/PDF-Ansichten)
tests/           Vitest-Tests für die Domain-Logik
```

## Wichtige Hinweise

- **Keine Rechts-/Steuerberatung:** Vertragsvorlagen, Rechtstexte, DATEV- und
  XRechnung-Export sind sorgfältig gebaute Muster/Basisformate. Vor dem ersten
  produktiven Einsatz: XRechnung mit dem KoSIT-Validator prüfen, Verträge
  juristisch gegenlesen lassen, Kontenrahmen mit dem Steuerbüro abstimmen.
- **PDF-Export** läuft über die Druckansicht des Browsers („Als PDF speichern“).
- **Daten:** nur lokal im Browser. Regelmäßig das JSON-Backup ziehen.
