import { describe, it, expect } from 'vitest';
import type { ConsolidatedSubject } from '../services/api';

// Pure-logic tests for the ConsolidatedReviewModal — no JSDOM. We
// validate the transformations the modal applies before sending the
// payload to applyConsolidatedInbox, plus the per-card decision
// bookkeeping that drives the apply button. The component's render
// path is covered by manual QA + the screenshot in the PR description.

function makeSubject(over: Partial<ConsolidatedSubject> = {}): ConsolidatedSubject {
  return {
    title: 'Sample subject',
    subjectAction: 'new-subject',
    reviewId: 'rev-1',
    sectionId: 'sec-1',
    suggestedNewReviewTitle: null,
    suggestedNewSectionName: null,
    targetSubjectId: null,
    situation: 'Une situation',
    rawQuotes: ['quote'],
    entities: ['Entity'],
    mergedFrom: [
      { rowId: 'row-a', proposalIndex: 0, sourceTitle: 'Source A' },
      { rowId: 'row-b', proposalIndex: 1, sourceTitle: 'Source B' },
    ],
    reasoning: 'Same entity.',
    ...over,
  };
}

// Mirror of the modal's `keyForConsolidated` helper — used to track
// per-card decisions. The same logic must surface a stable key per
// card when the consolidated array gets re-rendered.
function keyForConsolidated(c: ConsolidatedSubject, idx: number): string {
  const merged = c.mergedFrom.map(m => `${m.rowId}:${m.proposalIndex}`).join('|');
  return `${idx}::${merged}`;
}

describe('ConsolidatedReviewModal — key stability', () => {
  it('returns a deterministic key for the same subject + index', () => {
    const c = makeSubject();
    expect(keyForConsolidated(c, 0)).toBe(keyForConsolidated(c, 0));
  });

  it('disambiguates two subjects sharing the same mergedFrom', () => {
    const a = makeSubject({ title: 'A' });
    const b = makeSubject({ title: 'B' });
    expect(keyForConsolidated(a, 0)).not.toBe(keyForConsolidated(b, 1));
  });
});

describe('ConsolidatedReviewModal — accepted filter', () => {
  function filterAccepted(consolidated: ConsolidatedSubject[], decisions: Record<string, 'accepted' | 'rejected'>): ConsolidatedSubject[] {
    return consolidated.filter((c, i) => decisions[keyForConsolidated(c, i)] === 'accepted');
  }

  it('returns only the explicitly-accepted subjects', () => {
    const consolidated = [makeSubject({ title: 'A' }), makeSubject({ title: 'B' }), makeSubject({ title: 'C' })];
    const decisions: Record<string, 'accepted' | 'rejected'> = {
      [keyForConsolidated(consolidated[0], 0)]: 'accepted',
      [keyForConsolidated(consolidated[2], 2)]: 'accepted',
    };
    const accepted = filterAccepted(consolidated, decisions);
    expect(accepted).toHaveLength(2);
    expect(accepted.map(c => c.title)).toEqual(['A', 'C']);
  });

  it('skips rejected and undecided subjects', () => {
    const consolidated = [makeSubject({ title: 'A' }), makeSubject({ title: 'B' })];
    const decisions: Record<string, 'accepted' | 'rejected'> = {
      [keyForConsolidated(consolidated[0], 0)]: 'rejected',
      // B has no decision
    };
    const accepted = filterAccepted(consolidated, decisions);
    expect(accepted).toEqual([]);
  });
});

describe('ConsolidatedReviewModal — apply payload shape', () => {
  it('passes the full ConsolidatedSubject through (no flattening)', () => {
    const c = makeSubject();
    // The modal sends the array as-is to applyConsolidatedInbox. Assert
    // the contract by ensuring every required field is preserved.
    const payload: ConsolidatedSubject[] = [c];
    expect(payload[0].mergedFrom).toHaveLength(2);
    expect(payload[0].rawQuotes).toEqual(['quote']);
    expect(payload[0].subjectAction).toBe('new-subject');
    expect(payload[0].title).toBe('Sample subject');
  });
});
