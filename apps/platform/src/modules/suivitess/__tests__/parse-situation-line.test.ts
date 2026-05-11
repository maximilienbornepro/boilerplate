import { describe, it, expect } from 'vitest';
import { parseSituationLine } from '../components/SubjectReview/parseSituationLine';

/**
 * Pin the contract of `parseSituationLine` — the helper consumed by
 * the SubjectReview renderer to extract indentation level, text,
 * the `[!]` AI-edited marker, and the `~~…~~` strikethrough wrapper.
 *
 * The `[!]` marker is the linchpin of Step 3 of the situation
 * refactor — it round-trips between storage, render, and edits.
 */
describe('parseSituationLine', () => {
  it('parses a plain line at level 0', () => {
    expect(parseSituationLine('Hello world.')).toEqual({
      level: 0,
      text: 'Hello world.',
      strikethrough: false,
      editedByAi: false,
    });
  });

  it('parses 2-space indentation as level 1', () => {
    expect(parseSituationLine('  Sub item.')).toEqual({
      level: 1,
      text: 'Sub item.',
      strikethrough: false,
      editedByAi: false,
    });
  });

  it('parses 4-space indentation as level 2', () => {
    expect(parseSituationLine('    Sub-sub.')).toEqual({
      level: 2,
      text: 'Sub-sub.',
      strikethrough: false,
      editedByAi: false,
    });
  });

  it('caps the level at 3 (max bullet style)', () => {
    expect(parseSituationLine('          Deeply nested.').level).toBe(3);
  });

  it('detects the `[!]` AI-edited marker and strips it from text', () => {
    expect(parseSituationLine('[!] Edited by AI.')).toEqual({
      level: 0,
      text: 'Edited by AI.',
      strikethrough: false,
      editedByAi: true,
    });
  });

  it('detects `[!]` with leading indentation', () => {
    const out = parseSituationLine('  [!] Indented + AI-edited.');
    expect(out.level).toBe(1);
    expect(out.text).toBe('Indented + AI-edited.');
    expect(out.editedByAi).toBe(true);
  });

  it('detects `[!]` immediately followed by `~~` (closure shape)', () => {
    const out = parseSituationLine('  [!]~~Closed point.~~');
    expect(out.level).toBe(1);
    expect(out.text).toBe('Closed point.');
    expect(out.strikethrough).toBe(true);
    expect(out.editedByAi).toBe(true);
  });

  it('detects `~~…~~` strikethrough without `[!]`', () => {
    expect(parseSituationLine('~~Done.~~')).toEqual({
      level: 0,
      text: 'Done.',
      strikethrough: true,
      editedByAi: false,
    });
  });

  it('does NOT flag editedByAi on a line that merely contains `[!]` in the middle', () => {
    const out = parseSituationLine('This contains [!] in the middle.');
    expect(out.editedByAi).toBe(false);
    expect(out.text).toBe('This contains [!] in the middle.');
  });

  it('handles an empty line gracefully', () => {
    expect(parseSituationLine('')).toEqual({
      level: 0,
      text: '',
      strikethrough: false,
      editedByAi: false,
    });
  });
});
