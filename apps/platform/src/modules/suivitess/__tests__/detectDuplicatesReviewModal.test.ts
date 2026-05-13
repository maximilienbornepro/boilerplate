import { describe, it, expect } from 'vitest';
import type { DuplicateGroupApi, DuplicateSubjectApi } from '../services/api';

// Pure-logic tests for the DetectDuplicatesReviewModal helpers. We
// mirror the modal's helpers here (rather than importing the component
// itself) because the suivitess client-test project runs in a Node
// environment without a CSS module loader. The component's render path
// is covered by manual QA + the screenshot in the PR description. Any
// drift between this mirror and the actual modal would cause the apply
// payload contract to silently desync — keep them in lockstep.

/** Stable identity for a group inside the modal — derived from its
 *  ordered subjectIds. */
function keyForGroup(g: DuplicateGroupApi): string {
  return g.subjectIds.join('|');
}

/** Pick the default parent : the subject with the most recent
 *  `updatedAt`. Falls back to the first subjectId when timestamps are
 *  missing. */
function defaultParentFor(
  group: DuplicateGroupApi,
  subjects: Record<string, DuplicateSubjectApi>,
): string {
  let best: { id: string; ts: string } | null = null;
  for (const id of group.subjectIds) {
    const s = subjects[id];
    if (!s) continue;
    const ts = s.updatedAt || '';
    if (!best || ts > best.ts) best = { id, ts };
  }
  return best?.id ?? group.subjectIds[0];
}

function makeSubject(over: Partial<DuplicateSubjectApi> & { id: string }): DuplicateSubjectApi {
  return {
    id: over.id,
    title: over.title ?? `Subject ${over.id}`,
    status: over.status ?? '🔴 à faire',
    responsibility: over.responsibility ?? null,
    situationExcerpt: over.situationExcerpt ?? '',
    documentId: over.documentId ?? 'doc-1',
    documentTitle: over.documentTitle ?? 'Review 1',
    sectionId: over.sectionId ?? 'sec-1',
    sectionName: over.sectionName ?? 'Section 1',
    updatedAt: over.updatedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('DetectDuplicatesReviewModal — keyForGroup', () => {
  it('returns a stable key derived from the ordered subjectIds', () => {
    const g: DuplicateGroupApi = { subjectIds: ['a', 'b', 'c'], confidence: 'high', reasoning: 'X' };
    expect(keyForGroup(g)).toBe('a|b|c');
  });

  it('differs when subjectIds differ', () => {
    const a: DuplicateGroupApi = { subjectIds: ['x', 'y'], confidence: 'high', reasoning: '' };
    const b: DuplicateGroupApi = { subjectIds: ['x', 'z'], confidence: 'high', reasoning: '' };
    expect(keyForGroup(a)).not.toBe(keyForGroup(b));
  });
});

describe('DetectDuplicatesReviewModal — defaultParentFor', () => {
  it('picks the subject with the most recent updatedAt', () => {
    const g: DuplicateGroupApi = { subjectIds: ['s1', 's2', 's3'], confidence: 'high', reasoning: '' };
    const subjects: Record<string, DuplicateSubjectApi> = {
      s1: makeSubject({ id: 's1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      s2: makeSubject({ id: 's2', updatedAt: '2026-03-15T00:00:00.000Z' }),
      s3: makeSubject({ id: 's3', updatedAt: '2026-02-01T00:00:00.000Z' }),
    };
    expect(defaultParentFor(g, subjects)).toBe('s2');
  });

  it('falls back to the first subjectId when updatedAt is missing', () => {
    const g: DuplicateGroupApi = { subjectIds: ['a', 'b'], confidence: 'high', reasoning: '' };
    const subjects: Record<string, DuplicateSubjectApi> = {
      a: makeSubject({ id: 'a', updatedAt: '' }),
      b: makeSubject({ id: 'b', updatedAt: '' }),
    };
    expect(defaultParentFor(g, subjects)).toBe('a');
  });

  it('handles unknown subjectIds by falling back to the known one', () => {
    const g: DuplicateGroupApi = { subjectIds: ['ghost', 'real'], confidence: 'high', reasoning: '' };
    const subjects: Record<string, DuplicateSubjectApi> = {
      real: makeSubject({ id: 'real', updatedAt: '2026-05-01T00:00:00.000Z' }),
    };
    expect(defaultParentFor(g, subjects)).toBe('real');
  });
});

// Mirror of the apply payload assembly the modal does on click. Used to
// validate the contract sent to api.applyCrossDocDuplicates.
function buildApplyPayload(
  groups: DuplicateGroupApi[],
  parents: Record<string, string>,
  subjects: Record<string, DuplicateSubjectApi>,
): Array<{ parentId: string; duplicateIds: string[] }> {
  return groups.map(g => {
    const parentId = parents[keyForGroup(g)] ?? defaultParentFor(g, subjects);
    return {
      parentId,
      duplicateIds: g.subjectIds.filter(id => id !== parentId),
    };
  });
}

describe('DetectDuplicatesReviewModal — apply payload', () => {
  it('excludes the parent from duplicateIds (3-subject group)', () => {
    const g: DuplicateGroupApi = { subjectIds: ['a', 'b', 'c'], confidence: 'high', reasoning: '' };
    const subjects: Record<string, DuplicateSubjectApi> = {
      a: makeSubject({ id: 'a' }),
      b: makeSubject({ id: 'b' }),
      c: makeSubject({ id: 'c' }),
    };
    const out = buildApplyPayload([g], { [keyForGroup(g)]: 'b' }, subjects);
    expect(out).toEqual([{ parentId: 'b', duplicateIds: ['a', 'c'] }]);
  });

  it('uses the most-recent-updatedAt default when no override is set', () => {
    const g: DuplicateGroupApi = { subjectIds: ['old', 'new'], confidence: 'high', reasoning: '' };
    const subjects: Record<string, DuplicateSubjectApi> = {
      old: makeSubject({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      new: makeSubject({ id: 'new', updatedAt: '2026-04-01T00:00:00.000Z' }),
    };
    const out = buildApplyPayload([g], {}, subjects);
    expect(out).toEqual([{ parentId: 'new', duplicateIds: ['old'] }]);
  });

  it('handles "Tout lier avec parent par défaut" across multiple groups', () => {
    const g1: DuplicateGroupApi = { subjectIds: ['a', 'b'], confidence: 'high', reasoning: '' };
    const g2: DuplicateGroupApi = { subjectIds: ['c', 'd'], confidence: 'medium', reasoning: '' };
    const subjects: Record<string, DuplicateSubjectApi> = {
      a: makeSubject({ id: 'a', updatedAt: '2026-05-01T00:00:00.000Z' }),
      b: makeSubject({ id: 'b', updatedAt: '2026-01-01T00:00:00.000Z' }),
      c: makeSubject({ id: 'c', updatedAt: '2026-01-01T00:00:00.000Z' }),
      d: makeSubject({ id: 'd', updatedAt: '2026-06-01T00:00:00.000Z' }),
    };
    const out = buildApplyPayload([g1, g2], {}, subjects);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ parentId: 'a', duplicateIds: ['b'] });
    expect(out[1]).toEqual({ parentId: 'd', duplicateIds: ['c'] });
  });

  it('respects an explicit parent override over the default', () => {
    const g: DuplicateGroupApi = { subjectIds: ['old', 'new'], confidence: 'high', reasoning: '' };
    const subjects: Record<string, DuplicateSubjectApi> = {
      old: makeSubject({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      new: makeSubject({ id: 'new', updatedAt: '2026-04-01T00:00:00.000Z' }),
    };
    const out = buildApplyPayload([g], { [keyForGroup(g)]: 'old' }, subjects);
    expect(out).toEqual([{ parentId: 'old', duplicateIds: ['new'] }]);
  });
});
