import { describe, it, expect } from 'vitest';
import {
  parseConsolidationOutput,
  enforceNeverFuseDifferentTargets,
} from '../../suivitess/consolidationService.js';
import type { ConsolidatedSubject } from '../../suivitess/consolidationService.js';

// Pure-logic tests for the consolidation skill output parser + safety
// validator. The Anthropic call itself is covered by integration tests ;
// these target the parts that do NOT depend on the network.

describe('parseConsolidationOutput', () => {
  it('parses a happy-path JSON', () => {
    const raw = JSON.stringify({
      consolidated: [
        {
          title: 'OAuth iframe partenaires',
          subjectAction: 'new-subject',
          reviewId: 'rev-1',
          sectionId: 'sec-1',
          targetSubjectId: null,
          situation: 'Vu en daily, confirmé par mail.',
          rawQuotes: ['quote a', 'quote b'],
          entities: ['OAuth', 'Orange'],
          mergedFrom: [
            { rowId: 'row-a', proposalIndex: 0, sourceTitle: 'Daily TV 17/04' },
            { rowId: 'row-b', proposalIndex: 2, sourceTitle: 'Mail Orange 21/04' },
          ],
          reasoning: 'Entités partagées.',
        },
      ],
    });
    const out = parseConsolidationOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('OAuth iframe partenaires');
    expect(out[0].mergedFrom).toHaveLength(2);
    expect(out[0].entities).toEqual(['OAuth', 'Orange']);
  });

  it('strips markdown fences the model sometimes adds', () => {
    const raw = '```json\n' + JSON.stringify({
      consolidated: [
        {
          title: 'Solo subject',
          subjectAction: 'new-subject',
          mergedFrom: [{ rowId: 'r1', proposalIndex: 0, sourceTitle: 's1' }],
        },
      ],
    }) + '\n```';
    const out = parseConsolidationOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Solo subject');
  });

  it('returns [] on garbled output', () => {
    expect(parseConsolidationOutput('not json at all')).toEqual([]);
    expect(parseConsolidationOutput('')).toEqual([]);
    expect(parseConsolidationOutput('{ "consolidated": "not an array" }')).toEqual([]);
  });

  it('drops entries without a title or without mergedFrom', () => {
    const raw = JSON.stringify({
      consolidated: [
        { title: '', mergedFrom: [{ rowId: 'a', proposalIndex: 0, sourceTitle: 's' }] },
        { title: 'Valid', mergedFrom: [] },
        { title: 'OK', mergedFrom: [{ rowId: 'a', proposalIndex: 0, sourceTitle: 's' }] },
      ],
    });
    const out = parseConsolidationOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('OK');
  });

  it('coerces unexpected types defensively', () => {
    const raw = JSON.stringify({
      consolidated: [
        {
          title: 'X',
          subjectAction: 'weird-action',           // not a valid action
          mergedFrom: [{ rowId: 'r', proposalIndex: 0, sourceTitle: 's' }],
          rawQuotes: 'not an array',                // wrong type
          entities: ['ok', 42, null],               // mixed types
        },
      ],
    });
    const out = parseConsolidationOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].subjectAction).toBe('new-subject'); // fallback
    expect(out[0].rawQuotes).toEqual([]);
    // 42 and null are stringified.
    expect(out[0].entities).toEqual(['ok', '42', 'null']);
  });
});

describe('enforceNeverFuseDifferentTargets', () => {
  function make(c: Partial<ConsolidatedSubject> & { mergedFrom: ConsolidatedSubject['mergedFrom'] }): ConsolidatedSubject {
    return {
      title: 'T',
      subjectAction: 'new-subject',
      reviewId: null,
      sectionId: null,
      suggestedNewReviewTitle: null,
      suggestedNewSectionName: null,
      targetSubjectId: null,
      situation: '',
      rawQuotes: [],
      entities: [],
      reasoning: '',
      ...c,
    };
  }

  it('keeps a fusion of two new-subject proposals (no targetSubjectId at all)', () => {
    const consolidated = [make({
      mergedFrom: [
        { rowId: 'r1', proposalIndex: 0, sourceTitle: 's1' },
        { rowId: 'r2', proposalIndex: 0, sourceTitle: 's2' },
      ],
    })];
    const idx = new Map([
      ['r1', [{ subjectAction: 'new-subject', targetSubjectId: null }]],
      ['r2', [{ subjectAction: 'new-subject', targetSubjectId: null }]],
    ]);
    const out = enforceNeverFuseDifferentTargets(consolidated, idx);
    expect(out).toHaveLength(1);
    expect(out[0].mergedFrom).toHaveLength(2);
  });

  it('keeps a fusion of two updates targeting the SAME existing subject', () => {
    const consolidated = [make({
      subjectAction: 'update-existing-subject',
      targetSubjectId: 'subj-1',
      mergedFrom: [
        { rowId: 'r1', proposalIndex: 0, sourceTitle: 's1' },
        { rowId: 'r2', proposalIndex: 0, sourceTitle: 's2' },
      ],
    })];
    const idx = new Map([
      ['r1', [{ subjectAction: 'update-existing-subject', targetSubjectId: 'subj-1' }]],
      ['r2', [{ subjectAction: 'update-existing-subject', targetSubjectId: 'subj-1' }]],
    ]);
    const out = enforceNeverFuseDifferentTargets(consolidated, idx);
    expect(out).toHaveLength(1);
  });

  it('SPLITS a violation where two updates target DIFFERENT subjects', () => {
    const consolidated = [make({
      subjectAction: 'update-existing-subject',
      targetSubjectId: 'subj-1',
      mergedFrom: [
        { rowId: 'r1', proposalIndex: 0, sourceTitle: 's1' },
        { rowId: 'r2', proposalIndex: 0, sourceTitle: 's2' },
      ],
    })];
    const idx = new Map([
      ['r1', [{ subjectAction: 'update-existing-subject', targetSubjectId: 'subj-1' }]],
      ['r2', [{ subjectAction: 'update-existing-subject', targetSubjectId: 'subj-OTHER' }]],
    ]);
    const out = enforceNeverFuseDifferentTargets(consolidated, idx);
    expect(out).toHaveLength(2);
    expect(out[0].mergedFrom).toHaveLength(1);
    expect(out[1].mergedFrom).toHaveLength(1);
    expect(out[0].mergedFrom[0].rowId).toBe('r1');
    expect(out[1].mergedFrom[0].rowId).toBe('r2');
  });

  it('leaves solo entries untouched', () => {
    const consolidated = [make({
      mergedFrom: [{ rowId: 'r1', proposalIndex: 0, sourceTitle: 's1' }],
    })];
    const out = enforceNeverFuseDifferentTargets(consolidated, new Map());
    expect(out).toEqual(consolidated);
  });
});
