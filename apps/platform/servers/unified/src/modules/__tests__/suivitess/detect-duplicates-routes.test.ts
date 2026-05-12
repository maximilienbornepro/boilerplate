import { describe, it, expect } from 'vitest';

// The /detect-cross-doc-duplicates route trio is a thin shell over
// duplicateDetectionService — most of the value is the input cleaning
// at the route boundary. We mirror it here so any future route edit
// surfaces in the diff. Service-level behaviour is covered in
// detect-duplicates.test.ts.

interface ApplyBody {
  logId?: unknown;
  acceptedGroups?: unknown;
}
interface CleanedGroup { parentId: string; duplicateIds: string[] }
interface CleanedApply { logId: number | null; groups: CleanedGroup[] }

function cleanApplyBody(body: ApplyBody): { ok: true; cleaned: CleanedApply } | { ok: false; status: number; error: string } {
  if (!Array.isArray(body.acceptedGroups) || body.acceptedGroups.length === 0) {
    return { ok: false, status: 400, error: 'Aucun groupe à appliquer' };
  }
  const cleanedLogId = typeof body.logId === 'number' && Number.isFinite(body.logId)
    ? (body.logId as number) : null;
  const cleaned: CleanedGroup[] = (body.acceptedGroups as Array<Record<string, unknown>>)
    .map(g => ({
      parentId: typeof g.parentId === 'string' ? g.parentId : '',
      duplicateIds: Array.isArray(g.duplicateIds)
        ? (g.duplicateIds as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
    }))
    .filter(g => g.parentId.length > 0 && g.duplicateIds.length > 0);
  if (cleaned.length === 0) {
    return { ok: false, status: 400, error: 'Aucun groupe valide' };
  }
  return { ok: true, cleaned: { logId: cleanedLogId, groups: cleaned } };
}

interface RevertBody { runId?: unknown }
function validateRevertBody(body: RevertBody): { ok: true; runId: string } | { ok: false; status: number; error: string } {
  if (typeof body.runId !== 'string' || body.runId.length === 0) {
    return { ok: false, status: 400, error: 'Identifiant de détection manquant' };
  }
  return { ok: true, runId: body.runId };
}

describe('POST /detect-cross-doc-duplicates/apply — body validation', () => {
  it('rejects empty acceptedGroups', () => {
    expect(cleanApplyBody({ acceptedGroups: [] })).toEqual({
      ok: false, status: 400, error: 'Aucun groupe à appliquer',
    });
  });

  it('rejects non-array acceptedGroups', () => {
    expect(cleanApplyBody({ acceptedGroups: 'oops' })).toEqual({
      ok: false, status: 400, error: 'Aucun groupe à appliquer',
    });
    expect(cleanApplyBody({})).toEqual({
      ok: false, status: 400, error: 'Aucun groupe à appliquer',
    });
  });

  it('drops groups with missing parentId', () => {
    const out = cleanApplyBody({
      acceptedGroups: [
        { parentId: '', duplicateIds: ['d1'] },
        { parentId: 'p1', duplicateIds: ['d1', 'd2'] },
      ],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.cleaned.groups).toHaveLength(1);
      expect(out.cleaned.groups[0]).toEqual({ parentId: 'p1', duplicateIds: ['d1', 'd2'] });
    }
  });

  it('drops groups with empty duplicateIds', () => {
    const out = cleanApplyBody({
      acceptedGroups: [
        { parentId: 'p1', duplicateIds: [] },
        { parentId: 'p2', duplicateIds: ['d1'] },
      ],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.cleaned.groups).toHaveLength(1);
      expect(out.cleaned.groups[0].parentId).toBe('p2');
    }
  });

  it('returns 400 when every group is invalid', () => {
    const out = cleanApplyBody({
      acceptedGroups: [
        { parentId: '', duplicateIds: ['d1'] },
        { parentId: 'p1', duplicateIds: [] },
      ],
    });
    expect(out).toEqual({ ok: false, status: 400, error: 'Aucun groupe valide' });
  });

  it('coerces logId to null when missing or non-numeric', () => {
    const out = cleanApplyBody({
      logId: 'not-a-number',
      acceptedGroups: [{ parentId: 'p', duplicateIds: ['d'] }],
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.cleaned.logId).toBeNull();
  });

  it('keeps a valid numeric logId', () => {
    const out = cleanApplyBody({
      logId: 42,
      acceptedGroups: [{ parentId: 'p', duplicateIds: ['d'] }],
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.cleaned.logId).toBe(42);
  });

  it('filters non-string entries inside duplicateIds', () => {
    const out = cleanApplyBody({
      acceptedGroups: [{ parentId: 'p', duplicateIds: ['d1', 42, null, 'd2'] }],
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.cleaned.groups[0].duplicateIds).toEqual(['d1', 'd2']);
  });
});

describe('POST /detect-cross-doc-duplicates/revert — body validation', () => {
  it('rejects missing runId', () => {
    expect(validateRevertBody({})).toEqual({
      ok: false, status: 400, error: 'Identifiant de détection manquant',
    });
  });

  it('rejects non-string runId', () => {
    expect(validateRevertBody({ runId: 42 })).toEqual({
      ok: false, status: 400, error: 'Identifiant de détection manquant',
    });
  });

  it('rejects empty-string runId', () => {
    expect(validateRevertBody({ runId: '' })).toEqual({
      ok: false, status: 400, error: 'Identifiant de détection manquant',
    });
  });

  it('accepts a valid runId', () => {
    expect(validateRevertBody({ runId: 'run-abc' })).toEqual({
      ok: true, runId: 'run-abc',
    });
  });
});

// Smoke test : duplicateDetectionService exports the three public
// functions the routes import.
describe('duplicateDetectionService exports', () => {
  it('exposes detect/apply/revert + parser/safety helpers', async () => {
    const mod = await import('../../suivitess/duplicateDetectionService.js');
    expect(typeof mod.detectCrossDocDuplicatesForUser).toBe('function');
    expect(typeof mod.applyDuplicateLinks).toBe('function');
    expect(typeof mod.revertDuplicateRun).toBe('function');
    expect(typeof mod.parseDuplicateDetectionOutput).toBe('function');
    expect(typeof mod.dropSameDocGroups).toBe('function');
  });
});
