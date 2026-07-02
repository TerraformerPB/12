/**
 * Ersetzt Platzhalter der Form {schluessel} in Vorlagen (Outreach, Verträge).
 * Unbekannte Platzhalter bleiben sichtbar stehen, damit man sie beim
 * Gegenlesen sofort findet.
 */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = values[key];
    return v !== undefined && v !== '' ? v : match;
  });
}
