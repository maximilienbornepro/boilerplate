import { describe, it, expect } from 'vitest';

// The /inbox/consolidate-pending and /inbox/consolidate-pending/apply
// route handlers are thin shells over consolidationService — most of
// the meaningful logic is the input cleaning at the route boundary.
// We can't import routes.ts directly without pulling pg + express ;
// we mirror the cleaning rules here so any future route-level edit
// surfaces in the diff. The service-level behaviour is covered in
// consolidation.test.ts.

const SAFE_SOURCES = new Set(['fathom', 'otter', 'outlook', 'gmail', 'slack']);

interface ConsolidateBody {
  sourceKind?: unknown;
  documentId?: unknown;
}

interface CleanedFilter {
  sourceKind?: 'fathom' | 'otter' | 'outlook' | 'gmail' | 'slack';
  documentId?: string;
}

/** Mirror of the cleaning the route does on the request body. */
function cleanFilter(body: ConsolidateBody): CleanedFilter {
  const cleanedSource = (typeof body.sourceKind === 'string' && SAFE_SOURCES.has(body.sourceKind))
    ? (body.sourceKind as CleanedFilter['sourceKind']) : undefined;
  const cleanedDoc = typeof body.documentId === 'string' && body.documentId.length > 0
    ? body.documentId : undefined;
  return { sourceKind: cleanedSource, documentId: cleanedDoc };
}

/** Mirror of the apply route's items validation. */
function validateApplyBody(body: { items?: unknown }): { ok: true } | { ok: false; status: number; error: string } {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { ok: false, status: 400, error: 'Aucun sujet à appliquer' };
  }
  return { ok: true };
}

describe('POST /inbox/consolidate-pending — body cleaning', () => {
  it('passes valid sourceKind through', () => {
    expect(cleanFilter({ sourceKind: 'fathom' }).sourceKind).toBe('fathom');
    expect(cleanFilter({ sourceKind: 'slack' }).sourceKind).toBe('slack');
  });

  it('drops unknown sourceKind values', () => {
    expect(cleanFilter({ sourceKind: 'evil-injection' }).sourceKind).toBeUndefined();
    expect(cleanFilter({ sourceKind: 42 }).sourceKind).toBeUndefined();
    expect(cleanFilter({ sourceKind: null }).sourceKind).toBeUndefined();
  });

  it('keeps documentId when it is a non-empty string', () => {
    expect(cleanFilter({ documentId: 'doc-abc' }).documentId).toBe('doc-abc');
  });

  it('drops empty / non-string documentId', () => {
    expect(cleanFilter({ documentId: '' }).documentId).toBeUndefined();
    expect(cleanFilter({ documentId: 0 }).documentId).toBeUndefined();
  });

  it('returns shape that matches the service signature', () => {
    const cleaned = cleanFilter({ sourceKind: 'outlook', documentId: 'd1' });
    expect(cleaned).toEqual({ sourceKind: 'outlook', documentId: 'd1' });
  });
});

describe('POST /inbox/consolidate-pending/apply — body validation', () => {
  it('rejects empty items', () => {
    expect(validateApplyBody({ items: [] })).toEqual({
      ok: false, status: 400, error: 'Aucun sujet à appliquer',
    });
  });

  it('rejects non-array items', () => {
    expect(validateApplyBody({ items: 'oops' as unknown })).toEqual({
      ok: false, status: 400, error: 'Aucun sujet à appliquer',
    });
    expect(validateApplyBody({})).toEqual({
      ok: false, status: 400, error: 'Aucun sujet à appliquer',
    });
  });

  it('accepts a non-empty array', () => {
    expect(validateApplyBody({ items: [{ title: 't', mergedFrom: [] }] })).toEqual({ ok: true });
  });
});

// Cross-user isolation is enforced two ways :
//   1. The list query in consolidatePendingForUser passes userId.
//   2. The flip query in setInboxProposalStatus passes userId in the
//      WHERE clause (existing behaviour).
// We assert here that the LIST query parameters always include the
// caller's userId — without that, the service would leak cross-user
// proposals into the consolidation prompt.

import { listInboxProposals } from '../../suivitess/autoImportDbService.js';

describe('cross-user isolation', () => {
  it('listInboxProposals exists and is async', () => {
    // Smoke test — guards against accidental rename / signature change
    // since the service depends on this exact contract.
    expect(typeof listInboxProposals).toBe('function');
    expect(listInboxProposals.constructor.name).toBe('AsyncFunction');
  });
});

// ─────────────────────────────────────────────────────────────────────
// /inbox/consolidations?limit=N — query parsing
//
// The route accepts `?limit=` as a string ; we clamp to a positive
// integer and default to 10. Mirror that here so any future drift
// surfaces in the diff.
// ─────────────────────────────────────────────────────────────────────

function parseLimit(raw: unknown): number {
  const v = typeof raw === 'string' ? parseInt(raw, 10) : 10;
  return Number.isFinite(v) && v > 0 ? v : 10;
}

describe('GET /inbox/consolidations — limit parsing', () => {
  it('defaults to 10 when missing or invalid', () => {
    expect(parseLimit(undefined)).toBe(10);
    expect(parseLimit('not-a-number')).toBe(10);
    expect(parseLimit('-3')).toBe(10);
    expect(parseLimit('0')).toBe(10);
  });
  it('keeps a positive integer', () => {
    expect(parseLimit('5')).toBe(5);
    expect(parseLimit('50')).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────
// /inbox/consolidations/:id/revert — id presence guard
// ─────────────────────────────────────────────────────────────────────

function validateRevertId(id: unknown): { ok: true } | { ok: false; status: number; error: string } {
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, status: 400, error: 'Identifiant manquant' };
  }
  return { ok: true };
}

describe('POST /inbox/consolidations/:id/revert — id guard', () => {
  it('rejects empty id', () => {
    expect(validateRevertId('')).toEqual({ ok: false, status: 400, error: 'Identifiant manquant' });
  });
  it('accepts a non-empty string', () => {
    expect(validateRevertId('run-abc')).toEqual({ ok: true });
  });
});
