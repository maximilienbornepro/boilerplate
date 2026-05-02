import { describe, it, expect } from 'vitest';
import {
  dedupNearDuplicateDocumentProposals,
  normalizeTitleForCompare,
} from '../../suivitess/proposalDedup.js';
import type { FinalDocumentProposal } from '../../aiSkills/analyzeSourcePipeline.js';

// Tiny helpers to keep fixtures readable.
function newSubject(title: string, situation = '', extra: Partial<FinalDocumentProposal> = {}): FinalDocumentProposal {
  return {
    action: 'create_subject',
    title,
    situation,
    sectionId: 'sec-1',
    sectionName: 'Existing',
    responsibility: null,
    status: '🔴 à faire',
    reason: '',
    sourceRawQuotes: [],
    sourceEntities: [],
    sourceParticipants: [],
    ...extra,
  } as FinalDocumentProposal;
}

function newSection(sectionName: string, subjectTitle: string, extra: Partial<FinalDocumentProposal> = {}): FinalDocumentProposal {
  return {
    action: 'create_section',
    sectionName,
    subjects: [{ title: subjectTitle, situation: '', responsibility: null, status: '🔴 à faire' }],
    reason: '',
    sourceRawQuotes: [],
    sourceEntities: [],
    sourceParticipants: [],
    ...extra,
  } as FinalDocumentProposal;
}

function enrich(subjectTitle: string): FinalDocumentProposal {
  return {
    action: 'enrich',
    subjectId: 'subj-existing',
    subjectTitle,
    sectionName: 'Existing',
    appendText: 'Some update',
    reason: '',
  } as FinalDocumentProposal;
}

describe('normalizeTitleForCompare', () => {
  it('makes accents and case irrelevant', () => {
    expect(normalizeTitleForCompare('Spec Smart TV')).toBe(normalizeTitleForCompare('spéc smârt tv'));
  });

  it('drops punctuation and stop-words', () => {
    expect(normalizeTitleForCompare('Refonte de la page de login'))
      .toBe(normalizeTitleForCompare('refonte page login'));
  });

  it('returns empty for null / blank', () => {
    expect(normalizeTitleForCompare(null)).toBe('');
    expect(normalizeTitleForCompare('  ')).toBe('');
  });

  it('keeps numeric tokens (e.g. age 6)', () => {
    expect(normalizeTitleForCompare('Slider 6 ans')).toContain('6');
    expect(normalizeTitleForCompare('Slider 6 ans'))
      .not.toBe(normalizeTitleForCompare('Slider 8 ans'));
  });
});

describe('dedupNearDuplicateDocumentProposals — subject-title pass', () => {
  it('merges two create_subject with the same normalized title', () => {
    // Same wording with case + accent + stop-word differences →
    // normalizes to the same key, must merge. Keeps the normalization
    // conservative : the AI has to be saying truly the same thing.
    const input = [
      newSubject('Spec Smart TV', 'Spec figée jeudi'),
      newSubject('spéc de la smart tv', 'Validation produit OK'),
    ];
    const { deduped, mergedCount } = dedupNearDuplicateDocumentProposals(input);
    expect(mergedCount).toBe(1);
    expect(deduped).toHaveLength(1);
    if (deduped[0].action === 'create_subject') {
      // Both situations preserved, joined by newline.
      expect(deduped[0].situation).toContain('Spec figée jeudi');
      expect(deduped[0].situation).toContain('Validation produit OK');
      expect(deduped[0].reason).toContain('fusionné');
    }
  });

  it('does NOT merge subjects that differ on a meaningful word', () => {
    // Conservative : "Bug paiement" vs "Refus paiement" differ on the
    // first word, which carries semantics — must stay separate.
    const input = [
      newSubject('Bug paiement Stripe'),
      newSubject('Refus paiement Stripe'),
    ];
    const { deduped, mergedCount } = dedupNearDuplicateDocumentProposals(input);
    expect(mergedCount).toBe(0);
    expect(deduped).toHaveLength(2);
  });

  it('keeps two distinct subjects untouched', () => {
    const input = [
      newSubject('Slider 6 ans'),
      newSubject('Slider 8 ans'),
    ];
    const { deduped, mergedCount } = dedupNearDuplicateDocumentProposals(input);
    expect(mergedCount).toBe(0);
    expect(deduped).toHaveLength(2);
  });

  it('does not touch enrich proposals (existing-subject reference)', () => {
    const input = [
      enrich('Migration PostgreSQL'),
      enrich('Migration PostgreSQL'),
    ];
    const { deduped, mergedCount } = dedupNearDuplicateDocumentProposals(input);
    // Two enrich pointing at the same existing subject : we don't fuse
    // them because the appendText is independent — the apply step
    // handles the actual concatenation. Pass through untouched.
    expect(mergedCount).toBe(0);
    expect(deduped).toHaveLength(2);
  });

  it('unions the source-context arrays without duplicates', () => {
    const input = [
      newSubject('OAuth iframe', 'A', { sourceEntities: ['OAuth', 'iframe'], sourceRawQuotes: ['quote-1'] }),
      newSubject('OAuth iframe', 'B', { sourceEntities: ['iframe', 'SFR'], sourceRawQuotes: ['quote-2'] }),
    ];
    const { deduped } = dedupNearDuplicateDocumentProposals(input);
    expect(deduped[0].sourceEntities).toEqual(['OAuth', 'iframe', 'SFR']);
    expect(deduped[0].sourceRawQuotes).toEqual(['quote-1', 'quote-2']);
  });
});

describe('dedupNearDuplicateDocumentProposals — section-name pass', () => {
  it('merges two create_section with the same normalized section name', () => {
    const input = [
      newSection('Smart TV', 'Sujet A'),
      newSection('Smart TV ', 'Sujet B'), // trailing space → same key
    ];
    const { deduped, mergedCount } = dedupNearDuplicateDocumentProposals(input);
    expect(mergedCount).toBe(1);
    expect(deduped).toHaveLength(1);
    if (deduped[0].action === 'create_section') {
      expect(deduped[0].subjects?.map(s => s.title)).toEqual(['Sujet A', 'Sujet B']);
    }
  });

  it('also dedups subjects within a merged section by their normalized title', () => {
    const input = [
      newSection('Smart TV', 'Bug iframe'),
      newSection('SmartTV', 'Bug iframe'), // duplicate subject title in the merged section
    ];
    const { deduped } = dedupNearDuplicateDocumentProposals(input);
    expect(deduped).toHaveLength(1);
    if (deduped[0].action === 'create_section') {
      expect(deduped[0].subjects).toHaveLength(1);
    }
  });

  it('keeps two distinct sections untouched', () => {
    const input = [
      newSection('Smart TV', 'A'),
      newSection('Backend API', 'B'),
    ];
    const { deduped, mergedCount } = dedupNearDuplicateDocumentProposals(input);
    expect(mergedCount).toBe(0);
    expect(deduped).toHaveLength(2);
  });
});

describe('dedupNearDuplicateDocumentProposals — mixed', () => {
  it('handles enrich + create_subject + create_section all in one batch', () => {
    const input = [
      enrich('Existing thing'),
      newSubject('Bug paiement', 'A'),
      newSubject('bug paiement', 'B'), // dup of #2
      newSection('Smart TV', 'X'),
      newSection('Smart TV', 'Y'), // dup of #4
    ];
    const { deduped, mergedCount } = dedupNearDuplicateDocumentProposals(input);
    expect(mergedCount).toBe(2); // 1 subject merge + 1 section merge
    expect(deduped).toHaveLength(3);
  });

  it('handles empty input', () => {
    expect(dedupNearDuplicateDocumentProposals([])).toEqual({
      deduped: [],
      survivorOriginalIndices: [],
      mergedCount: 0,
    });
  });

  it('exposes survivorOriginalIndices for parallel-array re-alignment', () => {
    const input = [
      newSubject('Topic A'),
      newSubject('Topic B'),
      newSubject('topic a'), // dup of #0 (case difference only)
    ];
    const { deduped, survivorOriginalIndices, mergedCount } = dedupNearDuplicateDocumentProposals(input);
    // 2 survivors : Topic A (merged with #2) at original idx 0, Topic B at idx 1.
    expect(mergedCount).toBe(1);
    expect(deduped).toHaveLength(2);
    expect(survivorOriginalIndices).toHaveLength(2);
    // Each survivor's index points to the FIRST proposal of its merge group.
    const survivorTitles = deduped.map(p => p.action === 'create_subject' ? p.title : '');
    const indexedTitles = survivorOriginalIndices.map(i => {
      const orig = input[i];
      return orig.action === 'create_subject' ? orig.title : '';
    });
    expect(survivorTitles).toEqual(indexedTitles);
  });
});
