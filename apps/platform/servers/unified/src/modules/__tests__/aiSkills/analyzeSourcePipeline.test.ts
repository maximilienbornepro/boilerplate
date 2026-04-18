import { describe, it, expect, afterEach } from 'vitest';

// We can't import `analyzeSourcePipeline` directly without pulling pg +
// Anthropic into the test runner. The helpers we care about are small pure
// functions — we mirror them here, exactly as in the module, so a divergence
// gets caught as a review diff.
//
// `isPipelineEnabled` IS exported and safe to import on its own.
import { isPipelineEnabled } from '../../aiSkills/analyzeSourcePipeline.js';

// ── Mirrored pure helpers ─────────────────────────────────────────────

type SourceKind = 'transcript' | 'slack' | 'outlook' | 'fathom' | 'otter' | 'gmail';

function extractorSlugFor(kind: SourceKind): string {
  if (kind === 'fathom' || kind === 'otter' || kind === 'transcript') return 'suivitess-extract-transcript';
  if (kind === 'slack') return 'suivitess-extract-slack';
  return 'suivitess-extract-outlook';
}

function extractJson<T>(text: string): T | null {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  try { return JSON.parse(s) as T; } catch { /* fall through */ }
  const arrMatch = s.match(/\[[\s\S]*\]/);
  const objMatch = s.match(/\{[\s\S]*\}/);
  try {
    if (arrMatch && (!objMatch || (arrMatch.index ?? 0) < (objMatch.index ?? Infinity))) {
      return JSON.parse(arrMatch[0]) as T;
    }
    if (objMatch) return JSON.parse(objMatch[0]) as T;
  } catch { /* ignore */ }
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('analyzeSourcePipeline — extractorSlugFor', () => {
  it('maps transcript variants to extract-transcript', () => {
    expect(extractorSlugFor('transcript')).toBe('suivitess-extract-transcript');
    expect(extractorSlugFor('fathom')).toBe('suivitess-extract-transcript');
    expect(extractorSlugFor('otter')).toBe('suivitess-extract-transcript');
  });
  it('maps slack to extract-slack', () => {
    expect(extractorSlugFor('slack')).toBe('suivitess-extract-slack');
  });
  it('maps outlook + gmail to extract-outlook', () => {
    expect(extractorSlugFor('outlook')).toBe('suivitess-extract-outlook');
    expect(extractorSlugFor('gmail')).toBe('suivitess-extract-outlook');
  });
});

describe('analyzeSourcePipeline — extractJson (tolerant parser)', () => {
  it('parses a pure JSON array', () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it('parses a pure JSON object', () => {
    expect(extractJson('{"x":true}')).toEqual({ x: true });
  });
  it('strips ```json fences', () => {
    const raw = '```json\n[{"k":"v"}]\n```';
    expect(extractJson(raw)).toEqual([{ k: 'v' }]);
  });
  it('strips anonymous ``` fences', () => {
    const raw = '```\n{"n":42}\n```';
    expect(extractJson(raw)).toEqual({ n: 42 });
  });
  it('extracts a JSON array from surrounding prose', () => {
    const raw = 'Voici :\n[{"id":0}]\nFin.';
    expect(extractJson(raw)).toEqual([{ id: 0 }]);
  });
  it('prefers the array when both array and object are present and array comes first', () => {
    const raw = '[1,2,3] and {"y":1}';
    expect(extractJson(raw)).toEqual([1, 2, 3]);
  });
  it('returns null on unparseable input', () => {
    expect(extractJson('not json at all!')).toBeNull();
  });
  it('returns null on empty input', () => {
    expect(extractJson('')).toBeNull();
  });
});

describe('analyzeSourcePipeline — isPipelineEnabled (env flag)', () => {
  const previous = process.env.USE_PIPELINE_SKILLS;
  afterEach(() => {
    if (previous === undefined) delete process.env.USE_PIPELINE_SKILLS;
    else process.env.USE_PIPELINE_SKILLS = previous;
  });

  it('is off by default (unset env)', () => {
    delete process.env.USE_PIPELINE_SKILLS;
    expect(isPipelineEnabled()).toBe(false);
  });
  it('activates on "1"', () => {
    process.env.USE_PIPELINE_SKILLS = '1';
    expect(isPipelineEnabled()).toBe(true);
  });
  it('activates on "true"', () => {
    process.env.USE_PIPELINE_SKILLS = 'true';
    expect(isPipelineEnabled()).toBe(true);
  });
  it('does NOT activate on arbitrary values ("yes", "0", "on")', () => {
    process.env.USE_PIPELINE_SKILLS = 'yes';
    expect(isPipelineEnabled()).toBe(false);
    process.env.USE_PIPELINE_SKILLS = '0';
    expect(isPipelineEnabled()).toBe(false);
    process.env.USE_PIPELINE_SKILLS = 'on';
    expect(isPipelineEnabled()).toBe(false);
  });
});
