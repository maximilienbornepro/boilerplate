import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────
// Tests for the refactored apply/revert layer of cross-source
// consolidation.
//
// NEW MODEL (this refactor) :
//   - apply NO LONGER creates subjects/sections/reviews directly.
//   - Instead it inserts ONE new inbox row (source_kind='consolidation')
//     with the consolidated subjects in `proposals` JSONB, and flips
//     the contributing rows to `accepted`.
//   - The user then validates each subject one-by-one through the
//     existing per-row Valider flow.
//   - revert deletes that new inbox row + flips the contributing rows
//     back to their pre-apply status.
//
// We stub the DB at the module boundary so the service runs end-to-end
// without a Postgres connection. The shared in-memory state is a
// hand-rolled fake of the rows the apply path expects.
// ─────────────────────────────────────────────────────────────────────

interface FakeInboxRow {
  id: string;
  userId: number;
  documentId: string;
  sourceKind: string;
  sourceId: string;
  sourceTitle: string | null;
  sourceDate: string | null;
  proposals: unknown[];
  aiLogId: number | null;
  status: 'pending' | 'accepted' | 'rejected';
}
interface FakeRun {
  id: string;
  user_id: number;
  ai_log_id: number | null;
  applied_at: Date;
  reverted_at: Date | null;
  undo_data: Record<string, unknown>;
}

const state = {
  rows: new Map<string, FakeInboxRow>(),
  runs: new Map<string, FakeRun>(),
  uuidCounter: 0,
};
function uuid(prefix = 'gen'): string {
  state.uuidCounter++;
  return `${prefix}-${state.uuidCounter}`;
}
function resetState() {
  state.rows.clear();
  state.runs.clear();
  state.uuidCounter = 0;
}

// Minimal `pool.query` fake — recognises the SQL fragments the new
// service uses (runs table + the inbox-row delete on revert).
async function fakeQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
  const s = sql.replace(/\s+/g, ' ').trim();
  // INSERT INTO suivitess_consolidation_runs
  if (s.startsWith('INSERT INTO suivitess_consolidation_runs')) {
    const id = uuid('run');
    const userId = params[0] as number;
    const aiLogId = (params[1] ?? null) as number | null;
    const undo = JSON.parse(params[2] as string);
    state.runs.set(id, {
      id, user_id: userId, ai_log_id: aiLogId,
      applied_at: new Date(), reverted_at: null, undo_data: undo,
    });
    return { rows: [{ id } as T], rowCount: 1 };
  }
  // SELECT id, undo_data, reverted_at FROM suivitess_consolidation_runs
  if (s.startsWith('SELECT id, undo_data, reverted_at FROM suivitess_consolidation_runs')) {
    const [id, userId] = params as [string, number];
    const row = state.runs.get(id);
    if (!row || row.user_id !== userId) return { rows: [], rowCount: 0 };
    return {
      rows: [{
        id: row.id,
        undo_data: row.undo_data,
        reverted_at: row.reverted_at,
      } as T],
      rowCount: 1,
    };
  }
  // SELECT id, applied_at, reverted_at, ai_log_id, undo_data ...
  if (s.startsWith('SELECT id, applied_at, reverted_at, ai_log_id, undo_data')) {
    const userId = params[0] as number;
    const limit = params[1] as number;
    const list = Array.from(state.runs.values())
      .filter(r => r.user_id === userId)
      .sort((a, b) => b.applied_at.getTime() - a.applied_at.getTime())
      .slice(0, limit)
      .map(r => ({
        id: r.id,
        applied_at: r.applied_at,
        reverted_at: r.reverted_at,
        ai_log_id: r.ai_log_id,
        undo_data: r.undo_data,
      }));
    return { rows: list as T[], rowCount: list.length };
  }
  // UPDATE suivitess_consolidation_runs SET reverted_at = NOW()
  if (s.startsWith('UPDATE suivitess_consolidation_runs SET reverted_at')) {
    const id = params[0] as string;
    const row = state.runs.get(id);
    if (row) row.reverted_at = new Date();
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  // DELETE FROM suivitess_inbox_proposals WHERE id = $1 AND user_id = $2
  if (s.startsWith('DELETE FROM suivitess_inbox_proposals WHERE id =')) {
    const [id, userId] = params as [string, number];
    const row = state.rows.get(id);
    if (!row || row.userId !== userId) return { rows: [], rowCount: 0 };
    state.rows.delete(id);
    return { rows: [], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock('../../suivitess/dbService.js', () => ({
  pool: { query: fakeQuery },
}));

vi.mock('../../suivitess/autoImportDbService.js', () => ({
  insertInboxProposal: async (input: {
    userId: number;
    documentId: string;
    sourceKind: string;
    sourceId: string;
    sourceTitle: string | null;
    sourceDate: string | null;
    proposals: unknown[];
    aiLogId: number | null;
  }) => {
    const id = uuid('inbox');
    const row: FakeInboxRow = {
      id,
      userId: input.userId,
      documentId: input.documentId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      sourceTitle: input.sourceTitle,
      sourceDate: input.sourceDate,
      proposals: input.proposals,
      aiLogId: input.aiLogId,
      status: 'pending',
    };
    state.rows.set(id, row);
    return row;
  },
  getInboxProposal: async (id: string, userId: number) => {
    const row = state.rows.get(id);
    if (!row || row.userId !== userId) return null;
    return row;
  },
  setInboxProposalStatus: async (id: string, userId: number, status: 'pending' | 'accepted' | 'rejected') => {
    const row = state.rows.get(id);
    if (!row || row.userId !== userId) return null;
    row.status = status;
    return row;
  },
  listInboxProposals: async () => [],
}));

vi.mock('../../suivitess/reviewSnapshotBuilder.js', () => ({
  buildReviewsSnapshotForAI: async () => [],
}));

vi.mock('../../aiSkills/runSkill.js', () => ({
  runSkill: async () => ({ logId: null, outputText: '' }),
}));

// Import AFTER the mocks so they apply.
const svc = await import('../../suivitess/consolidationService.js');

beforeEach(() => {
  resetState();
});

/** Helper to seed an in-memory pending inbox row with N proposals. */
function seedRow(
  rowId: string,
  userId: number,
  documentId: string,
  proposals: unknown[] = [{}],
): FakeInboxRow {
  const row: FakeInboxRow = {
    id: rowId,
    userId,
    documentId,
    sourceKind: 'fathom',
    sourceId: `src-${rowId}`,
    sourceTitle: `Title ${rowId}`,
    sourceDate: '2026-05-10T09:00:00Z',
    proposals,
    aiLogId: null,
    status: 'pending',
  };
  state.rows.set(rowId, row);
  return row;
}

describe('applyConsolidatedSubjects — new "materialize as inbox row" model', () => {
  it('returns runId=null and newInboxRowId=null when nothing was applied', async () => {
    const out = await svc.applyConsolidatedSubjects(7, []);
    expect(out.runId).toBeNull();
    expect(out.newInboxRowId).toBeNull();
    expect(state.runs.size).toBe(0);
    expect(state.rows.size).toBe(0);
  });

  it('inserts ONE new inbox row and flips contributing rows to accepted', async () => {
    seedRow('row-a', 7, 'doc-1');
    seedRow('row-b', 7, 'doc-1');

    const out = await svc.applyConsolidatedSubjects(7, [
      {
        title: 'Consolidated subject',
        subjectAction: 'new-subject',
        reviewId: 'doc-1',
        sectionId: null,
        suggestedNewReviewTitle: null,
        suggestedNewSectionName: 'Section X',
        targetSubjectId: null,
        situation: 'merged situation',
        rawQuotes: [],
        entities: [],
        mergedFrom: [
          { rowId: 'row-a', proposalIndex: 0, sourceTitle: 'a' },
          { rowId: 'row-b', proposalIndex: 0, sourceTitle: 'b' },
        ],
        reasoning: 'Same theme',
      },
    ], 42);

    expect(out.newInboxRowId).not.toBeNull();
    expect(out.proposalsCount).toBe(1);
    expect(out.rowsAccepted).toBe(2);
    expect(out.runId).not.toBeNull();

    // Exactly one new inbox row exists in addition to the seeded ones.
    expect(state.rows.size).toBe(3);
    const newRow = state.rows.get(out.newInboxRowId!);
    expect(newRow).toBeDefined();
    expect(newRow!.sourceKind).toBe('consolidation');
    expect(newRow!.documentId).toBe('doc-1');
    expect((newRow!.proposals as unknown[]).length).toBe(1);

    // Contributing rows flipped to accepted.
    expect(state.rows.get('row-a')!.status).toBe('accepted');
    expect(state.rows.get('row-b')!.status).toBe('accepted');

    // Run persisted with the right undo shape.
    expect(state.runs.size).toBe(1);
    const run = Array.from(state.runs.values())[0];
    expect(run.ai_log_id).toBe(42);
    const undo = run.undo_data as { newInboxRowId: string; contributingRows: Array<{ id: string; prevStatus: string }> };
    expect(undo.newInboxRowId).toBe(out.newInboxRowId);
    expect(undo.contributingRows).toHaveLength(2);
    expect(undo.contributingRows.every(c => c.prevStatus === 'pending')).toBe(true);
  });

  it('picks the majority-vote reviewId as the new row documentId', async () => {
    seedRow('row-a', 7, 'doc-other');
    seedRow('row-b', 7, 'doc-other');

    const out = await svc.applyConsolidatedSubjects(7, [
      {
        title: 'Subject 1',
        subjectAction: 'new-subject',
        reviewId: 'doc-winner',
        sectionId: null,
        suggestedNewReviewTitle: null,
        suggestedNewSectionName: null,
        targetSubjectId: null,
        situation: '', rawQuotes: [], entities: [],
        mergedFrom: [{ rowId: 'row-a', proposalIndex: 0, sourceTitle: 'a' }],
        reasoning: '',
      },
      {
        title: 'Subject 2',
        subjectAction: 'new-subject',
        reviewId: 'doc-winner',
        sectionId: null,
        suggestedNewReviewTitle: null,
        suggestedNewSectionName: null,
        targetSubjectId: null,
        situation: '', rawQuotes: [], entities: [],
        mergedFrom: [{ rowId: 'row-b', proposalIndex: 0, sourceTitle: 'b' }],
        reasoning: '',
      },
    ]);

    const newRow = state.rows.get(out.newInboxRowId!);
    expect(newRow!.documentId).toBe('doc-winner');
  });

  it('falls back to first contributing row documentId when every subject is new-review', async () => {
    seedRow('row-a', 7, 'doc-fallback');

    const out = await svc.applyConsolidatedSubjects(7, [{
      title: 'Brand new',
      subjectAction: 'new-subject',
      reviewId: null,
      sectionId: null,
      suggestedNewReviewTitle: 'A new review',
      suggestedNewSectionName: null,
      targetSubjectId: null,
      situation: '', rawQuotes: [], entities: [],
      mergedFrom: [{ rowId: 'row-a', proposalIndex: 0, sourceTitle: 'a' }],
      reasoning: '',
    }]);

    const newRow = state.rows.get(out.newInboxRowId!);
    expect(newRow!.documentId).toBe('doc-fallback');
  });

  it('reports empty-title items as errors and does not insert when all items are empty', async () => {
    seedRow('row-a', 7, 'doc-1');
    const out = await svc.applyConsolidatedSubjects(7, [{
      title: '   ',
      subjectAction: 'new-subject',
      reviewId: 'doc-1',
      sectionId: null,
      suggestedNewReviewTitle: null,
      suggestedNewSectionName: null,
      targetSubjectId: null,
      situation: '', rawQuotes: [], entities: [],
      mergedFrom: [{ rowId: 'row-a', proposalIndex: 0, sourceTitle: 'a' }],
      reasoning: '',
    }]);

    expect(out.newInboxRowId).toBeNull();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].error).toBe('Titre vide');
    // No new inbox row was inserted, no contributing row was flipped.
    expect(state.rows.size).toBe(1);
    expect(state.rows.get('row-a')!.status).toBe('pending');
  });
});

describe('consolidatedToAnalyzedSubject mapping', () => {
  it('produces updatedSituation = c.situation for update-existing-subject', () => {
    const out = svc.consolidatedToAnalyzedSubject({
      title: 'X',
      subjectAction: 'update-existing-subject',
      reviewId: 'rev-1',
      sectionId: 'sec-1',
      suggestedNewReviewTitle: null,
      suggestedNewSectionName: null,
      targetSubjectId: 'sub-1',
      situation: 'fresh context',
      rawQuotes: [],
      entities: [],
      mergedFrom: [{ rowId: 'r', proposalIndex: 0, sourceTitle: 's' }],
      reasoning: '',
    }, []);
    expect(out.subjectAction).toBe('update-existing-subject');
    expect(out.updatedSituation).toBe('fresh context');
    expect(out.targetSubjectId).toBe('sub-1');
    expect(out.action).toBe('existing-review');
    expect(out.sectionAction).toBe('existing-section');
    expect(out.confidence).toBe('high');
  });

  it('produces updatedSituation = null for new-subject', () => {
    const out = svc.consolidatedToAnalyzedSubject({
      title: 'Y',
      subjectAction: 'new-subject',
      reviewId: null,
      sectionId: null,
      suggestedNewReviewTitle: 'New review',
      suggestedNewSectionName: 'New section',
      targetSubjectId: null,
      situation: 'sit',
      rawQuotes: [],
      entities: [],
      mergedFrom: [{ rowId: 'r', proposalIndex: 0, sourceTitle: 's' }],
      reasoning: '',
    }, []);
    expect(out.subjectAction).toBe('new-subject');
    expect(out.updatedSituation).toBeNull();
    expect(out.action).toBe('new-review');
    expect(out.sectionAction).toBe('new-section');
  });

  it('unions sourceRawQuotes/sourceEntities/sourceParticipants from contributing originals', () => {
    const originals = [
      { sourceRawQuotes: ['q1', 'q2'], sourceEntities: ['E1'], sourceParticipants: ['Alice'] },
      { sourceRawQuotes: ['q2', 'q3'], sourceEntities: ['E2'], sourceParticipants: ['Bob'] },
      // legacy shape (no "source" prefix) should also be honored.
      { rawQuotes: ['q4'], entities: ['E3'], participants: ['Carol'] },
    ];
    const out = svc.consolidatedToAnalyzedSubject({
      title: 'Z',
      subjectAction: 'new-subject',
      reviewId: 'r1',
      sectionId: 's1',
      suggestedNewReviewTitle: null,
      suggestedNewSectionName: null,
      targetSubjectId: null,
      situation: '',
      rawQuotes: [],
      entities: [],
      mergedFrom: [{ rowId: 'r', proposalIndex: 0, sourceTitle: 's' }],
      reasoning: '',
    }, originals);
    // Dedup'd union — q2 only appears once.
    expect((out.sourceRawQuotes ?? []).sort()).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect((out.sourceEntities ?? []).sort()).toEqual(['E1', 'E2', 'E3']);
    expect((out.sourceParticipants ?? []).sort()).toEqual(['Alice', 'Bob', 'Carol']);
  });
});

describe('pickPrimaryDocumentId', () => {
  it('ties broken by first non-null reviewId', () => {
    const docs = new Map<string, string>();
    docs.set('row-1', 'fallback-doc');
    const out = svc.pickPrimaryDocumentId([
      {
        title: 'A',
        subjectAction: 'new-subject',
        reviewId: 'doc-A',
        sectionId: null, suggestedNewReviewTitle: null,
        suggestedNewSectionName: null, targetSubjectId: null,
        situation: '', rawQuotes: [], entities: [],
        mergedFrom: [{ rowId: 'row-1', proposalIndex: 0, sourceTitle: '' }],
        reasoning: '',
      },
      {
        title: 'B',
        subjectAction: 'new-subject',
        reviewId: 'doc-B',
        sectionId: null, suggestedNewReviewTitle: null,
        suggestedNewSectionName: null, targetSubjectId: null,
        situation: '', rawQuotes: [], entities: [],
        mergedFrom: [{ rowId: 'row-1', proposalIndex: 0, sourceTitle: '' }],
        reasoning: '',
      },
    ], docs);
    // First non-null wins on a 1-1 tie.
    expect(out).toBe('doc-A');
  });
});

describe('revertConsolidationRun — new model', () => {
  it('deletes the new inbox row and flips contributing rows back to pending', async () => {
    seedRow('row-a', 7, 'doc-1');
    seedRow('row-b', 7, 'doc-1');

    const out = await svc.applyConsolidatedSubjects(7, [{
      title: 'C',
      subjectAction: 'new-subject',
      reviewId: 'doc-1',
      sectionId: null,
      suggestedNewReviewTitle: null,
      suggestedNewSectionName: 'Sec',
      targetSubjectId: null,
      situation: '', rawQuotes: [], entities: [],
      mergedFrom: [
        { rowId: 'row-a', proposalIndex: 0, sourceTitle: 'a' },
        { rowId: 'row-b', proposalIndex: 0, sourceTitle: 'b' },
      ],
      reasoning: '',
    }]);
    expect(out.runId).not.toBeNull();
    expect(state.rows.get(out.newInboxRowId!)).toBeDefined();
    expect(state.rows.get('row-a')!.status).toBe('accepted');
    expect(state.rows.get('row-b')!.status).toBe('accepted');

    const revert = await svc.revertConsolidationRun(7, out.runId!);
    expect(revert.inboxRowDeleted).toBe(true);
    expect(revert.rowsRestored).toBe(2);

    // New inbox row is gone.
    expect(state.rows.has(out.newInboxRowId!)).toBe(false);
    // Contributing rows flipped back to pending.
    expect(state.rows.get('row-a')!.status).toBe('pending');
    expect(state.rows.get('row-b')!.status).toBe('pending');
  });

  it('preserves the prev-status of a row that was already accepted before apply', async () => {
    seedRow('row-a', 7, 'doc-1');
    // Pre-flip row-a outside the consolidation flow.
    state.rows.get('row-a')!.status = 'accepted';

    const out = await svc.applyConsolidatedSubjects(7, [{
      title: 'X',
      subjectAction: 'new-subject',
      reviewId: 'doc-1',
      sectionId: null,
      suggestedNewReviewTitle: null,
      suggestedNewSectionName: 'Sec',
      targetSubjectId: null,
      situation: '', rawQuotes: [], entities: [],
      mergedFrom: [{ rowId: 'row-a', proposalIndex: 0, sourceTitle: 'a' }],
      reasoning: '',
    }]);
    await svc.revertConsolidationRun(7, out.runId!);
    // row-a must remain `accepted` (it was accepted BEFORE the apply).
    expect(state.rows.get('row-a')!.status).toBe('accepted');
  });

  it('double-revert throws an explicit error', async () => {
    seedRow('row-a', 7, 'doc-1');
    const out = await svc.applyConsolidatedSubjects(7, [{
      title: 'X',
      subjectAction: 'new-subject',
      reviewId: 'doc-1',
      sectionId: null,
      suggestedNewReviewTitle: null,
      suggestedNewSectionName: 'Sec',
      targetSubjectId: null,
      situation: '', rawQuotes: [], entities: [],
      mergedFrom: [{ rowId: 'row-a', proposalIndex: 0, sourceTitle: 'a' }],
      reasoning: '',
    }]);
    await svc.revertConsolidationRun(7, out.runId!);
    await expect(svc.revertConsolidationRun(7, out.runId!)).rejects.toThrow(/déjà été annulée/);
  });

  it('throws when the run does not belong to the user', async () => {
    await expect(svc.revertConsolidationRun(999, 'nonexistent')).rejects.toThrow(/introuvable/);
  });
});

describe('listConsolidationRuns', () => {
  it('returns the new summary shape and respects user scoping', async () => {
    seedRow('row-a', 7, 'doc-1');
    seedRow('row-b', 8, 'doc-1');

    await svc.applyConsolidatedSubjects(7, [{
      title: 'X',
      subjectAction: 'new-subject',
      reviewId: 'doc-1',
      sectionId: null,
      suggestedNewReviewTitle: null, suggestedNewSectionName: null,
      targetSubjectId: null,
      situation: '', rawQuotes: [], entities: [],
      mergedFrom: [{ rowId: 'row-a', proposalIndex: 0, sourceTitle: 'a' }],
      reasoning: '',
    }]);
    await svc.applyConsolidatedSubjects(8, [{
      title: 'Y',
      subjectAction: 'new-subject',
      reviewId: 'doc-1',
      sectionId: null,
      suggestedNewReviewTitle: null, suggestedNewSectionName: null,
      targetSubjectId: null,
      situation: '', rawQuotes: [], entities: [],
      mergedFrom: [{ rowId: 'row-b', proposalIndex: 0, sourceTitle: 'b' }],
      reasoning: '',
    }]);

    const forSeven = await svc.listConsolidationRuns(7, 10);
    expect(forSeven).toHaveLength(1);
    expect(forSeven[0].summary).toEqual({ rowsAccepted: 1 });
    expect(forSeven[0].revertedAt).toBeNull();

    const forEight = await svc.listConsolidationRuns(8, 10);
    expect(forEight).toHaveLength(1);
    // Cross-user scoping : user 7 must not see user 8's run.
    expect(forSeven.map(r => r.id)).not.toContain(forEight[0].id);
  });
});
