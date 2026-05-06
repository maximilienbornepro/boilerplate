import { describe, it, expect } from 'vitest';
import { stripEmDash } from '../../aiSkills/runSkill.js';

// Em-dash (—, U+2014) is a tell-tale sign of AI-generated text. The
// runSkill wrapper applies this sanitiser to every model output so
// no em-dash can slip through to the user-facing surfaces.

describe('aiSkills — stripEmDash sanitiser', () => {
  it('replaces space-em-dash-space with comma-space (mid-sentence)', () => {
    expect(stripEmDash('Le candidat est PO senior — il a 8 ans d\'expérience.'))
      .toBe('Le candidat est PO senior, il a 8 ans d\'expérience.');
  });

  it('replaces bare em-dash with hyphen', () => {
    expect(stripEmDash('Tink—Cossette')).toBe('Tink-Cossette');
  });

  it('handles multiple em-dashes in the same string', () => {
    expect(stripEmDash('Foo — bar — baz'))
      .toBe('Foo, bar, baz');
  });

  it('mixes both forms cleanly', () => {
    expect(stripEmDash('Foo — bar—baz'))
      .toBe('Foo, bar-baz');
  });

  it('passes through text with no em-dash unchanged', () => {
    const s = 'Plain text with hyphens - and en-dashes – and commas, fine.';
    expect(stripEmDash(s)).toBe(s);
  });

  it('preserves en-dash (–, U+2013) used for ranges', () => {
    expect(stripEmDash('2020–2024')).toBe('2020–2024');
  });

  it('handles JSON-like content without breaking structure', () => {
    const json = '{"answer": "Je suis le bon profil — voici pourquoi : 8 ans d\'expérience."}';
    expect(stripEmDash(json))
      .toBe('{"answer": "Je suis le bon profil, voici pourquoi : 8 ans d\'expérience."}');
  });

  it('returns empty for empty input', () => {
    expect(stripEmDash('')).toBe('');
  });
});
