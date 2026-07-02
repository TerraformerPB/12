import { describe, expect, it } from 'vitest';
import { nextDocNumber } from '../src/domain/numbering';

describe('nextDocNumber', () => {
  it('startet bei 001', () => {
    expect(nextDocNumber('R', 2026, [])).toBe('R-2026-001');
  });

  it('zählt fortlaufend weiter und ignoriert andere Jahre/Präfixe', () => {
    const existing = ['R-2026-001', 'R-2026-007', 'R-2025-099', 'A-2026-020'];
    expect(nextDocNumber('R', 2026, existing)).toBe('R-2026-008');
    expect(nextDocNumber('A', 2026, existing)).toBe('A-2026-021');
  });

  it('kommt mit dreistelligem Überlauf klar', () => {
    expect(nextDocNumber('R', 2026, ['R-2026-999'])).toBe('R-2026-1000');
  });
});
