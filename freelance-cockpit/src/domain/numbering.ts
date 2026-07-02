function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Nächste fortlaufende Belegnummer im Schema PREFIX-JAHR-NNN,
 * z. B. R-2026-007. Lücken werden nicht wiederverwendet.
 */
export function nextDocNumber(prefix: string, year: number, existing: string[]): string {
  const re = new RegExp(`^${escapeRegExp(prefix)}-${year}-(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = re.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
}
