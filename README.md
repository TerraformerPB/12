# Burgspiel

Mobile-first Browser-Aufbauspiel im Stil von Stronghold: Wirtschaftsaufbau jetzt,
wellenbasierte Burgverteidigung später. Isometrische 2D-Ansicht, Touch-only bedienbar,
läuft ebenso mit Maus auf dem Desktop. **Aktueller Stand: Phase 4
(Wirtschaft, Verteidigung, Wellen, Straßen/Forschung/Tutorial) — Capacitor
und Monetarisierung sind vorbereitet.**

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
- **Phase 5 (vorbereitet) — Capacitor:** `capacitor.config.ts`, Pakete und
  Web-Manifest/Icon sind eingerichtet; der native Build läuft auf einem
  Rechner mit Android Studio (siehe unten). Safe-Areas/Lifecycle sind im
  Web-Build bereits berücksichtigt.
- **Phase 6 (Architektur) — Monetarisierung:** `monetization/Ads.ts` und
  `Iap.ts` definieren die Provider-Schnittstellen; der Dev-Stub zeigt einen
  Platzhalter-Countdown. Erster echter Use-Case ist eingebaut: einmal pro
  Run „Weiterspielen (Werbung)" nach Game Over. Für den Store-Build wird nur
  der Provider gegen AdMob/RevenueCat-Implementierungen getauscht.

## Play-Store-Build (Capacitor)

Auf einem Rechner mit Android Studio + JDK:

```bash
npm run build          # erzeugt dist/
npx cap add android    # einmalig: erstellt das native android/-Projekt
npx cap sync android   # kopiert dist/ + Plugins
npx cap open android   # in Android Studio bauen/signieren
```

Für Rewarded Ads/IAP im Store-Build: `@capacitor-community/admob` bzw. ein
IAP-Plugin installieren und in `Game.init` den `DevRewardedAdProvider` durch
die native Implementierung ersetzen — die Spiellogik bleibt unberührt.

## Spielhinweise

- Steinbruch ist nur direkt angrenzend an Fels platzierbar.
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
