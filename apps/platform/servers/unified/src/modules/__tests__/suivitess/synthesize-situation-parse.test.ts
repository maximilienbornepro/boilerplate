import { describe, it, expect } from 'vitest';

/**
 * Pure unit test mirroring the JSON-parsing fallback that the
 * `/subjects/:id/synthesize-situation` route applies to the
 * `suivitess-synthesize-situation` skill's output. We don't import
 * the route (it pulls in pg + Anthropic) — instead we re-implement
 * the parsing here so the contract is locked in via a focused unit
 * test.
 *
 * Contract :
 *   - Happy path : a JSON object `{ "situation": "..." }` (optionally
 *     wrapped in ```json ... ``` fences) yields a non-empty string.
 *   - Defensive : missing or non-string `situation` field, or
 *     unparseable garbage, yields `null` (the route turns this into
 *     a 502 and leaves the existing situation untouched).
 */
function parseSynthesizeOutput(outputText: string): string | null {
  let result: { situation?: unknown } = {};
  try {
    let json = outputText.trim();
    if (json.startsWith('```json')) json = json.slice(7);
    if (json.startsWith('```')) json = json.slice(3);
    if (json.endsWith('```')) json = json.slice(0, -3);
    result = JSON.parse(json.trim());
  } catch {
    const match = outputText.match(/\{[\s\S]*\}/);
    if (match) {
      try { result = JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }
  if (typeof result.situation !== 'string' || result.situation.trim().length === 0) {
    return null;
  }
  return result.situation;
}

describe('suivitess · synthesize-situation output parser', () => {
  it('happy path : extracts the `situation` field from a raw JSON object', () => {
    const raw = '{"situation": "Line 1.\\n  Line 2."}';
    expect(parseSynthesizeOutput(raw)).toBe('Line 1.\n  Line 2.');
  });

  it('happy path : strips ```json fences if the model adds them', () => {
    const raw = '```json\n{"situation": "Cleaned situation."}\n```';
    expect(parseSynthesizeOutput(raw)).toBe('Cleaned situation.');
  });

  it('happy path : falls back to extracting the first `{...}` block if there is preamble', () => {
    const raw = 'Voici le résultat :\n\n{"situation": "Recovered."}\n\nFin.';
    expect(parseSynthesizeOutput(raw)).toBe('Recovered.');
  });

  it('defensive : returns null when the `situation` field is missing', () => {
    const raw = '{"something_else": "value"}';
    expect(parseSynthesizeOutput(raw)).toBeNull();
  });

  it('defensive : returns null when `situation` is empty string', () => {
    const raw = '{"situation": ""}';
    expect(parseSynthesizeOutput(raw)).toBeNull();
  });

  it('defensive : returns null when `situation` is not a string', () => {
    const raw = '{"situation": 42}';
    expect(parseSynthesizeOutput(raw)).toBeNull();
  });

  it('defensive : returns null when the output is garbled and contains no parseable JSON', () => {
    const raw = 'This is not JSON at all.';
    expect(parseSynthesizeOutput(raw)).toBeNull();
  });
});
