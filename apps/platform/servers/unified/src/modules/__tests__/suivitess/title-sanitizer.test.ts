import { describe, it, expect } from 'vitest';
import {
  sanitizeProposedTitle,
  sanitizeProposedTitleNullable,
} from '../../suivitess/titleSanitizer.js';

describe('sanitizeProposedTitle', () => {
  // ── Real-world regression cases the user complained about ─────────────

  it('strips Tracking prefix + Jira ticket ref together', () => {
    expect(sanitizeProposedTitle('Tracking TVFREE-2062 : spec smart TV et click.action'))
      .toBe('spec smart TV et click.action');
  });

  it('strips standalone Jira ticket from middle of title', () => {
    expect(sanitizeProposedTitle('Bug TVSMART-2181 slider âge 6 ans'))
      .toBe('Bug slider âge 6 ans');
  });

  it('strips stacked email prefixes', () => {
    expect(sanitizeProposedTitle('Re: Re: Fwd: TVSMART-2089 problème iframe SFR'))
      .toBe('problème iframe SFR');
  });

  it('strips French Suivi prefix', () => {
    expect(sanitizeProposedTitle('Suivi de TVSMART-1000 : refonte login'))
      .toBe('refonte login');
  });

  it('strips version markers', () => {
    expect(sanitizeProposedTitle('Migration PostgreSQL v16 prévue'))
      .toBe('Migration PostgreSQL prévue');
    expect(sanitizeProposedTitle('Release version 1.24.1 desktop'))
      .toBe('Release desktop');
  });

  it('strips dates in DD/MM and ISO formats', () => {
    expect(sanitizeProposedTitle('Call Amazon — 15/04')).toBe('Call Amazon');
    expect(sanitizeProposedTitle('Mission annulée 04/05/2026')).toBe('Mission annulée');
    expect(sanitizeProposedTitle('Daily 2026-04-29')).toBe('Daily');
  });

  it('strips GitHub PR/issue refs', () => {
    expect(sanitizeProposedTitle('Refonte auth #1234')).toBe('Refonte auth');
    // The sanitizer kills the ticket ref but doesn't try to fix
    // surrounding syntactic noise the AI added (parens, commas) — that
    // would risk false positives on legit punctuation. The prompt is
    // already telling the model not to add this kind of decoration.
  });

  it('strips embedded URLs', () => {
    expect(sanitizeProposedTitle('Migration DB voir https://wiki.example/migration'))
      .toBe('Migration DB voir');
  });

  // ── Conservative behaviour : never break legit titles ─────────────────

  it('leaves "Slider 6 ans" alone (number is part of the topic)', () => {
    expect(sanitizeProposedTitle('Slider 6 ans')).toBe('Slider 6 ans');
  });

  it('leaves "Migration PostgreSQL" alone', () => {
    expect(sanitizeProposedTitle('Migration PostgreSQL')).toBe('Migration PostgreSQL');
  });

  it('leaves a clean noun phrase untouched', () => {
    expect(sanitizeProposedTitle('Validation budget Q3')).toBe('Validation budget Q3');
  });

  it('does not strip "v" without dotted version', () => {
    // "TV" inside a word should be preserved.
    expect(sanitizeProposedTitle('Smart TV Samsung 2024')).toBe('Smart TV Samsung 2024');
  });

  it('does not strip non-ticket short codes (C2, R2)', () => {
    expect(sanitizeProposedTitle('Réunion C2 produit')).toBe('Réunion C2 produit');
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it('returns the trimmed original when sanitization would empty it out', () => {
    // 100% noise → fallback to original (never return empty).
    expect(sanitizeProposedTitle('  TVSMART-2089  ')).toBe('TVSMART-2089');
  });

  it('handles null / undefined / empty', () => {
    expect(sanitizeProposedTitle(null)).toBe('');
    expect(sanitizeProposedTitle(undefined)).toBe('');
    expect(sanitizeProposedTitle('')).toBe('');
  });

  it('collapses whitespace introduced by the strips', () => {
    expect(sanitizeProposedTitle('Bug   TVSMART-2089    sur   le slider'))
      .toBe('Bug sur le slider');
  });

  it('preserves accents and special characters', () => {
    expect(sanitizeProposedTitle('Tracking TVFREE-2062: éàç & œ')).toBe('éàç & œ');
  });
});

describe('sanitizeProposedTitleNullable', () => {
  it('returns null for null / undefined / blank', () => {
    expect(sanitizeProposedTitleNullable(null)).toBeNull();
    expect(sanitizeProposedTitleNullable(undefined)).toBeNull();
    expect(sanitizeProposedTitleNullable('')).toBeNull();
    expect(sanitizeProposedTitleNullable('   ')).toBeNull();
  });

  it('sanitizes non-empty input', () => {
    expect(sanitizeProposedTitleNullable('Tracking TVFREE-2062 : spec'))
      .toBe('spec');
  });
});
