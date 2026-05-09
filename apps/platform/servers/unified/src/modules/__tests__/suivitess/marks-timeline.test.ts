import { describe, it, expect } from 'vitest';
import {
  buildMarksTimeline,
  fmtOffset,
  renderMarksGroundTruth,
  type RawMarkInput,
  type CallWindow,
} from '../../suivitess/marksTimeline.js';

// Pure helpers — no DB, no AI, no network. The timeline is the
// math glue between server-stamped clicks and a Fathom call window.

const callStart = '2026-05-07T14:00:00Z';
const callDuration = 30 * 60; // 30 min

function callAt(start: string, durationSeconds = callDuration): CallWindow {
  return { recordedAt: new Date(start), durationSeconds };
}

describe('suivitess — buildMarksTimeline', () => {
  it('returns empty when no marks fed (the typical "no-marks" path)', () => {
    expect(buildMarksTimeline([], callAt(callStart))).toEqual([]);
  });

  it('builds a single segment that runs to end-of-call when only one mark exists', () => {
    const marks: RawMarkInput[] = [
      { clickedAt: '2026-05-07T14:05:00Z', subjectId: 'sub-A', subjectTitle: 'Refonte login' },
    ];
    const t = buildMarksTimeline(marks, callAt(callStart));
    expect(t).toEqual([
      {
        fromSeconds: 5 * 60,
        toSeconds: 30 * 60,
        subjectId: 'sub-A',
        subjectTitle: 'Refonte login',
      },
    ]);
  });

  it('closes a segment at the next mark', () => {
    const marks: RawMarkInput[] = [
      { clickedAt: '2026-05-07T14:05:00Z', subjectId: 'sub-A', subjectTitle: 'A' },
      { clickedAt: '2026-05-07T14:12:30Z', subjectId: 'sub-B', subjectTitle: 'B' },
    ];
    const t = buildMarksTimeline(marks, callAt(callStart));
    expect(t).toEqual([
      { fromSeconds: 300, toSeconds: 750, subjectId: 'sub-A', subjectTitle: 'A' },
      { fromSeconds: 750, toSeconds: 1800, subjectId: 'sub-B', subjectTitle: 'B' },
    ]);
  });

  it('emits no segment for a "stop" mark and uses it to close the previous one', () => {
    const marks: RawMarkInput[] = [
      { clickedAt: '2026-05-07T14:05:00Z', subjectId: 'sub-A', subjectTitle: 'A' },
      { clickedAt: '2026-05-07T14:10:00Z', subjectId: null,    subjectTitle: null },
      { clickedAt: '2026-05-07T14:15:00Z', subjectId: 'sub-B', subjectTitle: 'B' },
    ];
    const t = buildMarksTimeline(marks, callAt(callStart));
    expect(t).toEqual([
      { fromSeconds: 300, toSeconds: 600, subjectId: 'sub-A', subjectTitle: 'A' },
      { fromSeconds: 900, toSeconds: 1800, subjectId: 'sub-B', subjectTitle: 'B' },
    ]);
  });

  it('drops marks that fall outside the call window', () => {
    const marks: RawMarkInput[] = [
      // Before the call started
      { clickedAt: '2026-05-07T13:55:00Z', subjectId: 'sub-X', subjectTitle: 'too early' },
      // Inside the window
      { clickedAt: '2026-05-07T14:10:00Z', subjectId: 'sub-A', subjectTitle: 'A' },
      // After the call ended
      { clickedAt: '2026-05-07T14:35:00Z', subjectId: 'sub-Y', subjectTitle: 'too late' },
    ];
    const t = buildMarksTimeline(marks, callAt(callStart));
    expect(t).toEqual([
      { fromSeconds: 600, toSeconds: 1800, subjectId: 'sub-A', subjectTitle: 'A' },
    ]);
  });

  it('sorts marks ASC even when fed out-of-order', () => {
    const marks: RawMarkInput[] = [
      { clickedAt: '2026-05-07T14:12:30Z', subjectId: 'sub-B', subjectTitle: 'B' },
      { clickedAt: '2026-05-07T14:05:00Z', subjectId: 'sub-A', subjectTitle: 'A' },
    ];
    const t = buildMarksTimeline(marks, callAt(callStart));
    expect(t.map(s => s.subjectId)).toEqual(['sub-A', 'sub-B']);
  });

  it('skips zero-length segments (two clicks at the exact same instant)', () => {
    const marks: RawMarkInput[] = [
      { clickedAt: '2026-05-07T14:05:00Z', subjectId: 'sub-A', subjectTitle: 'A' },
      { clickedAt: '2026-05-07T14:05:00Z', subjectId: 'sub-B', subjectTitle: 'B' },
    ];
    const t = buildMarksTimeline(marks, callAt(callStart));
    expect(t).toEqual([
      { fromSeconds: 300, toSeconds: 1800, subjectId: 'sub-B', subjectTitle: 'B' },
    ]);
  });

  it('handles the "user only marked the last 5 minutes" case (pre-mark portion stays free)', () => {
    const marks: RawMarkInput[] = [
      { clickedAt: '2026-05-07T14:25:00Z', subjectId: 'sub-A', subjectTitle: 'A' },
    ];
    const t = buildMarksTimeline(marks, callAt(callStart));
    // Only 25min..30min is covered ; the prior 25 minutes get
    // standard free extraction (no segment emitted for them).
    expect(t).toEqual([
      { fromSeconds: 1500, toSeconds: 1800, subjectId: 'sub-A', subjectTitle: 'A' },
    ]);
  });

  it('preserves a null subjectTitle (subject deleted post-click) without crashing', () => {
    const marks: RawMarkInput[] = [
      { clickedAt: '2026-05-07T14:05:00Z', subjectId: 'sub-A', subjectTitle: null },
    ];
    const t = buildMarksTimeline(marks, callAt(callStart));
    expect(t[0].subjectTitle).toBeNull();
  });
});

describe('suivitess — fmtOffset', () => {
  it('formats sub-hour as MM:SS', () => {
    expect(fmtOffset(0)).toBe('00:00');
    expect(fmtOffset(5)).toBe('00:05');
    expect(fmtOffset(60)).toBe('01:00');
    expect(fmtOffset(330)).toBe('05:30');
    expect(fmtOffset(3599)).toBe('59:59');
  });
  it('formats hours as HH:MM:SS', () => {
    expect(fmtOffset(3600)).toBe('01:00:00');
    expect(fmtOffset(3661)).toBe('01:01:01');
  });
  it('clamps negative input to 0', () => {
    expect(fmtOffset(-10)).toBe('00:00');
  });
});

describe('suivitess — renderMarksGroundTruth', () => {
  it('returns empty string when no segments (so the prompt simply omits the section)', () => {
    expect(renderMarksGroundTruth([])).toBe('');
  });

  it('renders a markdown block with the right shape when segments exist', () => {
    const block = renderMarksGroundTruth([
      { fromSeconds: 0,    toSeconds: 405,  subjectId: 'sub-A', subjectTitle: 'Refonte login' },
      { fromSeconds: 405,  toSeconds: 720,  subjectId: 'sub-B', subjectTitle: 'Migration PG' },
    ]);
    expect(block).toContain('## Marqueurs utilisateur (ground truth, optionnels)');
    expect(block).toContain('00:00 → 06:45 : sujet « Refonte login » (id: sub-A)');
    expect(block).toContain('06:45 → 12:00 : sujet « Migration PG » (id: sub-B)');
    expect(block).toContain('mappedToExistingSubjectId');
  });

  it('falls back gracefully when subjectTitle is null (deleted subject)', () => {
    const block = renderMarksGroundTruth([
      { fromSeconds: 60, toSeconds: 120, subjectId: 'sub-X', subjectTitle: null },
    ]);
    expect(block).toContain('(titre indisponible)');
  });
});
