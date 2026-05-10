import { describe, it, expect } from 'vitest';
import {
  countInboxProposalStats,
  formatStatsLine,
} from '../components/InboxPage/inboxStats';

// Sample shape mirrors FinalReviewProposal — only the fields the
// helper actually inspects are populated.
const propose = (over: Record<string, unknown>) => ({
  title: 'x', situation: '', status: '', responsibility: null,
  action: 'existing-review', reviewId: 'doc1',
  suggestedNewReviewTitle: null,
  sectionAction: 'existing-section', sectionId: 'sec1',
  suggestedNewSectionName: null,
  subjectAction: 'new-subject', targetSubjectId: null,
  ...over,
});

describe('inboxStats — countInboxProposalStats', () => {
  it('returns 0s on empty / non-array input', () => {
    expect(countInboxProposalStats([])).toEqual({
      newSubjects: 0, updatedSubjects: 0, newSections: 0, newReviews: 0,
    });
    expect(countInboxProposalStats(null)).toEqual({
      newSubjects: 0, updatedSubjects: 0, newSections: 0, newReviews: 0,
    });
    expect(countInboxProposalStats('not an array')).toEqual({
      newSubjects: 0, updatedSubjects: 0, newSections: 0, newReviews: 0,
    });
  });

  it('counts new vs update subjects', () => {
    const r = countInboxProposalStats([
      propose({ subjectAction: 'new-subject' }),
      propose({ subjectAction: 'new-subject' }),
      propose({ subjectAction: 'update-existing-subject' }),
    ]);
    expect(r.newSubjects).toBe(2);
    expect(r.updatedSubjects).toBe(1);
  });

  it('dedups new sections by (review-key, section-name)', () => {
    const r = countInboxProposalStats([
      // Same new section "Player" in same existing review = 1 section
      propose({ action: 'existing-review', reviewId: 'd1', sectionAction: 'new-section', suggestedNewSectionName: 'Player' }),
      propose({ action: 'existing-review', reviewId: 'd1', sectionAction: 'new-section', suggestedNewSectionName: 'Player' }),
      // Different name but same review = 2nd section
      propose({ action: 'existing-review', reviewId: 'd1', sectionAction: 'new-section', suggestedNewSectionName: 'Recherche' }),
      // Same name in another review = 3rd section (different scope)
      propose({ action: 'existing-review', reviewId: 'd2', sectionAction: 'new-section', suggestedNewSectionName: 'Player' }),
    ]);
    expect(r.newSections).toBe(3);
  });

  it('dedups new reviews by suggestedNewReviewTitle (case-insensitive)', () => {
    const r = countInboxProposalStats([
      propose({ action: 'new-review', suggestedNewReviewTitle: 'Migration X' }),
      propose({ action: 'new-review', suggestedNewReviewTitle: 'migration x' }),
      propose({ action: 'new-review', suggestedNewReviewTitle: 'Refonte login' }),
    ]);
    expect(r.newReviews).toBe(2);
  });

  it('ignores section names from existing-section proposals', () => {
    const r = countInboxProposalStats([
      propose({ sectionAction: 'existing-section', suggestedNewSectionName: 'should-not-count' }),
    ]);
    expect(r.newSections).toBe(0);
  });

  it('handles a realistic mixed batch', () => {
    const r = countInboxProposalStats([
      propose({ subjectAction: 'new-subject', sectionAction: 'new-section', suggestedNewSectionName: 'Player' }),
      propose({ subjectAction: 'new-subject', sectionAction: 'existing-section' }),
      propose({ subjectAction: 'update-existing-subject' }),
      propose({ subjectAction: 'update-existing-subject' }),
      propose({ subjectAction: 'new-subject', action: 'new-review', suggestedNewReviewTitle: 'Suivi NEW' }),
    ]);
    expect(r).toEqual({ newSubjects: 3, updatedSubjects: 2, newSections: 1, newReviews: 1 });
  });
});

describe('inboxStats — formatStatsLine', () => {
  it('renders empty string when nothing happened', () => {
    expect(formatStatsLine({ newSubjects: 0, updatedSubjects: 0, newSections: 0, newReviews: 0 }))
      .toBe('');
  });
  it('joins non-zero buckets with " · "', () => {
    expect(formatStatsLine({ newSubjects: 3, updatedSubjects: 1, newSections: 0, newReviews: 0 }))
      .toBe('3 sujets créés · 1 mise à jour');
  });
  it('uses singular form for count == 1', () => {
    expect(formatStatsLine({ newSubjects: 1, updatedSubjects: 1, newSections: 1, newReviews: 1 }))
      .toBe('1 sujet créé · 1 mise à jour · 1 nouvelle section · 1 nouvelle review');
  });
  it('uses plural form for count > 1', () => {
    expect(formatStatsLine({ newSubjects: 5, updatedSubjects: 3, newSections: 2, newReviews: 4 }))
      .toBe('5 sujets créés · 3 mises à jour · 2 nouvelles sections · 4 nouvelles reviews');
  });
});
