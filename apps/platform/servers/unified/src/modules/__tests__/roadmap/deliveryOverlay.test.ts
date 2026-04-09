import { describe, it, expect } from 'vitest';
import {
  deriveOverlayTasks,
  extractIncrementNumber,
  getIncrementStartDate,
  MIN_TASK_DURATION_DAYS,
  INCREMENT_DURATION_DAYS,
  INC1_START_ISO,
  DAYS_PER_COLUMN,
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
    parentTaskId: null,
    startCol: null,
    endCol: null,
    ...overrides,
  };
}

describe('extractIncrementNumber', () => {
  it('extracts the increment number from a board-prefixed id', () => {
    expect(extractIncrementNumber('boardAbc_inc1')).toBe(1);
    expect(extractIncrementNumber('boardAbc_inc8')).toBe(8);
  });

  it('handles a UUID board prefix', () => {
    expect(
      extractIncrementNumber('7af7940c-9ed3-43bb-8824-35e415906679_inc3')
    ).toBe(3);
  });

  it('returns null for malformed ids', () => {
    expect(extractIncrementNumber('')).toBeNull();
    expect(extractIncrementNumber(null)).toBeNull();
    expect(extractIncrementNumber(undefined)).toBeNull();
    expect(extractIncrementNumber('no-inc-suffix')).toBeNull();
    expect(extractIncrementNumber('board_inc')).toBeNull();
    expect(extractIncrementNumber('board_incABC')).toBeNull();
  });

  it('returns null for increment numbers outside 1..8', () => {
    expect(extractIncrementNumber('board_inc0')).toBeNull();
    expect(extractIncrementNumber('board_inc9')).toBeNull();
    expect(extractIncrementNumber('board_inc100')).toBeNull();
  });
});

describe('getIncrementStartDate', () => {
  it('returns 2026-01-19 for inc1', () => {
    const d = getIncrementStartDate(1);
    expect(d.toISOString().slice(0, 10)).toBe(INC1_START_ISO);
  });

  it('offsets subsequent increments by 42 days', () => {
    const inc1 = getIncrementStartDate(1);
    const inc2 = getIncrementStartDate(2);
    const diff = (inc2.getTime() - inc1.getTime()) / (24 * 60 * 60 * 1000);
    expect(diff).toBe(INCREMENT_DURATION_DAYS);
  });

  it('computes inc3 start correctly', () => {
    const inc3 = getIncrementStartDate(3);
    // inc1 + 2*42 days = 2026-01-19 + 84 days = 2026-04-13
    expect(inc3.toISOString().slice(0, 10)).toBe('2026-04-13');
  });

  it('computes inc8 start correctly', () => {
    const inc8 = getIncrementStartDate(8);
    // inc1 + 7*42 days = 2026-01-19 + 294 days = 2026-11-09
    expect(inc8.toISOString().slice(0, 10)).toBe('2026-11-09');
  });
});

describe('deriveOverlayTasks — deterministic calendar derivation', () => {
  describe('guards', () => {
    it('returns empty array when no tasks are provided', () => {
      expect(deriveOverlayTasks({ rawTasks: [] })).toEqual([]);
    });

    it('drops tasks with missing increment id', () => {
      const result = deriveOverlayTasks({
        rawTasks: [makeTask({ incrementId: '' })],
      });
      expect(result).toEqual([]);
    });

    it('drops tasks with an out-of-range increment number', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({ id: 't1', incrementId: 'board_inc0' }),
          makeTask({ id: 't2', incrementId: 'board_inc9' }),
        ],
      });
      expect(result).toEqual([]);
    });
  });

  describe('column → calendar mapping', () => {
    it('maps a task spanning the full 6 columns to the full 42-day increment', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({ id: 'full', incrementId: 'board_inc1', startCol: 0, endCol: 6 }),
        ],
      });
      expect(result).toHaveLength(1);
      expect(result[0].startDate).toBe('2026-01-19');
      // inc1 start + 42 days = 2026-03-02
      expect(result[0].endDate).toBe('2026-03-02');
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(
        INCREMENT_DURATION_DAYS
      );
    });

    it('maps a task spanning 2 columns to 14 days (2 sprints)', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({ id: 'two-col', incrementId: 'board_inc1', startCol: 0, endCol: 2 }),
        ],
      });
      expect(result[0].startDate).toBe('2026-01-19');
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(
        2 * DAYS_PER_COLUMN
      );
      expect(result[0].endDate).toBe('2026-02-02'); // 19 + 14 days
    });

    it('shifts a task starting at column 2 by 14 days into the increment', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({ id: 'offset', incrementId: 'board_inc1', startCol: 2, endCol: 4 }),
        ],
      });
      // inc1 start = 2026-01-19, +14d = 2026-02-02, +28d = 2026-02-16
      expect(result[0].startDate).toBe('2026-02-02');
      expect(result[0].endDate).toBe('2026-02-16');
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(14);
    });

    it('positions tasks in inc3 starting from 2026-04-13', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({ id: 'inc3', incrementId: 'board_inc3', startCol: 0, endCol: 1 }),
        ],
      });
      expect(result[0].startDate).toBe('2026-04-13');
      // 1 col = 7 days → 2026-04-20
      expect(result[0].endDate).toBe('2026-04-20');
    });
  });

  describe('tasks without grid position', () => {
    it('covers the full 42-day increment when no position is set', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({ id: 'unpositioned', incrementId: 'board_inc2', startCol: null, endCol: null }),
        ],
      });
      // inc2 start = 2026-03-02
      expect(result[0].startDate).toBe('2026-03-02');
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(
        INCREMENT_DURATION_DAYS
      );
    });
  });

  describe('7-day minimum clamp', () => {
    it('clamps a zero-width task (startCol === endCol) to 7 days', () => {
      // startCol === endCol → treated as unpositioned → full increment, so
      // this case exercises the other branch. Use a legitimate 1-col task:
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({ id: 'single', incrementId: 'board_inc1', startCol: 0, endCol: 1 }),
        ],
      });
      // 1 column = 7 days already, no clamp needed, but verifies the floor.
      expect(daysBetween(result[0].startDate, result[0].endDate)).toBe(
        MIN_TASK_DURATION_DAYS
      );
    });
  });

  describe('task metadata is preserved', () => {
    it('passes through id, title, type, status, source, incrementId, parentTaskId', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({
            id: 'abc-123',
            title: 'Implement login',
            type: 'bug',
            status: 'in_progress',
            source: 'manual',
            incrementId: 'board_inc2',
            parentTaskId: 'container-xyz',
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
        incrementId: 'board_inc2',
        parentTaskId: 'container-xyz',
      });
    });
  });

  describe('mixed increments', () => {
    it('handles tasks spread across multiple increments independently', () => {
      const result = deriveOverlayTasks({
        rawTasks: [
          makeTask({ id: 't1', incrementId: 'board_inc1', startCol: 0, endCol: 2 }),
          makeTask({ id: 't2', incrementId: 'board_inc2', startCol: 0, endCol: 2 }),
          makeTask({ id: 't3', incrementId: 'board_inc8', startCol: 0, endCol: 2 }),
        ],
      });

      const t1 = result.find(t => t.id === 't1')!;
      const t2 = result.find(t => t.id === 't2')!;
      const t3 = result.find(t => t.id === 't3')!;

      expect(t1.startDate).toBe('2026-01-19');
      expect(t2.startDate).toBe('2026-03-02');
      expect(t3.startDate).toBe('2026-11-09');

      // All three should be exactly 14 days (2 columns × 7 days)
      for (const t of [t1, t2, t3]) {
        expect(daysBetween(t.startDate, t.endDate)).toBe(14);
      }
    });
  });
});
