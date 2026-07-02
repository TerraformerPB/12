import { describe, expect, it } from 'vitest';
import { fillPlaceholders } from '../src/domain/placeholders';

describe('fillPlaceholders', () => {
  it('ersetzt bekannte Platzhalter', () => {
    expect(fillPlaceholders('Hallo {name} von {firma}!', { name: 'Julia', firma: 'ACME' }))
      .toBe('Hallo Julia von ACME!');
  });

  it('lässt unbekannte und leere Platzhalter sichtbar stehen', () => {
    expect(fillPlaceholders('Hallo {name}, Ihr {projekt}', { name: '', projekt: undefined as unknown as string }))
      .toBe('Hallo {name}, Ihr {projekt}');
  });

  it('ersetzt mehrfach vorkommende Platzhalter', () => {
    expect(fillPlaceholders('{a} und {a}', { a: 'x' })).toBe('x und x');
  });
});
