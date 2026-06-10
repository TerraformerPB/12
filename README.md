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
- **Phase 9 (Konzept) — Burg-Duell (PvP):** Asynchroner 1-gegen-1-Modus im
  Clash-of-Clans-Stil: Man greift den Burg-Schnappschuss eines anderen
  Spielers an, aber statt Karten/Truppen direkt zu steuern, schickt das
  eigene Wirtschaftssystem automatisch Angriffswellen — wer seine Produktion
  (Waffen, Brot, Bevölkerung) besser managt, stellt die stärkeren Wellen.
  Benötigt erstmals ein Backend (Matchmaking, Burg-Snapshots, Replays);
  die deterministische Simulation (fixe Tickrate, Seed-Terrain) ist dafür
  die richtige Grundlage, weil Kämpfe server- wie clientseitig identisch
  nachgerechnet werden können.

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
  günstigste Stelle auf. Ab Welle 3 kommen langsame, harte „Brecher" dazu.
  Fällt das Lagerhaus, ist das Spiel verloren — einmal pro Run kann per
  Werbe-Platzhalter weitergespielt werden.
- Straßen beschleunigen Träger und Soldaten; Forschung (im Bau-Menü unter
  „Forschung") verbessert Träger-Tempo, Turm- und Soldatenschaden.
- `window.__game` steht in der Browser-Konsole als Debug-Handle bereit.
