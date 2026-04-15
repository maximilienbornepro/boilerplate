import { describe, it, expect } from 'vitest';
import {
  parseJiraKey,
  extractJiraContext,
  computeTodayCol,
  categorizeVersions,
  categoryOf,
  widthFromEstimation,
} from '../../delivery/deliveryAISanityService';

describe('Delivery — AI Sanity Check helpers', () => {
  describe('parseJiraKey', () => {
    it('extracts the key from a "[KEY-123] Summary" title', () => {
      expect(parseJiraKey('[DEV-42] Fix login bug')).toBe('DEV-42');
    });

    it('returns null when the title does not start with a key', () => {
      expect(parseJiraKey('Untracked manual task')).toBeNull();
    });

    it('handles underscore-containing project keys', () => {
      expect(parseJiraKey('[MY_PROJ-7] Something')).toBe('MY_PROJ-7');
    });

    it('returns null for malformed keys', () => {
      expect(parseJiraKey('[dev-42] lowercase')).toBeNull();
      expect(parseJiraKey('[DEV42] missing dash')).toBeNull();
    });
  });

  describe('extractJiraContext', () => {
    it('collects unique project keys and sprint names from jira-sourced tasks', () => {
      const tasks = [
        { title: '[DEV-1] A', sprintName: 'Sprint 1', source: 'jira' },
        { title: '[DEV-2] B', sprintName: 'Sprint 1', source: 'jira' },
        { title: '[OPS-9] C', sprintName: 'Sprint 2', source: 'jira' },
        { title: 'Manual task', sprintName: null, source: 'manual' },
      ];
      const ctx = extractJiraContext(tasks);
      expect(ctx.projectKeys.sort()).toEqual(['DEV', 'OPS']);
      expect(ctx.sprintNames.sort()).toEqual(['Sprint 1', 'Sprint 2']);
    });

    it('ignores manual tasks', () => {
      const tasks = [
        { title: '[MAN-1] fake', sprintName: 'X', source: 'manual' },
      ];
      const ctx = extractJiraContext(tasks);
      expect(ctx.projectKeys).toEqual([]);
      expect(ctx.sprintNames).toEqual([]);
    });

    it('returns empty lists when no tasks', () => {
      expect(extractJiraContext([])).toEqual({ projectKeys: [], sprintNames: [] });
    });
  });

  describe('computeTodayCol', () => {
    it('returns -1 when dates are missing', () => {
      expect(computeTodayCol(null, null, 6)).toBe(-1);
      expect(computeTodayCol('2026-01-01', null, 6)).toBe(-1);
    });

    it('returns -1 when today is outside the timeframe', () => {
      expect(computeTodayCol('2026-01-01', '2026-01-15', 6, new Date('2026-02-01'))).toBe(-1);
      expect(computeTodayCol('2026-03-01', '2026-04-01', 6, new Date('2026-01-15'))).toBe(-1);
    });

    it('returns 0 on the start day of the board', () => {
      expect(computeTodayCol('2026-01-01', '2026-01-14', 7, new Date('2026-01-01'))).toBe(0);
    });

    it('returns the last column on the end day', () => {
      // 7 cols indexed 0..6, last = 6
      expect(computeTodayCol('2026-01-01', '2026-01-07', 7, new Date('2026-01-07'))).toBe(6);
    });

    it('returns a proportional column for mid-period', () => {
      // Start Jan 1, end Jan 11 (10 days). Jan 6 ≈ 50% → col = round(0.5 * 5) = 3
      const col = computeTodayCol('2026-01-01', '2026-01-11', 6, new Date('2026-01-06'));
      expect(col).toBeGreaterThanOrEqual(2);
      expect(col).toBeLessThanOrEqual(3);
    });

    it('returns -1 for inverted date range', () => {
      expect(computeTodayCol('2026-02-01', '2026-01-01', 6, new Date('2026-01-15'))).toBe(-1);
    });
  });

  describe('categorizeVersions', () => {
    const FIXED_TODAY = new Date('2026-06-15T00:00:00Z');

    it('returns an empty list when given no versions', () => {
      expect(categorizeVersions([], FIXED_TODAY)).toEqual([]);
    });

    it('classifies the earliest future version as "next" and the rest as "later"', () => {
      const result = categorizeVersions([
        { name: 'v2.4', releaseDate: '2026-05-01' },
        { name: 'v2.5', releaseDate: '2026-07-01' },
        { name: 'v2.6', releaseDate: '2026-09-01' },
      ], FIXED_TODAY);
      expect(result).toEqual([
        { name: 'v2.4', releaseDate: '2026-05-01', category: 'past' },
        { name: 'v2.5', releaseDate: '2026-07-01', category: 'next' },
        { name: 'v2.6', releaseDate: '2026-09-01', category: 'later' },
      ]);
    });

    it('marks versions with no release date as "none"', () => {
      const result = categorizeVersions([
        { name: 'backlog', releaseDate: null },
      ], FIXED_TODAY);
      expect(result).toEqual([
        { name: 'backlog', releaseDate: null, category: 'none' },
      ]);
    });

    it('handles duplicate names gracefully (dedup happens upstream; here we take first)', () => {
      const result = categorizeVersions([
        { name: 'v2.5', releaseDate: '2026-07-01' },
        { name: 'v2.5', releaseDate: '2026-07-01' },
      ], FIXED_TODAY);
      expect(result).toHaveLength(2); // categorize does not dedup
    });
  });

  describe('categoryOf', () => {
    const versions = [
      { name: 'v2.4', releaseDate: '2026-05-01', category: 'past' as const },
      { name: 'v2.5', releaseDate: '2026-07-01', category: 'next' as const },
    ];

    it('returns "none" for null', () => {
      expect(categoryOf(null, versions)).toBe('none');
    });

    it('returns the category of a known version', () => {
      expect(categoryOf('v2.5', versions)).toBe('next');
      expect(categoryOf('v2.4', versions)).toBe('past');
    });

    it('returns "none" for an unknown version', () => {
      expect(categoryOf('v9.9', versions)).toBe('none');
    });
  });

  describe('widthFromEstimation', () => {
    it('returns null when no estimation nor story points are provided', () => {
      expect(widthFromEstimation(null, null)).toBeNull();
      expect(widthFromEstimation(undefined, undefined)).toBeNull();
      expect(widthFromEstimation(0, 0)).toBeNull();
    });

    it('rounds 0.5 → 5 days up to 1 column', () => {
      expect(widthFromEstimation(0.5, null)).toBe(1);
      expect(widthFromEstimation(3, null)).toBe(1);
      expect(widthFromEstimation(5, null)).toBe(1);
    });

    it('rounds 5.1 → 10 days up to 2 columns', () => {
      expect(widthFromEstimation(5.1, null)).toBe(2);
      expect(widthFromEstimation(7, null)).toBe(2);
      expect(widthFromEstimation(10, null)).toBe(2);
    });

    it('rounds 10.1 → 15 days up to 3 columns', () => {
      expect(widthFromEstimation(10.1, null)).toBe(3);
      expect(widthFromEstimation(12, null)).toBe(3);
      expect(widthFromEstimation(15, null)).toBe(3);
    });

    it('falls back to story points when estimatedDays is missing', () => {
      expect(widthFromEstimation(null, 4)).toBe(1);
      expect(widthFromEstimation(null, 6)).toBe(2);
    });

    it('prefers estimatedDays when both are provided', () => {
      expect(widthFromEstimation(8, 3)).toBe(2);
    });

    it('never returns less than 1', () => {
      expect(widthFromEstimation(0.1, null)).toBe(1);
    });
  });

  describe('Route payload validation — apply', () => {
    // Contract tests for the shape we expect the apply route body to enforce.
    // (Keeping as pure logic tests — no DB.)

    interface Move { taskId: string; startCol: number; endCol: number; row: number }
    function validateMoves(moves: unknown, validTaskIds: Set<string>): { ok: boolean; reason?: string; sanitized?: Move[] } {
      if (!Array.isArray(moves) || moves.length === 0) return { ok: false, reason: 'empty' };
      const sanitized: Move[] = [];
      for (const m of moves as Record<string, unknown>[]) {
        const taskId = String(m.taskId || '');
        if (!validTaskIds.has(taskId)) return { ok: false, reason: `unknown:${taskId}` };
        sanitized.push({
          taskId,
          startCol: Math.max(0, Math.floor(Number(m.startCol))),
          endCol:   Math.max(1, Math.floor(Number(m.endCol))),
          row:      Math.max(0, Math.floor(Number(m.row))),
        });
      }
      return { ok: true, sanitized };
    }

    it('rejects empty array', () => {
      expect(validateMoves([], new Set()).ok).toBe(false);
    });

    it('rejects moves that reference unknown tasks', () => {
      expect(validateMoves([{ taskId: 'ghost', startCol: 0, endCol: 1, row: 0 }], new Set(['real'])).ok).toBe(false);
    });

    it('clamps negative / non-integer values', () => {
      const result = validateMoves(
        [{ taskId: 't1', startCol: -3, endCol: 2.8, row: 0.4 }],
        new Set(['t1']),
      );
      expect(result.ok).toBe(true);
      expect(result.sanitized).toEqual([{ taskId: 't1', startCol: 0, endCol: 2, row: 0 }]);
    });
  });
});
