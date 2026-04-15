import { describe, it, expect } from 'vitest';

// Pure logic tests for the subject-level routing of a single transcription.
// The Claude call itself is covered by integration tests ; here we validate
// the validation layer that guards the AI response against bad data.

describe('SuiviTess — subject-level transcription routing', () => {
  describe('Review routing validation', () => {
    // Mirror the service-side validation : an `existing-review` suggestion
    // whose `reviewId` is not among the caller's reviews falls back to
    // `new-review`, with a safe default title.

    type Action = 'existing-review' | 'new-review';
    interface Raw { action: Action; reviewId?: string | null; suggestedNewReviewTitle?: string | null }
    interface Resolved { action: Action; reviewId: string | null; suggestedNewReviewTitle: string | null }

    function resolveReview(
      raw: Raw,
      validIds: Set<string>,
      fallbackTitle: string,
    ): Resolved {
      if (raw.action === 'existing-review') {
        const id = raw.reviewId ?? '';
        if (validIds.has(id)) {
          return { action: 'existing-review', reviewId: id, suggestedNewReviewTitle: null };
        }
        return {
          action: 'new-review',
          reviewId: null,
          suggestedNewReviewTitle: raw.suggestedNewReviewTitle || fallbackTitle,
        };
      }
      return {
        action: 'new-review',
        reviewId: null,
        suggestedNewReviewTitle: raw.suggestedNewReviewTitle || fallbackTitle,
      };
    }

    it('keeps a valid existing-review suggestion', () => {
      expect(resolveReview(
        { action: 'existing-review', reviewId: 'doc-a' },
        new Set(['doc-a']),
        'fallback',
      )).toEqual({ action: 'existing-review', reviewId: 'doc-a', suggestedNewReviewTitle: null });
    });

    it('falls back to new-review when reviewId is unknown', () => {
      expect(resolveReview(
        { action: 'existing-review', reviewId: 'ghost' },
        new Set(['doc-a']),
        'Nouvelle',
      )).toEqual({
        action: 'new-review',
        reviewId: null,
        suggestedNewReviewTitle: 'Nouvelle',
      });
    });

    it('passes through a new-review suggestion with its title', () => {
      expect(resolveReview(
        { action: 'new-review', suggestedNewReviewTitle: 'Discovery Q2' },
        new Set(['doc-a']),
        'fallback',
      ).suggestedNewReviewTitle).toBe('Discovery Q2');
    });
  });

  describe('Section routing validation', () => {
    // An `existing-section` suggestion must point to a section of the
    // resolved review. Otherwise the subject falls back to a new section.

    type Action = 'existing-review' | 'new-review';
    type SecAction = 'existing-section' | 'new-section';

    interface Raw { action: Action; reviewId: string | null; sectionAction: SecAction; sectionId?: string | null; suggestedNewSectionName?: string | null }
    interface Resolved { sectionAction: SecAction; sectionId: string | null; suggestedNewSectionName: string | null }

    function resolveSection(
      raw: Raw,
      sectionsByReview: Map<string, Set<string>>,
      fallbackName: string,
    ): Resolved {
      if (raw.action === 'new-review') {
        return { sectionAction: 'new-section', sectionId: null, suggestedNewSectionName: raw.suggestedNewSectionName || fallbackName };
      }
      if (raw.sectionAction === 'existing-section' && raw.sectionId) {
        const set = raw.reviewId ? sectionsByReview.get(raw.reviewId) : undefined;
        if (set && set.has(raw.sectionId)) {
          return { sectionAction: 'existing-section', sectionId: raw.sectionId, suggestedNewSectionName: null };
        }
      }
      return {
        sectionAction: 'new-section',
        sectionId: null,
        suggestedNewSectionName: raw.suggestedNewSectionName || fallbackName,
      };
    }

    const sectionsByReview = new Map([
      ['doc-a', new Set(['sec-1', 'sec-2'])],
      ['doc-b', new Set(['sec-3'])],
    ]);

    it('keeps a valid existing section', () => {
      expect(resolveSection(
        { action: 'existing-review', reviewId: 'doc-a', sectionAction: 'existing-section', sectionId: 'sec-2' },
        sectionsByReview,
        'fallback',
      )).toEqual({ sectionAction: 'existing-section', sectionId: 'sec-2', suggestedNewSectionName: null });
    });

    it('rejects a section id that belongs to another review', () => {
      expect(resolveSection(
        { action: 'existing-review', reviewId: 'doc-a', sectionAction: 'existing-section', sectionId: 'sec-3' },
        sectionsByReview,
        'fallback',
      ).sectionAction).toBe('new-section');
    });

    it('forces new-section when review is new (no existing sections)', () => {
      expect(resolveSection(
        { action: 'new-review', reviewId: null, sectionAction: 'existing-section', sectionId: 'sec-1' },
        sectionsByReview,
        'Call hebdo',
      )).toEqual({ sectionAction: 'new-section', sectionId: null, suggestedNewSectionName: 'Call hebdo' });
    });
  });

  describe('Apply — dedup by new review/section title', () => {
    // When multiple subjects target the same new review title (or same new
    // section inside the same review), the route creates each only once.

    interface Subject { title: string; newReviewTitle?: string | null; newSectionName?: string | null; reviewId?: string | null; sectionId?: string | null }

    async function apply(
      subjects: Subject[],
      createReview: (title: string) => Promise<string>,
      createSection: (reviewId: string, name: string) => Promise<string>,
      insertSubject: (reviewId: string, sectionId: string, title: string) => Promise<void>,
    ) {
      const reviewByTitle = new Map<string, string>();
      const sectionByKey = new Map<string, string>();
      let reviewCreations = 0, sectionCreations = 0;
      for (const s of subjects) {
        let reviewId = s.reviewId ?? null;
        if (!reviewId) {
          const title = s.newReviewTitle ?? 'Nouvelle';
          reviewId = reviewByTitle.get(title) ?? null;
          if (!reviewId) {
            reviewId = await createReview(title);
            reviewCreations++;
            reviewByTitle.set(title, reviewId);
          }
        }
        let sectionId = s.sectionId ?? null;
        if (!sectionId) {
          const name = s.newSectionName ?? 'Nouveau';
          const key = `${reviewId}::${name}`;
          sectionId = sectionByKey.get(key) ?? null;
          if (!sectionId) {
            sectionId = await createSection(reviewId, name);
            sectionCreations++;
            sectionByKey.set(key, sectionId);
          }
        }
        await insertSubject(reviewId, sectionId, s.title);
      }
      return { reviewCreations, sectionCreations };
    }

    it('creates a new review only once when multiple subjects share the same new title', async () => {
      const subjects: Subject[] = [
        { title: 'A', newReviewTitle: 'Hebdo', newSectionName: 'Point 1' },
        { title: 'B', newReviewTitle: 'Hebdo', newSectionName: 'Point 1' },
        { title: 'C', newReviewTitle: 'Hebdo', newSectionName: 'Point 2' },
      ];
      let rIdx = 0, sIdx = 0;
      const inserts: Array<[string, string, string]> = [];
      const out = await apply(
        subjects,
        async () => `review-${++rIdx}`,
        async () => `section-${++sIdx}`,
        async (r, s, t) => { inserts.push([r, s, t]); },
      );
      expect(out.reviewCreations).toBe(1);
      expect(out.sectionCreations).toBe(2);
      expect(inserts.every(i => i[0] === 'review-1')).toBe(true);
    });

    it('reuses an existing review and creates only the new section', async () => {
      const subjects: Subject[] = [
        { title: 'A', reviewId: 'existing', newSectionName: 'Nouveau point' },
        { title: 'B', reviewId: 'existing', newSectionName: 'Nouveau point' },
      ];
      let sIdx = 0;
      const out = await apply(
        subjects,
        async () => 'should-not-happen',
        async () => `section-${++sIdx}`,
        async () => {},
      );
      expect(out.reviewCreations).toBe(0);
      expect(out.sectionCreations).toBe(1);
    });
  });
});
