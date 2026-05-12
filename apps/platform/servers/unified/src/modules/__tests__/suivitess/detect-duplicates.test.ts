import { describe, it, expect } from 'vitest';
import {
  parseDuplicateDetectionOutput,
  dropSameDocGroups,
} from '../../suivitess/duplicateDetectionService.js';
import type { DuplicateGroup } from '../../suivitess/duplicateDetectionService.js';

// Pure-logic tests for the cross-doc duplicate detection skill. We cover
// the output parser and the same-doc safety net here ; the Anthropic
// call itself is exercised by manual QA + the integration logs.

describe('parseDuplicateDetectionOutput', () => {
  it('parses a happy-path JSON', () => {
    const raw = JSON.stringify({
      groups: [
        {
          subjectIds: ['s1', 's2', 's3'],
          confidence: 'high',
          reasoning: 'Entités partagées : OAuth + Orange.',
        },
        {
          subjectIds: ['s4', 's5'],
          confidence: 'medium',
          reasoning: 'Titres redondants.',
        },
      ],
    });
    const out = parseDuplicateDetectionOutput(raw);
    expect(out).toHaveLength(2);
    expect(out[0].subjectIds).toEqual(['s1', 's2', 's3']);
    expect(out[0].confidence).toBe('high');
    expect(out[1].confidence).toBe('medium');
  });

  it('strips markdown fences the model sometimes adds', () => {
    const raw = '```json\n' + JSON.stringify({
      groups: [{ subjectIds: ['a', 'b'], confidence: 'high', reasoning: 'X' }],
    }) + '\n```';
    const out = parseDuplicateDetectionOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].subjectIds).toEqual(['a', 'b']);
  });

  it('returns [] on garbled output', () => {
    expect(parseDuplicateDetectionOutput('not json')).toEqual([]);
    expect(parseDuplicateDetectionOutput('')).toEqual([]);
    expect(parseDuplicateDetectionOutput('{ "groups": "not an array" }')).toEqual([]);
  });

  it('drops groups with fewer than 2 subjectIds', () => {
    const raw = JSON.stringify({
      groups: [
        { subjectIds: ['solo'], confidence: 'high', reasoning: 'X' },
        { subjectIds: [], confidence: 'high', reasoning: 'X' },
        { subjectIds: ['a', 'b'], confidence: 'high', reasoning: 'X' },
      ],
    });
    const out = parseDuplicateDetectionOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].subjectIds).toEqual(['a', 'b']);
  });

  it('drops groups with confidence: low (we never surface them)', () => {
    const raw = JSON.stringify({
      groups: [
        { subjectIds: ['a', 'b'], confidence: 'low', reasoning: 'Faible.' },
        { subjectIds: ['c', 'd'], confidence: 'high', reasoning: 'OK.' },
      ],
    });
    const out = parseDuplicateDetectionOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].subjectIds).toEqual(['c', 'd']);
  });

  it('coerces unknown confidence values to medium', () => {
    const raw = JSON.stringify({
      groups: [
        { subjectIds: ['a', 'b'], confidence: 'medium-ish', reasoning: 'X' },
      ],
    });
    const out = parseDuplicateDetectionOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe('medium');
  });

  it('filters non-string subjectIds defensively', () => {
    const raw = JSON.stringify({
      groups: [
        { subjectIds: ['a', 42, null, 'b'], confidence: 'high', reasoning: 'X' },
      ],
    });
    const out = parseDuplicateDetectionOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].subjectIds).toEqual(['a', 'b']);
  });
});

describe('dropSameDocGroups', () => {
  function makeGroup(over: Partial<DuplicateGroup> & { subjectIds: string[] }): DuplicateGroup {
    return {
      subjectIds: over.subjectIds,
      confidence: over.confidence ?? 'high',
      reasoning: over.reasoning ?? '',
    };
  }

  it('keeps groups where subjects span ≥ 2 documents', () => {
    const docs = new Map([
      ['s1', 'docA'],
      ['s2', 'docB'],
      ['s3', 'docC'],
    ]);
    const out = dropSameDocGroups([makeGroup({ subjectIds: ['s1', 's2', 's3'] })], docs);
    expect(out).toHaveLength(1);
  });

  it('drops groups where every subject lives in the same document', () => {
    const docs = new Map([
      ['s1', 'docA'],
      ['s2', 'docA'],
      ['s3', 'docA'],
    ]);
    const out = dropSameDocGroups([makeGroup({ subjectIds: ['s1', 's2', 's3'] })], docs);
    expect(out).toEqual([]);
  });

  it('drops groups containing unknown subjectIds (hallucinations)', () => {
    const docs = new Map([
      ['s1', 'docA'],
      ['s2', 'docB'],
    ]);
    const out = dropSameDocGroups(
      [makeGroup({ subjectIds: ['s1', 's2', 'GHOST-ID'] })],
      docs,
    );
    expect(out).toEqual([]);
  });

  it('caps subjectIds at 5 per group', () => {
    const docs = new Map([
      ['s1', 'docA'], ['s2', 'docB'], ['s3', 'docC'],
      ['s4', 'docD'], ['s5', 'docE'], ['s6', 'docF'], ['s7', 'docG'],
    ]);
    const out = dropSameDocGroups(
      [makeGroup({ subjectIds: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] })],
      docs,
    );
    expect(out).toHaveLength(1);
    expect(out[0].subjectIds).toHaveLength(5);
    expect(out[0].subjectIds).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });

  it('hard-caps the total number of groups at 20', () => {
    const docs = new Map<string, string>();
    const groups: DuplicateGroup[] = [];
    for (let i = 0; i < 25; i++) {
      docs.set(`a${i}`, `docA${i}`);
      docs.set(`b${i}`, `docB${i}`);
      groups.push(makeGroup({ subjectIds: [`a${i}`, `b${i}`] }));
    }
    const out = dropSameDocGroups(groups, docs);
    expect(out).toHaveLength(20);
  });

  it('keeps mixed-doc groups even when some subjects share a document', () => {
    // s1 + s2 share docA, but s3 lives in docB → group spans 2 docs.
    const docs = new Map([
      ['s1', 'docA'],
      ['s2', 'docA'],
      ['s3', 'docB'],
    ]);
    const out = dropSameDocGroups([makeGroup({ subjectIds: ['s1', 's2', 's3'] })], docs);
    expect(out).toHaveLength(1);
  });
});
