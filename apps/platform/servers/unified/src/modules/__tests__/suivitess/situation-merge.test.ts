import { describe, it, expect } from 'vitest';
import { mergeSituationAppend } from '../../suivitess/situationMerge.js';

const TODAY = '28/04/2026';

describe('suivitess · mergeSituationAppend', () => {
  it('appends a fresh block when current is empty', () => {
    const out = mergeSituationAppend('', 'Mise à jour automatique en date du 28/04/2026 :\nfact1', TODAY);
    expect(out).toBe('Mise à jour automatique en date du 28/04/2026 :\nfact1');
  });

  it('appends with a blank-line separator when no same-day header exists', () => {
    const out = mergeSituationAppend('A', 'Mise à jour automatique en date du 28/04/2026 :\nfact1', TODAY);
    expect(out).toBe('A\n\nMise à jour automatique en date du 28/04/2026 :\nfact1');
  });

  it('strips the duplicate header on a second same-day import', () => {
    const current = 'A\n\nMise à jour automatique en date du 28/04/2026 :\nfact1';
    const append  = 'Mise à jour automatique en date du 28/04/2026 :\nfact2';
    const out = mergeSituationAppend(current, append, TODAY);
    expect(out).toBe('A\n\nMise à jour automatique en date du 28/04/2026 :\nfact1\nfact2');
    // Crucially : the date header appears only ONCE.
    expect(out.match(/Mise à jour/g)?.length).toBe(1);
  });

  it('keeps separate headers across days', () => {
    const current = 'A\n\nMise à jour automatique en date du 27/04/2026 :\nfact1';
    const append  = 'Mise à jour automatique en date du 28/04/2026 :\nfact2';
    const out = mergeSituationAppend(current, append, TODAY);
    expect(out).toBe(
      'A\n\nMise à jour automatique en date du 27/04/2026 :\nfact1\n\nMise à jour automatique en date du 28/04/2026 :\nfact2',
    );
    expect(out.match(/Mise à jour/g)?.length).toBe(2);
  });

  it('strips a leading "— " on header lines coming from legacy data', () => {
    const current = 'A\n\n— Mise à jour automatique en date du 28/04/2026 :\nfact1';
    const append  = 'Mise à jour automatique en date du 28/04/2026 :\nfact2';
    const out = mergeSituationAppend(current, append, TODAY);
    // Em-dash is gone, header appears once, both facts present.
    expect(out).not.toContain('— Mise à jour');
    expect(out.match(/Mise à jour/g)?.length).toBe(1);
    expect(out).toContain('fact1');
    expect(out).toContain('fact2');
  });

  it('strips a leading "— " on the incoming appendText too', () => {
    const append = '— Mise à jour automatique en date du 28/04/2026 :\nfact1';
    const out = mergeSituationAppend('A', append, TODAY);
    expect(out).toBe('A\n\nMise à jour automatique en date du 28/04/2026 :\nfact1');
  });

  it('also recognises the legacy "Mise à jour du DD/MM" header', () => {
    const current = 'A\n\nMise à jour du 28/04 :\nfact1';
    const append  = 'Mise à jour automatique en date du 28/04/2026 :\nfact2';
    // The current header is for "28/04" without year — does NOT match
    // today=28/04/2026, so we fall back to a fresh append (acceptable).
    const out = mergeSituationAppend(current, append, TODAY);
    expect(out).toBe('A\n\nMise à jour du 28/04 :\nfact1\n\nMise à jour automatique en date du 28/04/2026 :\nfact2');
  });

  it('matches the legacy header WITH the full date', () => {
    const current = 'A\n\nMise à jour du 28/04/2026 :\nfact1';
    const append  = 'Mise à jour automatique en date du 28/04/2026 :\nfact2';
    const out = mergeSituationAppend(current, append, TODAY);
    // Legacy "Mise à jour du <today>" recognised → header dedup.
    expect(out.match(/Mise à jour/g)?.length).toBe(1);
    expect(out).toContain('fact1');
    expect(out).toContain('fact2');
  });

  it('drops a no-op append (whitespace only) without touching current', () => {
    const out = mergeSituationAppend('A', '   ', TODAY);
    expect(out).toBe('A');
  });

  it('handles three successive same-day imports — single header, three facts', () => {
    let s = '';
    s = mergeSituationAppend(s, 'Mise à jour automatique en date du 28/04/2026 :\nfact1', TODAY);
    s = mergeSituationAppend(s, 'Mise à jour automatique en date du 28/04/2026 :\nfact2', TODAY);
    s = mergeSituationAppend(s, 'Mise à jour automatique en date du 28/04/2026 :\nfact3', TODAY);
    expect(s.match(/Mise à jour/g)?.length).toBe(1);
    expect(s).toContain('fact1');
    expect(s).toContain('fact2');
    expect(s).toContain('fact3');
  });

  it('handles facts-only appendText (no header) when current has today\'s header', () => {
    const current = 'A\n\nMise à jour automatique en date du 28/04/2026 :\nfact1';
    const out = mergeSituationAppend(current, 'fact2', TODAY);
    expect(out).toBe('A\n\nMise à jour automatique en date du 28/04/2026 :\nfact1\nfact2');
  });
});
