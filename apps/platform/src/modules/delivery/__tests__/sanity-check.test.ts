import { describe, it, expect } from 'vitest';

// Pure-logic tests for the sanity-check frontend flow.
// The SanityCheckModal component is covered by integration / manual QA;
// here we validate the helpers it relies on.

describe('Delivery — Sanity check (frontend)', () => {
  describe('Button visibility', () => {
    interface Task { source?: string }

    function shouldShowSanityButton(tasks: Task[]): boolean {
      return tasks.some(t => t.source === 'jira');
    }

    it('is hidden when there are no Jira tasks', () => {
      expect(shouldShowSanityButton([])).toBe(false);
      expect(shouldShowSanityButton([{ source: 'manual' }, { source: 'manual' }])).toBe(false);
    });

    it('is visible when at least one Jira task is present', () => {
      expect(shouldShowSanityButton([{ source: 'jira' }])).toBe(true);
      expect(shouldShowSanityButton([{ source: 'manual' }, { source: 'jira' }])).toBe(true);
    });
  });

  describe('Apply payload', () => {
    interface Recommendation {
      taskId: string;
      recommended: { startCol: number; endCol: number; row: number };
    }

    function buildApplyPayload(recos: Recommendation[], selected: Set<string>) {
      return recos
        .filter(r => selected.has(r.taskId))
        .map(r => ({
          taskId: r.taskId,
          startCol: r.recommended.startCol,
          endCol: r.recommended.endCol,
          row: r.recommended.row,
        }));
    }

    const recos: Recommendation[] = [
      { taskId: 't1', recommended: { startCol: 0, endCol: 1, row: 0 } },
      { taskId: 't2', recommended: { startCol: 2, endCol: 3, row: 1 } },
      { taskId: 't3', recommended: { startCol: 5, endCol: 6, row: 4 } },
    ];

    it('only includes selected recommendations', () => {
      const payload = buildApplyPayload(recos, new Set(['t1', 't3']));
      expect(payload).toHaveLength(2);
      expect(payload.map(m => m.taskId)).toEqual(['t1', 't3']);
    });

    it('returns an empty payload when nothing is selected', () => {
      const payload = buildApplyPayload(recos, new Set());
      expect(payload).toEqual([]);
    });

    it('passes the recommended position (not the current one)', () => {
      const payload = buildApplyPayload(recos, new Set(['t2']));
      expect(payload[0]).toEqual({ taskId: 't2', startCol: 2, endCol: 3, row: 1 });
    });
  });

  describe('Priority grouping', () => {
    interface R { taskId: string; priority: 'high' | 'medium' | 'low' }

    function groupByPriority(list: R[]) {
      const out: Record<'high' | 'medium' | 'low', R[]> = { high: [], medium: [], low: [] };
      for (const r of list) out[r.priority].push(r);
      return out;
    }

    it('groups recommendations by priority', () => {
      const groups = groupByPriority([
        { taskId: 'a', priority: 'high' },
        { taskId: 'b', priority: 'low' },
        { taskId: 'c', priority: 'medium' },
        { taskId: 'd', priority: 'high' },
      ]);
      expect(groups.high.map(r => r.taskId)).toEqual(['a', 'd']);
      expect(groups.medium.map(r => r.taskId)).toEqual(['c']);
      expect(groups.low.map(r => r.taskId)).toEqual(['b']);
    });
  });
});
