import { describe, it, expect } from 'vitest';
import {
  deriveOverlayTasks,
  extractSprintNumber,
  MIN_TASK_DURATION_DAYS,
  type RawDeliveryTask,
  type BoardConfigForOverlay,
} from '../../roadmap/deliveryOverlay';

function daysBetween(a: string, b: string): number {
  const pa = new Date(a + 'T00:00:00Z').getTime();
  const pb = new Date(b + 'T00:00:00Z').getTime();
  return (pb - pa) / (24 * 60 * 60 * 1000);
}

const AGILE_CONFIG: BoardConfigForOverlay = {
  boardType: 'agile',
  startDate: '2026-04-06',
  endDate: '2026-06-01',
  durationWeeks: 8,
};

const CALENDAIRE_CONFIG: BoardConfigForOverlay = {
  boardType: 'calendaire',
  startDate: '2026-04-01',
  endDate: '2026-04-30',
  durationWeeks: 4,
};

function makeTask(overrides: Partial<RawDeliveryTask>): RawDeliveryTask {
  return {
    id: 'task-1',
    title: 'Task',
    type: 'feature',
    status: 'todo',
    source: 'jira',
    incrementId: 'board_s1',
    parentTaskId: null,
    startCol: null,
    endCol: null,
    ...overrides,
  };
}

describe('extractSprintNumber', () => {
  it('extracts from new _s format', () => {
    expect(extractSprintNumber('boardAbc_s1')).toBe(1);
    expect(extractSprintNumber('boardAbc_s4')).toBe(4);
  });

  it('extracts from legacy _inc format', () => {
    expect(extractSprintNumber('board_inc3')).toBe(3);
  });

  it('returns null for malformed ids', () => {
    expect(extractSprintNumber('')).toBeNull();
    expect(extractSprintNumber(null)).toBeNull();
    expect(extractSprintNumber(undefined)).toBeNull();
    expect(extractSprintNumber('no-suffix')).toBeNull();
  });
});

describe('deriveOverlayTasks — board-config-based derivation', () => {
  describe('guards', () => {
    it('returns empty array when no tasks are provided', () => {
      expect(deriveOverlayTasks({ rawTasks: [], boardConfig: AGILE_CONFIG })).toEqual([]);
    });

    it('drops tasks with missing sprint id', () => {
      const result = deriveOverlayTasks({
        rawTasks: [makeTask({ incrementId: '' })],
        boardConfig: AGILE_CONFIG,
      });
      expect(result).toEqual([]);
    });
  });

  describe('agile mode — column → calendar mapping', () => {
    it('maps a task with global column position to calendar dates', () => {
      // Board starts 2026-04-06. 1 col = 1 week = 7 days.
      // Task at startCol=0, endCol=2 → 2026-04-06 to 2026-04-20 (14 days).
      const result = deriveOverlayTasks({
        rawTasks: [makeTask({ startCol: 0, endCol: 2 })],
        boardConfig: AGILE_CONFIG,
      });

      expect(result).toHaveLength(1);
      expect(result[0].startDate).toBe('2026-04-06');
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(14);
    });

    it('shifts a task starting at column 4 by 28 days', () => {
      const result = deriveOverlayTasks({
        rawTasks: [makeTask({ startCol: 4, endCol: 6, incrementId: 'board_s3' })],
        boardConfig: AGILE_CONFIG,
      });

      expect(result[0].startDate).toBe('2026-05-04'); // 2026-04-06 + 28 days
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(14);
    });
  });

  describe('calendaire mode', () => {
    it('places a task in sprint 1 (week 1-7) using the sprint date range', () => {
      const result = deriveOverlayTasks({
        rawTasks: [makeTask({ incrementId: 'board_s1', startCol: null, endCol: null })],
        boardConfig: CALENDAIRE_CONFIG,
      });

      // No position → covers the full sprint = week 1 (Apr 1-7) + 1 day = 8 days.
      expect(result[0].startDate).toBe('2026-04-01');
      // Minimum 7 days clamp may apply
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBeGreaterThanOrEqual(MIN_TASK_DURATION_DAYS);
    });
  });

  describe('7-day minimum clamp', () => {
    it('clamps a very short derived range to 7 days', () => {
      // 1 column at the start = 7 days — exactly MIN_TASK_DURATION_DAYS, so no clamp
      const result = deriveOverlayTasks({
        rawTasks: [makeTask({ startCol: 0, endCol: 1 })],
        boardConfig: AGILE_CONFIG,
      });
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(MIN_TASK_DURATION_DAYS);
    });
  });

  describe('task metadata is preserved', () => {
    it('passes through id, title, type, status, source, parentTaskId', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({
            id: 'abc-123',
            title: 'Implement login',
            type: 'bug',
            status: 'in_progress',
            source: 'manual',
            parentTaskId: 'container-xyz',
          }),
        ],
        boardConfig: AGILE_CONFIG,
      });

      expect(result[0]).toMatchObject({
        id: 'abc-123',
        title: 'Implement login',
        type: 'bug',
        status: 'in_progress',
        source: 'manual',
        parentTaskId: 'container-xyz',
      });
    });
  });

  describe('legacy _inc format', () => {
    it('supports legacy _inc sprint IDs via dual-format parsing', () => {
      const result = deriveOverlayTasks({
        rawTasks: [makeTask({ incrementId: 'board_inc2', startCol: 2, endCol: 4 })],
        boardConfig: AGILE_CONFIG,
      });

      // Sprint 2 is resolved, task positioned globally (startCol=2 → 14 days offset)
      expect(result).toHaveLength(1);
      expect(result[0].startDate).toBe('2026-04-20'); // 2026-04-06 + 14 days
    });
  });
});
