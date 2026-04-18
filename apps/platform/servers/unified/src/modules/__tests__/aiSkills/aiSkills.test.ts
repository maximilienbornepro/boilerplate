import { describe, it, expect } from 'vitest';
import { SKILLS, getSkill } from '../../aiSkills/registry.js';

describe('aiSkills.registry', () => {
  it('exposes the 12 expected slugs (5 legacy + 7 modular pipeline)', () => {
    const slugs = SKILLS.map(s => s.slug).sort();
    expect(slugs).toEqual([
      'delivery-reorganize-board',
      'llm-judge-faithfulness',
      'suivitess-append-situation',
      'suivitess-compose-situation',
      'suivitess-extract-outlook',
      'suivitess-extract-slack',
      'suivitess-extract-transcript',
      'suivitess-import-source-into-document',
      'suivitess-place-in-document',
      'suivitess-place-in-reviews',
      'suivitess-reformulate-subject',
      'suivitess-route-source-to-review',
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
      expect(def!.defaultFilePath).toMatch(/suivitess\/skill-.*\.md$/);
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
