# Asset-Spezifikation: Echte Sprites für Burgspiel

Das Spiel läuft vollständig mit programmatischen Platzhaltern. Echte Grafiken
werden **ohne Codeänderung** übernommen: PNG in `public/sprites/` legen und in
`public/sprites/manifest.json` eintragen — fertig. Nicht eingetragene Gebäude
behalten automatisch ihren Platzhalter, du kannst also Gebäude für Gebäude
umstellen.

## Perspektive & Raster

- Isometrisch 2:1 („Diamond"), Tile = **64 × 32 px**.
- Kamera-Zoom geht bis 2× — Sprites in **doppelter Zielgröße** anliefern
  (oder als 2x-Export), damit sie beim Heranzoomen scharf bleiben.
- PNG mit transparentem Hintergrund, Licht von **links oben** (Nordwest),
  Schlagschatten direkt unter dem Gebäude darf enthalten sein.

## Größen pro Gebäude

Die Bodenfläche eines Gebäudes mit Footprint `w × h` Tiles ist
`(w+h) × 32` px breit und `(w+h) × 16` px hoch; darüber kommt die
Gebäudehöhe. Richtwerte (Breite × Höhe, 1x — für 2x verdoppeln):

| Gebäude | Footprint | Sprite ca. (1x) |
|---|---|---|
| Hütte, Mauer, Tor, Straße | 1×1 | 64 × 70 px |
| Fischerhütte | 2×1 | 96 × 70 px |
| Holzfäller, Steinbruch, Erzmine, Mühle, Bäckerei, Brauerei, Schmiede, Lagerhaus, Wachturm | 2×2 | 128 × 110 px |
| Weizenfarm, Kaserne | 3×3 | 192 × 130 px |

## Ankerpunkt (wichtig!)

Das Spiel positioniert jedes Sprite über einen **Ankerpunkt**: die
Bildposition, die auf der **Mitte des hintersten (oben-links) Tiles** der
Bodenfläche liegt. Im Manifest gibst du an, wo dieser Punkt im Bild liegt
(`anchorX`/`anchorY` in Pixeln des Bildes). Faustregel: horizontal mittig
über der hinteren Bodenraute, vertikal = Bildhöhe minus `(w+h-1) × 16` px.

## Mitgelieferte Sprites & Generator

`public/sprites/` enthält bereits ein komplettes, selbst generiertes
Vektor-Art-Set (15 Gebäude, 2×-Auflösung) samt Manifest — erzeugt durch
`node scripts/generate-sprites.mjs` (braucht Playwright + Chromium).
Eigene/bessere Grafiken ersetzen einfach die jeweilige PNG-Datei oder den
Manifest-Eintrag. Rotierte Gebäude (z. B. gedrehte Fischerhütte) fallen
automatisch auf den eingebauten Platzhalter zurück.

## Manifest-Format

```json
{
  "buildings": {
    "lumberjack": { "file": "lumberjack.png", "anchorX": 128, "anchorY": 124, "scale": 0.5 },
    "tower": {
      "file": "tower.png", "anchorX": 64, "anchorY": 96,
      "levels": ["tower.png", "tower_l2.png", "tower_l3.png"]
    }
  }
}
```

- `scale`: 0.5 für Grafiken in 2×-Auflösung (empfohlen); `anchorX/Y` sind
  dann ebenfalls in 2×-Bildpixeln anzugeben.
- `levels` ist optional: ein Eintrag pro Ausbaustufe (1–3). Fehlt es,
  wird dieselbe Grafik für alle Stufen verwendet.
- Gültige Ids: `warehouse, lumberjack, quarry, mine, smithy, fishery, farm,
  mill, bakery, brewery, hut, road, roadStone, bridge, wall, gate, tower,
  barracks` (siehe `src/data/buildings.ts`).

## Stil-Briefing (für Künstler oder KI-Generierung)

> Isometrisches 2:1 Mittelalter-Aufbauspiel-Gebäude, Handpainted-Look
> (Stil: Stronghold / Die Siedler), kräftige Farben, Licht von links oben,
> transparenter Hintergrund, keine Umgebung/Boden außer der eigenen
> Bodenfläche, Blickwinkel exakt 2:1-Diamond (30°).

Bei KI-Tools: pro Gebäude generieren, freistellen, auf die Tabelle oben
herunterskalieren und die Bodenraute exakt aufs Raster legen (am besten die
Platzhalter-Screenshots als Größenreferenz daneben halten).

## Noch nicht über das Manifest austauschbar

Einheiten (Träger/Soldaten/Gegner), Terrain und Projektile werden weiterhin
programmatisch gezeichnet — ihr Austauschpunkt bleibt
`src/render/placeholders.ts` (geplant: Manifest-Unterstützung inkl.
Animations-Frames, sobald Gebäude-Art steht).
