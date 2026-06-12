# Burgspiel

Mobile-first Browser-Aufbauspiel im Stil von Stronghold: Wirtschaftsaufbau jetzt,
wellenbasierte Burgverteidigung später. Isometrische 2D-Ansicht, Touch-only bedienbar,
läuft ebenso mit Maus auf dem Desktop. **Alle Roadmap-Phasen sind umgesetzt:
Wirtschaft, Verteidigung, Wellen, Straßen/Forschung/Tutorial, natives
Android-Projekt (Capacitor) und AdMob-Rewarded-Ads. Für den Store-Release
fehlen nur noch AdMob-/Play-Console-Konten und der signierte Build.**

## Setup

```bash
npm install
npm run dev       # Dev-Server (Desktop & Smartphone im selben Netz)
npm test          # Unit-Tests (Vitest)
npm run build     # Statischer Build nach dist/ (relative Pfade, nginx-tauglich)
npm run preview   # Build lokal testen
```

Kein Backend nötig — Savegames liegen versioniert im `localStorage`
(Autosave alle 30 s und beim Verlassen/Verstecken des Tabs).

## Architektur-Überblick

Die Spiellogik läuft mit fixem Timestep (20 TPS) komplett Pixi-frei in `core/`,
`world/`, `entities/` und `systems/`; nur `render/WorldRenderer.ts` kennt PixiJS
und liest den Spielzustand jeden Frame (mit Interpolation für Träger). Die UI
(HUD, Build-Menü, Panels) ist ein DOM-Overlay über dem Canvas und kommuniziert
ausschließlich über den typisierten `EventBus` mit der Logik. Alle
Balancing-Werte stehen zentral in `data/config.ts` und `data/buildings.ts` —
Gebäude sind rein datengetrieben. Platzhalter-Grafiken (Iso-Rauten, extrudierte
Blöcke, Kreise) entstehen ausschließlich in `render/placeholders.ts` und können
später 1:1 durch Sprite-Atlanten ersetzt werden, ohne Logik anzufassen.
Savegames sind mit `saveVersion` versioniert; das Terrain wird deterministisch
aus dem gespeicherten Seed regeneriert.

```
src/
  main.ts                 Bootstrap + Game-Loop (fixed timestep, rAF-Rendering)
  core/    Game (State-Machine), EventBus, SaveManager, Input, SoundManager-Stub
  world/   IsoGrid (Koordinaten-Mathe), Camera, Pathfinding (A*), TerrainGenerator
  entities/ Building, Worker (reine Daten + Logik)
  systems/ BuildSystem (Ghost/Validierung), EconomySystem (Produktion, Träger-Jobs)
  render/  WorldRenderer (PixiJS, Culling), placeholders (gesamte Platzhalter-Grafik)
  ui/      HUD, BuildMenu, InfoPanel, PauseMenu, Toast (DOM, deutsch)
  data/    buildings.ts (Gebäude-Definitionen), config.ts (Balancing)
```

## Ein Gebäude hinzufügen

Ein neuer Eintrag in `src/data/buildings.ts` genügt:

```ts
smokehouse: {
  id: 'smokehouse',
  name: 'Räucherei',
  footprint: { w: 2, h: 3 },                       // asymmetrisch → "Drehen" erscheint automatisch
  cost: { wood: 30, stone: 10 },
  placement: PlacementRule.Grass,                   // oder AdjacentRock
  recipe: { input: 'bread', output: 'bread', duration: 5 }, // input optional
  description: 'Beispielgebäude.',
  art: { color: 0x884444, height: 28 },             // Platzhalter-Optik
},
```

Danach die Id in `BUILD_MENU_SECTIONS` eintragen — Kosten, Ghost-Preview,
Validierung, Produktion, Träger-Logistik, Info-Panel und Savegame funktionieren
ohne weitere Code-Änderung. Neue Ressourcen werden analog in `config.ts`
(`RESOURCE_IDS` + `RESOURCE_INFO`) ergänzt.

## Roadmap

- **Phase 1 (✓):** Iso-Grid, Kamera/Touch, Bausystem, Wirtschaft mit Trägern,
  Brot-Kette, Save/Load, Tests.
- **Phase 2 (✓) — Verteidigung:** Mauern (blockieren Pfade), Tore (für eigene
  Einheiten passierbar), Wachturm, Kaserne; Soldaten rekrutieren (kosten Brot
  und Bevölkerung), per Tap selektieren und kommandieren. Savegame v2 mit
  v1-Migration.
- **Phase 3 (✓) — Wellen & Gegner:** Wellen-Spawner mit Skalierung, Kampfsystem
  (Türme schießen mit Projektil-Visuals, Soldaten kämpfen mit Aggro um ihren
  Wachposten), Gebäudeschaden mit HP-Balken, Game Over + Score. Gegner-Routing
  über `enemyMoveCost`: Tore blockiert, Mauern als teurer "Breach"-Pfad — sie
  greifen die günstigste Bresche an. Sounds werden zur Laufzeit synthetisiert
  (keine Fremd-Assets) und über den `SoundManager`/Howler abgespielt. Savegame v3.
- **Phase 4 (✓) — Inhalt & Komfort:** Straßen (billigere Pfadkosten + 40%
  Tempo, Gegner laufen sie kostenlos), Forschung (3 Techs im Bau-Menü),
  geführtes Tutorial mit Skip, zweiter Gegnertyp „Brecher" (ab Welle 3,
  datengetrieben in `data/enemies.ts`). Savegame v4. Sprite-Atlanten stehen
  weiter aus — der Austauschpunkt bleibt `render/placeholders.ts`.
- **Phase 5 (✓) — Capacitor:** Das native `android/`-Projekt ist generiert
  und eingecheckt, `@capacitor/app` ist verdrahtet (Speichern beim
  Backgrounden, Android-Zurück-Taste: Baumodus abbrechen → Pause →
  App minimieren). Der APK-Build selbst braucht Android Studio (siehe unten).
- **Phase 6 (✓ bis auf Store-Konten) — Monetarisierung:**
  `@capacitor-community/admob` ist integriert: Auf dem Gerät lädt
  `AdmobRewardedAdProvider` echte Rewarded Ads (aktuell Googles Test-Ads),
  im Browser bleibt der Dev-Platzhalter. Use-Case: einmal pro Run
  „Weiterspielen (Werbung)" nach Game Over. IAP bleibt als Interface
  (`monetization/Iap.ts`) vorbereitet.

- **Phase 7 (✓) — Spieltiefe:** Wälder als Terrain (Holzfäller nur daneben,
  Wald bremst Fußwege), Brücken über den Fluss (auch für Angreifer!),
  Erz→Waffen-Kette (Erzmine an Fels, Schmiede; Soldaten kosten Brot+Waffe),
  Arbeiter-Zuteilung pro Betrieb (Siedler-Stil, Produktion skaliert mit
  Besetzung; Auto-Zuteilung beim Bau, ± im Info-Panel), Straßen-Ausbau zur
  Pflasterstraße, Gebäude-Reparatur, mehr Startressourcen und spätere erste
  Welle, faire Spawns (Gegner starten nur dort, wo sie das Lagerhaus
  erreichen können — kein Glücksspiel mehr am Fluss), Atmosphäre-Details
  (Blumen, Büsche, Wasser-Strömung) und überarbeitete Gebäude-/Einheiten-
  Platzhalter mit Lauf-Animation. Savegame v5 (ältere Stände starten neu,
  da sich die Kartengenerierung geändert hat).
- **Phase 8 (✓) — Ausbau & neue Ketten:** Alle Gebäude sind aufrüstbar
  (Stufe 1–3 im Info-Panel: mehr HP, +30% Produktionstempo pro Stufe,
  Türme mit mehr Schaden/Reichweite, Hütten mit mehr Bevölkerung; Ausbau
  repariert mit). Neue Waren Fisch und Bier mit eigenen Betrieben:
  Fischerhütte (muss am Wasser stehen, 2×1 — rotierbar) und Brauerei
  (Weizen → Bier); beide speisen zwei neue Forschungen (Marschverpflegung:
  +25% Soldaten-Tempo, Freibier: +15% Träger-Tempo). Stufen-Optik mit
  Holzverstrebungen (Stufe 2) und Goldzier + Banner (Stufe 3), neue
  Dekorationen für Mine, Schmiede, Fischerhütte und Brauerei. Savegame v6
  (migriert verlustfrei von v5).
- **Phase 9 (✓) — Feinschliff & Inhalt:** Endlicher Wald — Holzfäller
  fällen pro 10 Holz einen angrenzenden Waldtile (Status im Info-Panel,
  Produktion stoppt ohne Wald), Wald breitet sich langsam auf freies Gras
  aus; Terrain-Änderungen werden im Savegame (v7) gespeichert und nur der
  betroffene Karten-Chunk neu gebacken. Dritter Gegnertyp „Plänkler"
  (Fernkampf, ab Welle 4, eigene Pfeil-Projektile). Lokale Bestenliste im
  Game-Over-Screen (Top 5). Repo-Hygiene: GitHub-Actions-CI (Tests + Build),
  vitest 4 (npm audit: 0 Findings), Debug-Handle nicht mehr im Store-Build.
  Animierte Einheiten-Sprites (Träger, Soldat, alle Gegnertypen: Idle + 4
  Lauf-Frames, Blickrichtungs-Spiegelung, Fracht-Kiste in Warenfarbe) über
  die "units"-Sektion des Sprite-Manifests, mit Vektor-Fallback. Nahtloser
  synthetisierter Ambient-Loop + Ton-Schalter im Pausenmenü (persistiert).
- **Phase 10 (✓, in Phase 13 neu designt) — Burg-Duell:** Erste Fassung als
  asynchroner Burg-Code-Angriff; ab Phase 13 ersetzt durch das gespiegelte
  1-gegen-1 (siehe unten). Das Code-Format (`core/CastleCode.ts`) bleibt als
  Übertragungs-Payload für eine spätere Online-Variante erhalten.

- **Phase 11 (✓) — Komfort & Vielfalt:** Hauptmenü beim Start (Weiterspielen /
  Neues Spiel / Burg-Duell, bester Lauf), Schnellzugriff im HUD (📊 Übersicht),
  Übersichts-Panel mit Warenbeständen + geschätzter Netto-Produktion pro
  Minute, Bevölkerungsaufschlüsselung und Gebäudeliste. Neue Ausbauformen:
  Mauer → Verstärkte Mauer, Tor → Eisentor. Neue Einheit **Ritter**
  (Elite-Soldat: 70 LP, 8 Schaden; kostet Brot+Waffen+Bier — zweiter
  Rekrutier-Button in der Kaserne, datengetrieben in `data/soldiers.ts`).
  Fahrzeuge: **Ochsenkarren** vom neuen Stall (transportiert 3 Waren pro
  Fahrt, kostet keine Bevölkerung, animiertes Gespann mit drehenden Rädern)
  und gegnerischer **Rammbock** ab Welle 6 (ignoriert Soldaten, zertrümmert
  Gebäude — Türme/Ritter müssen ihn stoppen). Savegame v8 (migriert
  verlustfrei).

- **Phase 12 (✓) — Komplexität & Tiefe:**
  1. **Verbrauch & Moral (✓)** — Bevölkerung und Soldaten essen alle 15 s
     (Brot, dann Fisch); Hunger senkt die Moral (😊 im HUD), Sattheit und
     Nahrungsvielfalt (Brot/Fisch/Bier) heben sie. Moral skaliert das
     Arbeitstempo aller Träger (0,75×–1,25×).
  2. **Baustellen (✓)** — Gebäude entstehen nicht mehr instant: Träger/Karren
     liefern erst die Baukosten an die Baustelle (transparenter Sprite +
     gelber Fortschrittsbalken), dann läuft die Bauzeit (2,5 s pro Tile).
     Straßen/Brücken bleiben Instant-Bau; Info-Panel zeigt fehlendes Material.
  3. **Veteranen & Belagerung (✓)** — Soldaten sammeln Kills und steigen bei
     3/8/15 Kills im Rang (goldene Pips, +10% LP/Schaden pro Rang, Fanfare).
     Neue Gegner: **Katapult** ab Welle 8 (Reichweite 7 — überreicht Türme,
     beschießt Gebäude aus der Distanz) und **Kriegsherr**-Boss jede
     10. Welle (420 LP).
  4. **Markt, Gold & Steuern (✓)** — neues Gut **Gold 🪙**; der Marktplatz
     öffnet ein Handels-Panel (5er-Batches kaufen/verkaufen, Kauf = 2×
     Verkaufspreis) plus Steuer-Regler (4 Stufen: Gold pro Kopf gegen Moral).
  5. **Jahreszeiten (✓)** — 180-s-Zyklus mit Karten-Tönung und HUD-Chip:
     Herbst beschleunigt Farmen (+50%), Winter stoppt sie und erhöht den
     Nahrungsbedarf (+50%).
  6. **Szenarien & Tech-Zweige (✓)** — Hauptmenü-Szenariowahl (Endlos /
     Zehn Wellen / Goldrausch) mit 🏆-Sieg-Screen; Forschungs-Tier-2 mit
     Voraussetzungen und exklusiven Zweigen: **Militärdoktrin** (+1
     Turm-Reichweite, braucht Kampftraining) vs. **Handelsgilde** (bessere
     Marktpreise, braucht Freibier) — nur einer pro Lauf. Savegame v9
     (migriert verlustfrei).
  Bewusst auf später verschoben: Turm-Garnison, zugefrorener Fluss,
  dynamische Marktpreise, Soldaten-Sold, Zufallsereignisse, Achievements.

- **Phase 15 (✓) — Duell-Ausbau (Vorbereitung Match-System):** Zwei neue
  Duell-Karten: **🏹 Bogenschütze** (Fernkampf, Reichweite 4, 6 Fisch) und
  **🐏 Ramme** (Belagerung: ignoriert Truppen, 20 Schaden gegen Gebäude,
  12 Holz) — nur im Duell, nicht in der Kaserne. Drei **KI-Schwierigkeiten**
  (Leicht/Normal/Schwer: Angriffstakt 65/45/30 s, Truppgröße 4/5/7); die KI
  setzt jetzt auch Rammen ein (max. 1 pro Trupp, bezahlt aus ihrem
  Holz-Budget) und sammelt sich abwechselnd am Tor und an den Lagern, um
  die Flaggen aktiv zu umkämpfen. **🏆 Pokal-System** (`core/DuelRating.ts`,
  localStorage): Siege bringen 20/30/45 Pokale je nach Schwierigkeit,
  Niederlagen kosten welche (nie unter 0), Serien werden getrackt; Anzeige
  im Duell-Dialog und Ergebnis-Screen. Die Pokale sind bewusst als
  Matchmaking-Rating angelegt: Sobald die APK steht und ein Backend dazu
  kommt, wird daraus das echte Match-System (Gegner-Suche nach Pokalen,
  Burg-Upload statt lokaler KI hinter demselben `DuelAI`-Interface).

- **Phase 20 (✓) — Rohstoffe, Bergfried & sinnvolle Stufen:** Wald wächst
  doppelt so schnell nach (alle 10 s, 6 Versuche). **Erzvorkommen:** Die
  Kerne der Felscluster sind jetzt Erzadern (goldene Sprenkel, jede Karte
  hat garantiert welche); die Erzmine muss an einer Ader stehen und baut
  sie ab — pro 12 Erz wird ein Adern-Tile zu Fels, ohne Ader steht die
  Mine still. **Bergfried:** Das Lagerhaus lässt sich (im Wirtschaftsmodus
  ab Ratsherr) zum Bergfried ausbauen — 340 HP, +3 Bevölkerung und er
  beschießt Angreifer wie ein Wachturm (gemeinsames `shoots`-Flag).
  **Stufen wirken jetzt überall:** +2 lokale Lagerplätze pro Stufe (alle
  Betriebe), Marktplatz-Stufen verbessern Verkaufspreise (+5 %/Stufe),
  Ställe stellen pro Stufe einen Karren, Kasernen ab Stufe 2/3 rekrutieren
  vorbeförderte Veteranen (Rang 1/2). **Ausbaukosten-Fix:** Beim
  Gebäude-Tausch (Mauer→verstärkte Mauer, Tor→Eisentor, Lagerhaus→Bergfried)
  wird die Abriss-Erstattung des alten Gebäudes angerechnet — und der
  Tausch ist instant statt Baustelle (es steht ja schon ein Gebäude;
  das behebt nebenbei eine Doppelzahlung aus Phase 13). Savegame v11.

- **Phase 19 (✓) — Wirtschaftsmodus-Vertiefung:** **Dynamische Preise** —
  jeder Karawanenverkauf sättigt den Markt der Fraktion für diese Ware
  (Preis ÷ (1+Sättigung), Erholung über Minuten): Wer immer dasselbe
  verkauft, verdient immer weniger und muss diversifizieren oder Fraktionen
  rotieren. **Lieferaufträge** — Fraktionen stellen zufällig Anfragen nach
  ihren Lieblingswaren (10–25 Stück, 5 Minuten Frist, Belohnung = Preis
  ×1,6 + großer Beziehungs- und Prestigeschub); verfallene Aufträge kosten
  Beziehung. **Bündnis-Bonus** — ab Beziehung 75 zahlen Verbündete +15 %
  auf alle Karawanen. Alles im 🤝-Panel sichtbar (Live-Preise, Auftrag mit
  Countdown und Liefern-Button); persistiert im Diplomatie-Save (alte
  v10-Stände laden mit Defaults weiter).

- **Phase 18 (✓) — Wirtschaftssimulator (Extra-Modus 'Wirtschaft'):** Vierter
  Spielmodus neben Endlos/Zehn Wellen/Goldrausch und dem Duell — als
  eigenständiges Szenario, die bestehenden Modi bleiben unverändert.
  **Kein Wellen-Defense:** Es gibt keine geplanten Angriffswellen mehr;
  Krieg ist ausschließlich die Folge schlechter Beziehungen. Drei
  **Nachbar-Fraktionen** (🌳 Grafschaft Eichwald, ⚓ Hansebund Seestadt,
  ⛰️ Bergclan Steinfaust) mit Beziehungswerten 0–100: Beziehungen verfallen
  langsam Richtung neutral und wollen gepflegt werden (🎁 Geschenke,
  🐪 Handel); unter 20 erklärt die Fraktion den Krieg und überfällt die
  Burg in wachsenden Raubzügen, bis man 🕊️ Tribut zahlt. **Karawanenhandel**
  mit Fraktionspreisen: Jede Fraktion zahlt Aufschläge auf Waren, die sie
  begehrt (Seestadt: Tuch ×2,0), und Abschläge auf eigene Güter — Karawanen
  sind 40 s unterwegs und bringen Gold, Beziehung und Prestige.
  **Ränge & Freischaltung:** Prestige fließt aus Bevölkerung, erfüllten
  Luxusbedürfnissen und Handel; sechs Ränge (Bauer → Bürger → Händler →
  Ratsherr → Graf → Herzog) schalten Gebäude frei (Markt/Brauerei/Schäferei
  ab Bürger, Schmiede/Stall/Weberei ab Händler, verstärkte Mauern/Eisentor
  ab Ratsherr); Herzog (1200 Prestige) gewinnt das Szenario.
  **Tiefere Wirtschaft:** neue Kette Schäferei → 🐑 Wolle → Weberei →
  🧵 Tuch; die Bevölkerung verlangt neben Nahrung Luxusgüter (Bier, Tuch)
  — erfüllte Bedürfnisse heben Moral und Prestige (Anno-artige
  Bedürfnisstufen). HUD zeigt 👑 Rang + Prestige statt Wellen-Timer und
  das 🤝-Diplomatie-Panel (Beziehungen, Aktionen, Karawanen). Savegame v10.

- **Phase 17 (✓) — Online-Backend (Accounts, Bestenlisten, Matchmaking, Admin):**
  Vollständiges Backend in `server/` — bewusst **dependency-frei** (reines
  `node:http`, läuft überall mit Node 18+, keine nativen Builds):
  Accounts mit scrypt-Passwort-Hashes und HMAC-signierten Tokens (30 Tage),
  JSON-Datei-Persistenz mit atomaren Writes (`storage.ts`, hinter einem
  Interface — austauschbar gegen eine echte DB), Rate-Limit, CORS, Bann-
  Prüfung. REST-API: Registrieren/Login/Profil/Passwort/Konto löschen,
  Online-Bestenlisten (🏆 Duell-Elo und 🌊 überlebte Wellen), Score-Submit
  (Server behält den besten Lauf), Burg-Upload (Burg-Code), **Matchmaking
  nach Elo-Nähe** und Ergebnis-Meldung mit **Elo-Verrechnung** (K=32,
  Start 1000, nullsummig). **Admin-Dashboard** unter `/admin` (Statistik,
  Nutzerliste, Sperren/Entsperren, Rollen, Löschen); der erste registrierte
  Account wird Admin (oder Seed via `BURGSPIEL_ADMIN_USER`/`_PASSWORD`).
  Im Spiel: 🌐-Online-Dialog im Hauptmenü (Konto, Server-Adresse einstellbar,
  Online-Bestenliste, Burg hochladen, **Online-Duell suchen** — der gematchte
  Gegner wird im Spiegel-Duell von der KI vertreten, deren Stärke mit der
  Pokal-Differenz skaliert; das Ergebnis verrechnet der Server). Beste Läufe
  werden bei Game Over/Sieg automatisch gemeldet. Alles strikt optional —
  offline bleibt das Spiel vollständig spielbar. Start: `npm run server`
  (Port 8787; `PORT`, `BURGSPIEL_DATA`, `BURGSPIEL_CORS` als Env). Nächste
  Ausbaustufe für echtes PvP: die hochgeladene Gegnerburg in die Spiegel-Map
  importieren und Echtzeit-Matches über WebSockets — Accounts, Rating und
  API sind dafür ausgelegt.

- **Phase 16 (✓) — Duell-Fixes & Store-Hauptmenü:** Garantierte Lanes
  verbinden beide Burgen auf jeder Zufallskarte (Fluss konnte die Hälften
  trennen); Anti-Oszillations-Pathing (Einheiten pendelten vor der Burg auf
  der Stelle, statt anzugreifen). Neues Hauptmenü mit Wappen-Hero,
  Szenario-Picker, Pokal-Badge, Bestenlisten- und Einstellungs-Dialog
  (Ton, Spielstand löschen) und Versions-Footer.

- **Phase 14 (✓) — Burg-Duell im Clash-Stil:** Im Duell gibt es keine
  Produktion mehr — Rohstoffe kommen ausschließlich aus dem Start-Budget
  (Inventar) und von **eroberbaren Rohstoff-Lagern** auf dem Schlachtfeld
  (4 Flaggen, gespiegelt: 🥖 Brot und ⚔️ Waffen; wer als einziger Einheiten
  in der Nähe hat, erobert das Lager und bekommt alle 6 s Nachschub — bis
  der Gegner es zurückerobert). Truppen werden Clash-Royale-artig über
  **Karten** direkt auf der eigenen Kartenhälfte abgesetzt (Soldat 3 Brot,
  Ritter 5 Waffen + 2 Brot) und marschieren selbstständig auf die Gegnerburg
  zu — kämpfen unterwegs gegen feindliche Trupps, reißen Mauern ein und
  belagern die Burg (`mode: 'advance'`). Türme/Mauern können weiterhin über
  das Baumenü gesetzt werden (instant, aus dem Budget). Die KI bezahlt ihre
  Trupps aus demselben Budget plus Lager-Einnahmen.

- **Phase 13 (✓) — Burg-Duell als gespiegeltes 1-gegen-1 + Start-Balancing:**
  Mehr Startressourcen (140 Holz / 50 Stein / 8 Brot / 4 Fisch), damit trotz
  Baustellen-System Mauern und Türme vor Welle 1 stehen. Das Burg-Duell ist
  jetzt ein echtes 1v1-Gefecht: Die Karte wird in der Mitte gespiegelt
  (beide Seiten identisches Gelände), auf jeder Seite steht dieselbe kleine
  Burg (Lagerhaus, 2 Türme, Mauerlinie mit offenem Tor) und beide Spieler
  erhalten exakt dasselbe wählbare Rohstoff-Budget (Klein/Mittel/Groß).
  Der Spieler baut auf seiner Hälfte Wirtschaft, Verteidigung und Truppen
  (im Duell baut alles instant — kompaktes Gefecht); der Gegner ist eine
  lokale KI (`systems/DuelAI.ts`), die ihr Budget über Zeit in Angriffstrupps
  umwandelt (Brot → Plünderer, Waffen → Brecher, Fisch → Plänkler; erster
  Angriff nach 75 s, dann alle 45 s). Eigene Soldaten belagern die Gegnerburg
  automatisch (Mauer einreißen → durchmarschieren), gegnerische Türme
  schießen auf Soldaten, die Gegnerburg ist rötlich getönt. Sieg = fremdes
  Lagerhaus zerstört, Niederlage = eigenes fällt; nach 10 Minuten gewinnt
  die Burg mit mehr Lagerhaus-HP. Duell-HUD zeigt beide Burg-Zustände; der
  eigene Spielstand bleibt unberührt (In-Memory-Backup). Eine Online-Variante
  bräuchte ein Backend — die KI hängt an einem schmalen Kontext-Interface,
  hinter das ein echter Gegner geschaltet werden kann.

## Online-Backend betreiben

```bash
npm run server          # kompiliert server/ und startet auf Port 8787
# Admin-Dashboard: http://localhost:8787/admin
```

Konfiguration über Umgebungsvariablen:

| Variable | Bedeutung | Default |
| --- | --- | --- |
| `PORT` | HTTP-Port | `8787` |
| `BURGSPIEL_DATA` | Pfad der Daten-Datei | `./server-data/burgspiel.json` |
| `BURGSPIEL_CORS` | `Access-Control-Allow-Origin` | `*` |
| `BURGSPIEL_ADMIN_USER` / `BURGSPIEL_ADMIN_PASSWORD` | Admin-Konto beim ersten Start | — (sonst: erster Account wird Admin) |
| `BURGSPIEL_RATE_MAX` | Requests pro 10 s und IP | `30` |

Deployment: ein beliebiger Node-18+-Host genügt (`node server/dist/index.js`
hinter einem Reverse-Proxy mit HTTPS). Im Spiel unter 🌐 Online die
Server-Adresse eintragen. Für den Play-Store-Build gehört die produktive
URL als Default in `src/online/OnlineClient.ts`.

## Echte Grafiken einbinden

Das Spiel rendert Gebäude über gebackene Texturen mit einem Drop-in-Override:
PNG-Sprites in `public/sprites/` legen, in `public/sprites/manifest.json`
eintragen — fertig, kein Code nötig. Nicht eingetragene Gebäude behalten
ihren Platzhalter (gebäudeweise Umstellung möglich). Pixel-Spezifikation,
Ankerpunkt-Konvention und Stil-Briefing: siehe **ASSETS.md**.

## Play-Store-Build (Capacitor)

Auf einem Rechner mit Android Studio (inkl. Android SDK):

```bash
npm install
npm run build          # erzeugt dist/
npx cap sync android   # kopiert dist/ + Plugins ins native Projekt
npx cap open android   # in Android Studio öffnen → auf Gerät/Emulator starten
```

Release-Checkliste vor dem Store-Upload:

1. **AdMob-Konto anlegen**, App registrieren und ersetzen:
   - App-ID in `android/app/src/main/AndroidManifest.xml`
     (`com.google.android.gms.ads.APPLICATION_ID`, aktuell Googles Test-ID),
   - Ad-Unit-ID + `ADMOB_USE_TEST_ADS = false` in `src/data/config.ts`.
2. **Signieren:** In Android Studio einen Upload-Key erzeugen
   (Build → Generate Signed App Bundle), `.aab` für die Play Console bauen.
3. `versionCode`/`versionName` in `android/app/build.gradle` pflegen.
4. Optional IAP: Plugin (z. B. RevenueCat) installieren und gegen
   `IapProvider` in `monetization/Iap.ts` implementieren.

## Spielhinweise

- Steinbruch/Erzmine nur an Fels, Holzfällerhütte nur an Wald platzierbar.
- Betriebe brauchen zugeteilte Arbeiter (Info-Panel ±). Arbeiter fehlen dann
  dem Träger-Pool — Hütten bauen!
- Brücken verbinden die Flussufer — für beide Seiten. Beschädigte Gebäude
  lassen sich im Info-Panel reparieren, Straßen zu Pflasterstraßen ausbauen.
- Träger holen Output bei Produzenten ab; Mühle/Bäckerei bekommen Input vom
  Lagerhaus geliefert (Lieferungen haben Priorität).
- Soldaten: Kaserne bauen → im Info-Panel rekrutieren (kostet Brot und einen
  Bevölkerungs-Slot, der dem Träger-Pool fehlt). Soldat antippen, dann ein
  Ziel auf der Karte antippen. Tore lassen eigene Einheiten durch, Mauern nicht.
- Wellen: Die HUD-Anzeige ⚔️ zählt zur nächsten Welle herunter. Gegner
  marschieren aufs Lagerhaus zu; ist es eingemauert, brechen sie die
  günstigste Stelle auf. Ab Welle 3 kommen langsame, harte „Brecher" dazu,
  ab Welle 4 schießende „Plänkler".
- Wald ist endlich: Holzfäller roden ihn allmählich (Info-Panel zeigt
  „Kein Wald mehr"), gleichzeitig wächst Wald langsam nach — Holzwirtschaft
  will geplant sein.
  Fällt das Lagerhaus, ist das Spiel verloren — einmal pro Run kann per
  Werbe-Platzhalter weitergespielt werden.
- Straßen beschleunigen Träger und Soldaten; Forschung (im Bau-Menü unter
  „Forschung") verbessert Träger-Tempo, Turm- und Soldatenschaden.
- `window.__game` steht in der Browser-Konsole als Debug-Handle bereit.
