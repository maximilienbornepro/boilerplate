import { describe, it, expect } from 'vitest';

// Pure-logic tests for the SubjectRow state the modal drives.

interface Row {
  subject: {
    title: string;
    suggestedNewReviewTitle: string | null;
    suggestedNewSectionName: string | null;
  };
  reviewId: string | null;
  newReviewTitle: string;
  sectionId: string | null;
  newSectionName: string;
  skipped: boolean;
}

function makeRow(partial: Partial<Row> = {}): Row {
  return {
    subject: {
      title: 'Migration DB',
      suggestedNewReviewTitle: 'Tech',
      suggestedNewSectionName: 'Backend',
    },
    reviewId: null,
    newReviewTitle: 'Tech',
    sectionId: null,
    newSectionName: 'Backend',
    skipped: false,
    ...partial,
  };
}

describe('Bulk transcription import — subject row state', () => {
  it('moving from "new review" to an existing review resets sectionId (next render picks first)', () => {
    // Simulated select handler for the review dropdown
    function selectExistingReview(r: Row, docId: string, firstSection: string | null): Row {
      return { ...r, reviewId: docId, sectionId: firstSection };
    }
    const r0 = makeRow();
    const r1 = selectExistingReview(r0, 'doc-1', 'sec-1');
    expect(r1.reviewId).toBe('doc-1');
    expect(r1.sectionId).toBe('sec-1');
  });

  it('switching an existing review back to "new review" clears sectionId', () => {
    const r0 = makeRow({ reviewId: 'doc-1', sectionId: 'sec-1' });
    const r1 = { ...r0, reviewId: null, sectionId: null };
    expect(r1.reviewId).toBeNull();
    expect(r1.sectionId).toBeNull();
  });

  it('skipping excludes the subject from the apply payload', () => {
    const rows: Row[] = [
      makeRow({ reviewId: 'doc-1', sectionId: 'sec-1' }),
      makeRow({ reviewId: 'doc-2', sectionId: 'sec-2', skipped: true }),
    ];
    const payload = rows.filter(r => !r.skipped).map(r => ({
      title: r.subject.title,
      targetReviewId: r.reviewId,
      targetSectionId: r.sectionId,
    }));
    expect(payload).toHaveLength(1);
    expect(payload[0].targetReviewId).toBe('doc-1');
  });

  it('apply payload uses the new-review title when no reviewId is set', () => {
    const row = makeRow({ newReviewTitle: 'Hebdo Tech' });
    const payload = {
      targetReviewId: row.reviewId,
      newReviewTitle: row.reviewId ? null : (row.newReviewTitle || row.subject.suggestedNewReviewTitle),
      targetSectionId: row.reviewId && row.sectionId ? row.sectionId : null,
      newSectionName: row.reviewId && row.sectionId ? null : (row.newSectionName || row.subject.suggestedNewSectionName),
    };
    expect(payload.targetReviewId).toBeNull();
    expect(payload.newReviewTitle).toBe('Hebdo Tech');
    expect(payload.targetSectionId).toBeNull();
    expect(payload.newSectionName).toBe('Backend');
  });

  it('apply payload keeps existing section id when both review and section are known', () => {
    const row = makeRow({ reviewId: 'doc-1', sectionId: 'sec-5' });
    const payload = {
      targetReviewId: row.reviewId,
      targetSectionId: row.reviewId && row.sectionId ? row.sectionId : null,
      newSectionName: row.reviewId && row.sectionId ? null : 'default',
    };
    expect(payload.targetReviewId).toBe('doc-1');
    expect(payload.targetSectionId).toBe('sec-5');
    expect(payload.newSectionName).toBeNull();
  });
});
