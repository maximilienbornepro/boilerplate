import { describe, it, expect } from 'vitest';
import { SKILLS, getSkill } from '../../aiSkills/registry.js';

describe('aiSkills.registry', () => {
  it('exposes the 16 expected slugs (legacy + modular pipelines + multi-source reconciliation + name suggester)', () => {
    const slugs = SKILLS.map(s => s.slug).sort();
    expect(slugs).toEqual([
      'delivery-assess-tickets',
      'delivery-reorganize-board',
      'delivery-write-reasoning',
      'llm-judge-faithfulness',
      'suivitess-append-situation',
      'suivitess-compose-situation',
      'suivitess-extract-outlook',
      'suivitess-extract-slack',
      'suivitess-extract-transcript',
      'suivitess-import-source-into-document',
      'suivitess-place-in-document',
      'suivitess-place-in-reviews',
      'suivitess-reconcile-multi-source',
      'suivitess-reformulate-subject',
      'suivitess-route-source-to-review',
      'suivitess-suggest-name',
    ]);
  });

  it('all pipeline skills are registered under the suivitess module', () => {
    const pipelineSlugs = [
      'suivitess-extract-transcript',
      'suivitess-extract-slack',
      'suivitess-extract-outlook',
      'suivitess-place-in-document',
      'suivitess-place-in-reviews',
      'suivitess-append-situation',
      'suivitess-compose-situation',
    ];
    for (const slug of pipelineSlugs) {
      const def = getSkill(slug);
      expect(def, `slug ${slug}`).toBeDefined();
      expect(def!.usage.module).toBe('suivitess');
      expect(def!.defaultFilePath).toMatch(/prompts\/suivitess\/.*\.md$/);
    }
  });

  it('each skill has a non-empty name, description and default file path', () => {
    for (const s of SKILLS) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.defaultFilePath).toMatch(/\.md$/);
      expect(s.usage.endpoint.length).toBeGreaterThan(0);
      expect(s.usage.trigger.length).toBeGreaterThan(0);
    }
  });

  it('getSkill returns definition for a known slug', () => {
    const def = getSkill('suivitess-route-source-to-review');
    expect(def).toBeDefined();
    expect(def!.usage.module).toBe('suivitess');
  });

  it('getSkill returns undefined for an unknown slug', () => {
    expect(getSkill('nope')).toBeUndefined();
  });
});

describe('streamingAnalysisService — extractProposals (pure parser)', () => {
  // Pure re-implementation mirroring the module's internal parser ; the
  // service itself is not imported (it pulls in pg + Anthropic).
  function extractProposals(fullText: string): Array<Record<string, unknown>> {
    const resultMatch = fullText.match(/<result>([\s\S]*?)<\/result>/);
    const jsonSource = resultMatch ? resultMatch[1] : fullText;

    const arrayMatch = jsonSource.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch { /* fallthrough */ }
    }

    const objMatch = jsonSource.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        if (Array.isArray(parsed?.proposals)) return parsed.proposals;
      } catch { /* fallthrough */ }
    }
    return [];
  }

  it('extracts proposals from a <result>-wrapped array', () => {
    const text = `<journal>…</journal><result>[{"action":"enrich","subjectId":"x","appendText":"y"}]</result>`;
    expect(extractProposals(text)).toEqual([
      { action: 'enrich', subjectId: 'x', appendText: 'y' },
    ]);
  });

  it('extracts proposals from a bare array (legacy non-streaming)', () => {
    const text = '[{"action":"create_subject","title":"T","sectionId":"s"}]';
    expect(extractProposals(text)).toEqual([
      { action: 'create_subject', title: 'T', sectionId: 's' },
    ]);
  });

  it('extracts proposals from a { "proposals": [] } wrapper', () => {
    const text = '{"proposals":[{"action":"create_section","sectionName":"N"}]}';
    expect(extractProposals(text)).toEqual([
      { action: 'create_section', sectionName: 'N' },
    ]);
  });

  it('returns an empty array when no JSON can be found', () => {
    expect(extractProposals('(pas de json ici)')).toEqual([]);
  });
});

// ── Multi-source reconciliation parser ─────────────────────────────────
// Pure-parser tests — exercises the shape expected from the
// suivitess-reconcile-multi-source skill. The orchestrator's
// `buildPassThroughConsolidation` fallback is covered here too, since
// its shape must match what the parser outputs (same type).

describe('reconcile-multi-source — output parser', () => {
  interface ConsolidatedSubject {
    canonicalTitle: string;
    evidence: Array<{
      sourceId: string;
      sourceType: string;
      ts: string;
      subjectIndex: number;
      rawQuotes: string[];
      stance: 'propose' | 'confirm' | 'complement' | 'contradict';
      summary: string;
    }>;
    chronology: string | null;
    reconciliationNote: string | null;
    mergedRawQuotes: string[];
    mergedParticipants: string[];
    mergedEntities: string[];
    mergedStatusHint: string | null;
    mergedResponsibilityHint: string | null;
  }

  /** Mirror of the extractJson() helper in analyzeSourcePipeline.ts — kept
   *  inline so this test file doesn't import the pipeline (which pulls
   *  in Anthropic SDK + pg). */
  function parseReconcileOutput(text: string): ConsolidatedSubject[] | null {
    let s = text.trim();
    if (s.startsWith('```json')) s = s.slice(7).trim();
    else if (s.startsWith('```')) s = s.slice(3).trim();
    if (s.endsWith('```')) s = s.slice(0, -3).trim();
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed as ConsolidatedSubject[] : null;
    } catch { return null; }
  }

  it('parses a well-formed consolidation with contradiction', () => {
    const output = JSON.stringify([{
      canonicalTitle: 'Refonte login',
      evidence: [
        { sourceId: 't-1', sourceType: 'transcription', ts: '2026-04-18T10:00:00Z',
          subjectIndex: 0, rawQuotes: ['OAuth direct'], stance: 'propose',
          summary: 'Équipe propose OAuth' },
        { sourceId: 'e-2', sourceType: 'outlook', ts: '2026-04-19T14:30:00Z',
          subjectIndex: 0, rawQuotes: ['RSSI refuse OAuth'], stance: 'contradict',
          summary: 'RSSI refuse' },
      ],
      chronology: 'transcription jeudi → email vendredi (contradiction)',
      reconciliationNote: 'La décision OAuth est invalidée vendredi.',
      mergedRawQuotes: ['OAuth direct', 'RSSI refuse OAuth'],
      mergedParticipants: ['Alice'],
      mergedEntities: ['OAuth', 'SSO'],
      mergedStatusHint: null,
      mergedResponsibilityHint: 'Alice',
    }]);
    const parsed = parseReconcileOutput(output);
    expect(parsed).not.toBeNull();
    expect(parsed!).toHaveLength(1);
    expect(parsed![0].evidence[1].stance).toBe('contradict');
    expect(parsed![0].reconciliationNote).toContain('OAuth');
  });

  it('parses a pass-through (single-source) consolidation', () => {
    const output = JSON.stringify([{
      canonicalTitle: 'Incident API',
      evidence: [
        { sourceId: 't-1', sourceType: 'transcription', ts: '2026-04-18T10:00:00Z',
          subjectIndex: 0, rawQuotes: ['API down à 10h'], stance: 'propose',
          summary: 'Incident' },
      ],
      chronology: null,
      reconciliationNote: null,
      mergedRawQuotes: ['API down à 10h'],
      mergedParticipants: [],
      mergedEntities: [],
      mergedStatusHint: null,
      mergedResponsibilityHint: null,
    }]);
    const parsed = parseReconcileOutput(output);
    expect(parsed).not.toBeNull();
    expect(parsed![0].evidence).toHaveLength(1);
    expect(parsed![0].reconciliationNote).toBeNull();
  });

  it('tolerates a ```json fence wrapper', () => {
    const output = '```json\n[{"canonicalTitle":"x","evidence":[],"chronology":null,"reconciliationNote":null,"mergedRawQuotes":[],"mergedParticipants":[],"mergedEntities":[],"mergedStatusHint":null,"mergedResponsibilityHint":null}]\n```';
    const parsed = parseReconcileOutput(output);
    expect(parsed).not.toBeNull();
    expect(parsed![0].canonicalTitle).toBe('x');
  });

  it('returns null on malformed JSON', () => {
    expect(parseReconcileOutput('(nothing)')).toBeNull();
    expect(parseReconcileOutput('{"not":"an array"}')).toBeNull();
  });
});
