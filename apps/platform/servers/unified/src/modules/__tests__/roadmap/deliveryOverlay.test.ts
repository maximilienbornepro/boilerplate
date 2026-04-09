import { describe, it, expect } from 'vitest';
import {
  deriveOverlayTasks,
  MIN_TASK_DURATION_DAYS,
  type RawDeliveryTask,
} from '../../roadmap/deliveryOverlay';

function daysBetween(a: string, b: string): number {
  const pa = new Date(a + 'T00:00:00Z').getTime();
  const pb = new Date(b + 'T00:00:00Z').getTime();
  return (pb - pa) / (24 * 60 * 60 * 1000);
}

function makeTask(overrides: Partial<RawDeliveryTask>): RawDeliveryTask {
  return {
    id: 'task-1',
    title: 'Task',
    type: 'feature',
    status: 'todo',
    source: 'jira',
    incrementId: 'board_inc1',
    startCol: null,
    endCol: null,
    ...overrides,
  };
}

describe('deriveOverlayTasks — delivery overlay date derivation', () => {
  describe('guards', () => {
    it('returns empty array when planning duration is zero', () => {
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-04-01',
        rawTasks: [makeTask({})],
      });
      expect(result).toEqual([]);
    });

    it('returns empty array when planning duration is negative', () => {
      const result = deriveOverlayTasks({
        planningStart: '2026-04-10',
        planningEnd: '2026-04-01',
        rawTasks: [makeTask({})],
      });
      expect(result).toEqual([]);
    });

    it('returns empty array when no tasks are provided', () => {
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-07-01',
        rawTasks: [],
      });
      expect(result).toEqual([]);
    });

    it('returns empty array when tasks have no incrementId', () => {
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-07-01',
        rawTasks: [makeTask({ incrementId: '' })],
      });
      expect(result).toEqual([]);
    });
  });

  describe('equal-split increments', () => {
    it('splits a 28-day planning into 2 × 14-day increments', () => {
      const tasks = [
        makeTask({ id: 't1', incrementId: 'b_inc1', startCol: null, endCol: null }),
        makeTask({ id: 't2', incrementId: 'b_inc2', startCol: null, endCol: null }),
      ];
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-04-29', // 28 days
        rawTasks: tasks,
      });

      expect(result).toHaveLength(2);

      const t1 = result.find(t => t.id === 't1')!;
      const t2 = result.find(t => t.id === 't2')!;

      expect(t1.startDate).toBe('2026-04-01');
      expect(t1.endDate).toBe('2026-04-15'); // inc1: start..start+14
      expect(t2.startDate).toBe('2026-04-15');
      expect(t2.endDate).toBe('2026-04-29');
    });

    it('orders increments with natural sort (inc2 before inc10)', () => {
      // Deliberately unsorted input
      const tasks = [
        makeTask({ id: 't10', incrementId: 'b_inc10' }),
        makeTask({ id: 't2', incrementId: 'b_inc2' }),
        makeTask({ id: 't1', incrementId: 'b_inc1' }),
      ];
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-04-04', // 3 days — will clamp but increment ordering still matters
        rawTasks: tasks,
      });

      // Find the increment order by looking at which task has the earliest start.
      const t1 = result.find(t => t.id === 't1')!;
      const t2 = result.find(t => t.id === 't2')!;
      const t10 = result.find(t => t.id === 't10')!;

      // t1 (inc1) should start first, then t2 (inc2), then t10 (inc10).
      expect(t1.startDate <= t2.startDate).toBe(true);
      expect(t2.startDate <= t10.startDate).toBe(true);
    });
  });

  describe('proportional grid mapping', () => {
    it('maps start_col/end_col proportionally within an increment', () => {
      const tasks = [
        // Task spans cols 0..10 — full increment width → full 30 days
        makeTask({ id: 'full', startCol: 0, endCol: 10 }),
        // Task spans cols 0..5 — first half → 15 days (above the 7-day floor)
        makeTask({ id: 'half', startCol: 0, endCol: 5 }),
      ];
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-05-01', // 30 days, 1 increment → 30-day increment
        rawTasks: tasks,
      });

      const full = result.find(t => t.id === 'full')!;
      const half = result.find(t => t.id === 'half')!;

      // "full" covers the whole 30-day increment
      expect(daysBetween(full.startDate, full.endDate)).toBe(30);

      // "half" covers exactly the first 15 days (above 7-day clamp)
      expect(daysBetween(half.startDate, half.endDate)).toBe(15);
      expect(half.startDate).toBe(full.startDate);
    });

    it('clamps a too-short derived range to the 7-day minimum', () => {
      const tasks = [
        // Increment is long, task spans just 1 col out of 10 = 10% of 30d = 3 days → clamped to 7
        makeTask({ id: 'tiny', startCol: 0, endCol: 1 }),
        // Defines the max col for the increment
        makeTask({ id: 'big', startCol: 0, endCol: 10 }),
      ];
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-05-01', // 30 days, 1 increment
        rawTasks: tasks,
      });

      const tiny = result.find(t => t.id === 'tiny')!;
      expect(daysBetween(tiny.startDate, tiny.endDate)).toBe(MIN_TASK_DURATION_DAYS);
    });
  });

  describe('tasks without grid position', () => {
    it('covers the full increment when no position is set', () => {
      const tasks = [
        makeTask({ id: 'unpositioned', startCol: null, endCol: null }),
      ];
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-05-01', // 30 days, 1 increment
        rawTasks: tasks,
      });

      const t = result[0];
      expect(t.startDate).toBe('2026-04-01');
      expect(t.endDate).toBe('2026-05-01');
    });

    it('still applies the 7-day minimum for unpositioned tasks in a short increment', () => {
      const tasks = [
        makeTask({ id: 'unpositioned', startCol: null, endCol: null }),
      ];
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-04-03', // 2 days, 1 increment → clamp kicks in
        rawTasks: tasks,
      });

      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(MIN_TASK_DURATION_DAYS);
    });
  });

  describe('task metadata is preserved', () => {
    it('passes through id, title, type, status, source, incrementId', () => {
      const result = deriveOverlayTasks({
        planningStart: '2026-04-01',
        planningEnd: '2026-05-01',
        rawTasks: [
          makeTask({
            id: 'abc-123',
            title: 'Implement login',
            type: 'bug',
            status: 'in_progress',
            source: 'manual',
            incrementId: 'board_inc1',
            startCol: null,
            endCol: null,
          }),
        ],
      });

      expect(result[0]).toMatchObject({
        id: 'abc-123',
        title: 'Implement login',
        type: 'bug',
        status: 'in_progress',
        source: 'manual',
        incrementId: 'board_inc1',
      });
    });
  });
});
