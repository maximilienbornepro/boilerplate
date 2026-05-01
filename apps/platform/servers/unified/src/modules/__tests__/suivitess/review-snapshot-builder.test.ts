import { describe, it, expect } from 'vitest';
import { buildReviewsSnapshotForAI, _internals } from '../../suivitess/reviewSnapshotBuilder.js';

// We don't want this test to touch the DB. The builder accepts a `db`
// dependency, so we hand it a fake module-shaped object that returns
// fixtures. Only the functions actually called by the builder need to
// exist (`getAllDocuments`, `getDocumentWithSections`).
function makeFakeDb(opts: {
  docs: Array<{ id: string; title: string; description?: string | null }>;
  docsById: Record<string, { id: string; title: string; sections: Array<{ id: string; name: string; subjects: Array<{ id: string; title: string; situation?: string | null; status?: string | null; responsibility?: string | null; updated_at?: string | Date | null }> }> }>;
}) {
  return {
    getAllDocuments: async () => opts.docs,
    getDocumentWithSections: async (docId: string) => opts.docsById[docId] ?? null,
    // Casts back to the shape buildReviewsSnapshotForAI expects (`typeof DbService`).
  } as unknown as Parameters<typeof buildReviewsSnapshotForAI>[0]['db'];
}

const userOpts = { userId: 1, isAdmin: false };

describe('buildReviewsSnapshotForAI', () => {
  it('propagates responsibility (legacy mapping forgot it)', async () => {
    const db = makeFakeDb({
      docs: [{ id: 'd1', title: 'Copil SFR' }],
      docsById: {
        d1: {
          id: 'd1',
          title: 'Copil SFR',
          sections: [{
            id: 's1', name: 'Auth', subjects: [{
              id: 'sub-1', title: 'Bug OAuth iframe',
              situation: 'Bug remonté ce matin', status: '🟡 en cours',
              responsibility: 'Alice', updated_at: '2026-04-29',
            }],
          }],
        },
      },
    });
    const out = await buildReviewsSnapshotForAI({ ...userOpts, db });
    expect(out).toHaveLength(1);
    expect(out[0].sections[0].subjects[0].responsibility).toBe('Alice');
  });

  it('does NOT silently cap at 20 subjects per section (legacy bug)', async () => {
    // Legacy `slice(0, 20)` would silently drop subjects past the 20th.
    // With a single-review portfolio the budget is the full
    // SUBJECT_BUDGET_TOTAL, so all 30 must surface.
    const subjects = Array.from({ length: 30 }, (_, i) => ({
      id: `sub-${i}`,
      title: `Subject ${i}`,
      situation: '...',
      status: '🔴 à faire',
      responsibility: null,
      updated_at: new Date(2026, 3, 30 - i).toISOString(),
    }));
    const db = makeFakeDb({
      docs: [{ id: 'd1', title: 'Big review' }],
      docsById: {
        d1: { id: 'd1', title: 'Big review', sections: [{ id: 's1', name: 'Backlog', subjects }] },
      },
    });
    const out = await buildReviewsSnapshotForAI({ ...userOpts, db });
    expect(out[0].sections[0].subjects.length).toBe(30);
    // No truncation expected — section under budget.
    expect(out[0].sections[0].subjectsTruncated).toBeUndefined();
  });

  it('caps at SUBJECT_BUDGET_TOTAL when a single huge review blows the budget', async () => {
    // 1 review × 200 subjects → per-review budget = SUBJECT_BUDGET_TOTAL.
    // Excess subjects are dropped (oldest first) and counted in subjectsTruncated.
    const total = 200;
    const subjects = Array.from({ length: total }, (_, i) => ({
      id: `sub-${i}`,
      title: `Subject ${i}`,
      situation: '',
      status: '🔴',
      responsibility: null,
      updated_at: new Date(2026, 0, total - i).toISOString(),
    }));
    const db = makeFakeDb({
      docs: [{ id: 'd1', title: 'Mega review' }],
      docsById: {
        d1: { id: 'd1', title: 'Mega review', sections: [{ id: 's1', name: 'All', subjects }] },
      },
    });
    const out = await buildReviewsSnapshotForAI({ ...userOpts, db });
    expect(out[0].sections[0].subjects.length).toBe(_internals.SUBJECT_BUDGET_TOTAL);
    expect(out[0].sections[0].subjectsTruncated).toBe(total - _internals.SUBJECT_BUDGET_TOTAL);
  });

  it('keeps the most recent subjects when the per-review budget kicks in', async () => {
    // 5 reviews × 30 subjects → per-review budget = floor(120/5) = 24.
    // The 6 oldest of each review should be dropped, the 24 most-recent kept.
    const docs = Array.from({ length: 5 }, (_, r) => ({ id: `d${r}`, title: `Review ${r}` }));
    const docsById: Record<string, ReturnType<typeof makeDoc>> = {};
    function makeDoc(id: string, title: string) {
      const subjects = Array.from({ length: 30 }, (_, i) => ({
        id: `${id}-sub-${i}`,
        title: `${title} sub ${i}`,
        situation: '',
        status: '🔴',
        responsibility: null,
        // i=0 is most recent, i=29 is oldest
        updated_at: new Date(2026, 0, 30 - i).toISOString(),
      }));
      return { id, title, sections: [{ id: `${id}-s1`, name: 'Section', subjects }] };
    }
    for (const d of docs) docsById[d.id] = makeDoc(d.id, d.title);
    const db = makeFakeDb({ docs, docsById });
    const out = await buildReviewsSnapshotForAI({ ...userOpts, db });

    // Each review keeps exactly 24 subjects (floor(120/5)).
    for (const review of out) {
      expect(review.sections[0].subjects).toHaveLength(24);
      // The dropped ones must be the oldest — i.e. highest indices.
      // Kept ones are sub-0..sub-23 (sorted by recency desc).
      const keptIds = review.sections[0].subjects.map(s => s.id);
      expect(keptIds).toContain(`${review.id}-sub-0`);
      expect(keptIds).toContain(`${review.id}-sub-23`);
      expect(keptIds).not.toContain(`${review.id}-sub-29`);
      expect(review.sections[0].subjectsTruncated).toBe(6);
    }
  });

  it('omits subjectsTruncated when the section is fully covered', async () => {
    const db = makeFakeDb({
      docs: [{ id: 'd1', title: 'Small review' }],
      docsById: {
        d1: {
          id: 'd1',
          title: 'Small review',
          sections: [{ id: 's1', name: 'Tiny', subjects: [{
            id: 'sub-1', title: 'Solo', situation: '', status: '🟢', responsibility: null,
            updated_at: '2026-04-29',
          }] }],
        },
      },
    });
    const out = await buildReviewsSnapshotForAI({ ...userOpts, db });
    expect(out[0].sections[0].subjectsTruncated).toBeUndefined();
  });

  it('returns an empty array when the user has no docs', async () => {
    const db = makeFakeDb({ docs: [], docsById: {} });
    expect(await buildReviewsSnapshotForAI({ ...userOpts, db })).toEqual([]);
  });

  it('keeps best-effort behaviour : skips a doc that throws and continues', async () => {
    const db = {
      getAllDocuments: async () => [{ id: 'good', title: 'Good' }, { id: 'bad', title: 'Bad' }],
      getDocumentWithSections: async (docId: string) => {
        if (docId === 'bad') throw new Error('DB blip');
        return { id: docId, title: 'Good', sections: [{ id: 'sx', name: 'Sec', subjects: [{
          id: 'sub', title: 'OK', situation: '', status: null, responsibility: null, updated_at: '2026-04-29',
        }] }] };
      },
    } as unknown as Parameters<typeof buildReviewsSnapshotForAI>[0]['db'];
    const out = await buildReviewsSnapshotForAI({ ...userOpts, db });
    expect(out.map(r => r.id)).toEqual(['good']);
  });
});
