import { describe, it, expect } from 'vitest';
import { mergeSituationAppend } from '../../suivitess/situationMerge.js';

// The new T3 prompt emits a list of lines (each potentially prefixed
// with `[!]`, indented, possibly wrapped in `~~…~~`). The merger
// integrates these lines into the existing situation. The legacy
// `today` argument is preserved on the signature for backward compat
// with the existing callers but is fully ignored.
describe('suivitess · mergeSituationAppend', () => {
  it('appends a net-new line at the end', () => {
    const current = 'Migration PostgreSQL v16 planifiée.\n  Tests staging OK.';
    const append = '  [!] Downtime final **28 min**.';
    const out = mergeSituationAppend(current, append);
    expect(out).toBe(
      'Migration PostgreSQL v16 planifiée.\n  Tests staging OK.\n  [!] Downtime final **28 min**.',
    );
  });

  it('drops a duplicate net-new line (same text already present)', () => {
    const current = 'A\n  Tests staging OK.';
    // Same text content, modulo the `[!]` prefix and indentation
    // whitespace. Must be dropped.
    const append = '  [!] Tests staging OK.';
    const out = mergeSituationAppend(current, append);
    expect(out).toBe(current);
  });

  it('strikethrough line REPLACES the matching existing live line in place', () => {
    const current = 'A\n  Migration prévue mercredi.\n  Tests staging OK.';
    const append = '  [!]~~Migration prévue mercredi.~~';
    const out = mergeSituationAppend(current, append);
    expect(out).toBe(
      'A\n  [!]~~Migration prévue mercredi.~~\n  Tests staging OK.',
    );
    // No extra line was appended — it really replaced in place.
    expect(out.split('\n')).toHaveLength(3);
  });

  it('strikethrough line with NO matching existing line is appended at the end', () => {
    const current = 'A\n  Other fact.';
    const append = '  [!]~~Unrelated closure.~~';
    const out = mergeSituationAppend(current, append);
    expect(out).toBe('A\n  Other fact.\n  [!]~~Unrelated closure.~~');
  });

  it('preserves the `[!]` prefix in the merged output (round-trip)', () => {
    const current = 'A';
    const append = '  [!] Bouygues : recette data en cours.';
    const out = mergeSituationAppend(current, append);
    expect(out).toContain('[!] Bouygues : recette data en cours.');
  });

  it('leaves legacy `Mise à jour automatique en date du …` lines in currentSituation in place', () => {
    const current = 'Mise à jour automatique en date du 28/04/2026 :\n  Old fact.';
    const append = '  [!] Brand new fact.';
    const out = mergeSituationAppend(current, append);
    expect(out).toContain('Mise à jour automatique en date du 28/04/2026 :');
    expect(out).toContain('  Old fact.');
    expect(out).toContain('  [!] Brand new fact.');
  });

  it('silently drops a legacy date header that slips into appendText (defense in depth)', () => {
    const current = 'A';
    const append = 'Mise à jour automatique en date du 28/04/2026 :\n  [!] New fact.';
    const out = mergeSituationAppend(current, append);
    expect(out).not.toMatch(/Mise à jour automatique/);
    expect(out).toBe('A\n  [!] New fact.');
  });

  it('also drops the older `Mise à jour du DD/MM` header form if it slips through', () => {
    const current = 'A';
    const append = '— Mise à jour du 28/04 :\n  [!] New fact.';
    const out = mergeSituationAppend(current, append);
    expect(out).not.toMatch(/Mise à jour/);
    expect(out).toBe('A\n  [!] New fact.');
  });

  it('drops a no-op append (whitespace only) without touching current', () => {
    const out = mergeSituationAppend('A', '   ');
    expect(out).toBe('A');
  });

  it('still accepts the legacy `today` argument as a no-op (backward compat)', () => {
    const out = mergeSituationAppend('A', '  [!] New fact.', '28/04/2026');
    expect(out).toBe('A\n  [!] New fact.');
  });

  it('handles a mix of additions and strikethroughs in a single appendText', () => {
    const current = 'A\n  Migration prévue mercredi.\n  Tests staging OK.';
    const append = [
      '  [!]~~Migration prévue mercredi.~~',
      '  [!] Migration validée mercredi.',
      '  [!] Downtime final **28 min**.',
    ].join('\n');
    const out = mergeSituationAppend(current, append);
    const lines = out.split('\n');
    // The closure replaced line 1 in place :
    expect(lines[0]).toBe('A');
    expect(lines[1]).toBe('  [!]~~Migration prévue mercredi.~~');
    expect(lines[2]).toBe('  Tests staging OK.');
    // The two new facts are appended :
    expect(lines[3]).toBe('  [!] Migration validée mercredi.');
    expect(lines[4]).toBe('  [!] Downtime final **28 min**.');
    expect(lines).toHaveLength(5);
  });

  it('does NOT match a strikethrough closure against a line at a different indentation level', () => {
    // The closure targets `Migration prévue` at level 1 (2 spaces),
    // but the existing line is at level 2 (4 spaces). Must NOT replace
    // — it's appended instead.
    const current = 'A\n    Migration prévue mercredi.';
    const append = '  [!]~~Migration prévue mercredi.~~';
    const out = mergeSituationAppend(current, append);
    expect(out).toBe(
      'A\n    Migration prévue mercredi.\n  [!]~~Migration prévue mercredi.~~',
    );
  });
});
