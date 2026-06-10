# Burgspiel

Mobile-first Browser-Aufbauspiel im Stil von Stronghold: Wirtschaftsaufbau jetzt,
wellenbasierte Burgverteidigung später. Isometrische 2D-Ansicht, Touch-only bedienbar,
läuft ebenso mit Maus auf dem Desktop. **Aktueller Stand: Phase 1 (Wirtschaft).**

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

Danach die Id in `BUILD_MENU_ORDER` eintragen — Kosten, Ghost-Preview,
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
- **Phase 3 — Wellen & Gegner:** Wellen-Spawner, Kampfsystem (Türme schießen,
  Soldaten kämpfen), Gebäudeschaden, Game-Over/Score; Sound-Assets über den
  vorhandenen `SoundManager`. Gegner-Pathfinding behandelt Tore als blockiert
  (eigene Kostenfunktion auf dem `moveCost`-Hook).
- **Phase 4 — Inhalt & Komfort:** Straßen (billigere Pfadkosten), Tech-Tree,
  Tutorial, Sprite-Atlanten statt Platzhalter, Balancing-Pass.
- **Phase 5 — Capacitor:** Play-Store-Build, Safe-Areas/Lifecycle sind
  vorbereitet (DOM-UI, `visibilitychange`/`pagehide`-Persistenz).
- **Phase 6 — Monetarisierung:** Rewarded Ads + IAP über Capacitor-Plugins;
  Savegame-Migrationen über das `saveVersion`-Feld.

## Phase-1/2-Hinweise

- Steinbruch ist nur direkt angrenzend an Fels platzierbar.
- Träger holen Output bei Produzenten ab; Mühle/Bäckerei bekommen Input vom
  Lagerhaus geliefert (Lieferungen haben Priorität).
- Soldaten: Kaserne bauen → im Info-Panel rekrutieren (kostet Brot und einen
  Bevölkerungs-Slot, der dem Träger-Pool fehlt). Soldat antippen, dann ein
  Ziel auf der Karte antippen. Tore lassen eigene Einheiten durch, Mauern nicht.
- `window.__game` steht in der Browser-Konsole als Debug-Handle bereit.
