import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { parseOutlookDate } from '../../suivitess/outlookCollectorService.js';

// Lock the clock so "Hier" / "Aujourd'hui" / bare-time tests are
// deterministic regardless of when the suite runs.
const FROZEN_NOW = new Date('2026-04-29T10:00:00.000Z');

describe('suivitess · parseOutlookDate', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterAll(() => { vi.useRealTimers(); });

  it('parses the full title format "Lun 13/04/2026 12:26"', () => {
    const d = parseOutlookDate('Lun 13/04/2026 12:26');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(3);   // April
    expect(d!.getDate()).toBe(13);
    expect(d!.getHours()).toBe(12);
    expect(d!.getMinutes()).toBe(26);
  });

  it('parses ISO 8601 timestamps natively', () => {
    const d = parseOutlookDate('2026-04-28T14:30:00Z');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-28T14:30:00.000Z');
  });

  it('"Hier 14:30" is yesterday at 14:30 (not today as before)', () => {
    const d = parseOutlookDate('Hier 14:30');
    expect(d).not.toBeNull();
    // Frozen now = 29 April. Hier = 28 April.
    expect(d!.toISOString().slice(0, 10)).toBe('2026-04-28');
    expect(d!.getHours()).toBe(14);
    expect(d!.getMinutes()).toBe(30);
  });

  it('"Hier" alone falls back to yesterday at 00:00', () => {
    const d = parseOutlookDate('Hier');
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe('2026-04-28');
  });

  it('"Aujourd\'hui 09:12" is today at 09:12', () => {
    const d = parseOutlookDate("Aujourd'hui 09:12");
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe('2026-04-29');
    expect(d!.getHours()).toBe(9);
    expect(d!.getMinutes()).toBe(12);
  });

  it('bare "14:30" is today at 14:30 (not Date(now) at random hours)', () => {
    const d = parseOutlookDate('14:30');
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe('2026-04-29');
    expect(d!.getHours()).toBe(14);
    expect(d!.getMinutes()).toBe(30);
  });

  it('returns null on empty/undefined input', () => {
    expect(parseOutlookDate('')).toBeNull();
  });

  it('falls back to Date(now) on garbage input rather than dropping the row', () => {
    const d = parseOutlookDate('not-a-date');
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe('2026-04-29');
  });
});
