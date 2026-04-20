import { describe, it, expect } from 'vitest';
import {
  cleanSituation,
  situationNeedsCleaning,
} from '../../suivitess/legacyBulletCleanup.js';

describe('legacyBulletCleanup.cleanSituation', () => {
  it('returns empty string for null or undefined input', () => {
    expect(cleanSituation(null)).toBe('');
    expect(cleanSituation(undefined)).toBe('');
    expect(cleanSituation('')).toBe('');
  });

  it('leaves clean content unchanged (idempotent)', () => {
    const clean = 'Call Amazon ce matin.\nPOC demandé pour fin mai.';
    expect(cleanSituation(clean)).toBe(clean);
    expect(cleanSituation(cleanSituation(clean))).toBe(clean);
  });

  it('strips a leading • bullet with its following space', () => {
    expect(cleanSituation('• Call Amazon ce matin.')).toBe('Call Amazon ce matin.');
  });

  it('strips • bullets from every line independently', () => {
    const before = '• Call Amazon ce matin.\n• POC demandé pour fin mai.\n• Contact technique : Sarah.';
    const after = 'Call Amazon ce matin.\nPOC demandé pour fin mai.\nContact technique : Sarah.';
    expect(cleanSituation(before)).toBe(after);
  });

  it('strips nested bullets (◦ ▪ ▸) too — they come from level 1-3', () => {
    const before = '• Niveau 0\n  ◦ Niveau 1\n    ▪ Niveau 2\n      ▸ Niveau 3';
    const after = 'Niveau 0\n  Niveau 1\n    Niveau 2\n      Niveau 3';
    expect(cleanSituation(before)).toBe(after);
  });

  it('preserves indentation (2 spaces per level) when stripping bullets', () => {
    const before = '  • Sous-point niveau 1';
    const after = '  Sous-point niveau 1';
    expect(cleanSituation(before)).toBe(after);
  });

  it('normalizes leading tabs to 2 spaces per tab', () => {
    // Legacy prompts told the AI to use \t for indent — but the editor
    // counts raw chars and divides by 2, so tabs rendered as level 0.
    const before = '\t• Tab + bullet legacy\n\t\t• Deux tabs + bullet';
    const after = '  Tab + bullet legacy\n    Deux tabs + bullet';
    expect(cleanSituation(before)).toBe(after);
  });

  it('does NOT strip leading - or * (could be sentence dashes)', () => {
    // `-` can be a sentence-leading dash in French. We only clean the
    // unicode bullet glyphs we know come from the AI writers.
    expect(cleanSituation('- Ça peut être une simple ligne')).toBe('- Ça peut être une simple ligne');
    expect(cleanSituation('* Un astérisque pas forcément une puce')).toBe('* Un astérisque pas forcément une puce');
  });

  it('preserves bold and strikethrough markers inside the line', () => {
    const before = '• Downtime **28 min** sous les 30\n• ~~Ancien sujet~~';
    const after = 'Downtime **28 min** sous les 30\n~~Ancien sujet~~';
    expect(cleanSituation(before)).toBe(after);
  });

  it('preserves blank lines and trailing whitespace structure', () => {
    const before = '• Ligne 1\n\n• Ligne 3';
    const after = 'Ligne 1\n\nLigne 3';
    expect(cleanSituation(before)).toBe(after);
  });

  it('handles a bullet without a following space', () => {
    expect(cleanSituation('•Colle sans espace')).toBe('Colle sans espace');
  });

  it('is idempotent on a cleaned output (double-run = same result)', () => {
    const before = '• Ligne 1\n  ◦ Ligne 2';
    const once = cleanSituation(before);
    const twice = cleanSituation(once);
    expect(twice).toBe(once);
  });
});

describe('legacyBulletCleanup.situationNeedsCleaning', () => {
  it('returns false for already-clean content', () => {
    expect(situationNeedsCleaning('Clean content.')).toBe(false);
    expect(situationNeedsCleaning('  Clean with indent.')).toBe(false);
    expect(situationNeedsCleaning('')).toBe(false);
    expect(situationNeedsCleaning(null)).toBe(false);
  });

  it('returns true when at least one line has a legacy bullet', () => {
    expect(situationNeedsCleaning('• Dirty')).toBe(true);
    expect(situationNeedsCleaning('Clean\n• Dirty below')).toBe(true);
  });

  it('returns true when leading tabs are present', () => {
    expect(situationNeedsCleaning('\tTab indent')).toBe(true);
  });
});
