import { describe, it, expect } from 'vitest';
import {
  generateSprintsForBoard,
  computeTotalCols,
  extractSprintNumber,
  type BoardConfig,
} from '../utils/sprintGeneration';

describe('sprintGeneration — pure sprint structure from board config', () => {
  describe('Agile mode', () => {
    it('generates 4 sprints for an 8-week board', () => {
      const config: BoardConfig = {
        id: 'board-1', boardType: 'agile',
        startDate: '2026-04-06', endDate: '2026-06-01', durationWeeks: 8,
      };
      const { sprints, totalCols, daysPerColumn } = generateSprintsForBoard(config);

      expect(sprints).toHaveLength(4);
      expect(totalCols).toBe(8);
      expect(daysPerColumn).toBe(7);

      // Sprint 1: 2026-04-06 → 2026-04-19 (14 days - 1 inclusive)
      expect(sprints[0].id).toBe('board-1_s1');
      expect(sprints[0].startDate).toBe('2026-04-06');
      expect(sprints[0].endDate).toBe('2026-04-19');

      // Sprint 4: last sprint
      expect(sprints[3].id).toBe('board-1_s4');
    });

    it('generates 1 sprint for a 2-week board', () => {
      const config: BoardConfig = {
        id: 'b', boardType: 'agile',
        startDate: '2026-01-05', endDate: '2026-01-19', durationWeeks: 2,
      };
      const { sprints, totalCols } = generateSprintsForBoard(config);

      expect(sprints).toHaveLength(1);
      expect(totalCols).toBe(2);
      expect(sprints[0].name).toBe('Sprint 1');
    });

    it('generates 2 sprints for a 4-week board', () => {
      const config: BoardConfig = {
        id: 'b', boardType: 'agile',
        startDate: '2026-03-02', endDate: '2026-03-30', durationWeeks: 4,
      };
      const { sprints, totalCols } = generateSprintsForBoard(config);

      expect(sprints).toHaveLength(2);
      expect(totalCols).toBe(4);
    });
  });

  describe('Calendaire mode', () => {
    it('generates 4 weeks for April 2026 (30 days)', () => {
      const config: BoardConfig = {
        id: 'cal-1', boardType: 'calendaire',
        startDate: '2026-04-01', endDate: '2026-04-30',
      };
      const { sprints, totalCols, daysPerColumn } = generateSprintsForBoard(config);

      expect(sprints).toHaveLength(4);
      expect(totalCols).toBe(4);
      expect(daysPerColumn).toBe(7);

      expect(sprints[0].startDate).toBe('2026-04-01');
      expect(sprints[0].endDate).toBe('2026-04-07');
      expect(sprints[1].startDate).toBe('2026-04-08');
      expect(sprints[1].endDate).toBe('2026-04-14');
      expect(sprints[2].startDate).toBe('2026-04-15');
      expect(sprints[2].endDate).toBe('2026-04-21');
      expect(sprints[3].startDate).toBe('2026-04-22');
      expect(sprints[3].endDate).toBe('2026-04-30'); // Last day of April
    });

    it('handles February (28 days)', () => {
      const config: BoardConfig = {
        id: 'cal-feb', boardType: 'calendaire',
        startDate: '2026-02-01', endDate: '2026-02-28',
      };
      const { sprints } = generateSprintsForBoard(config);

      expect(sprints[3].endDate).toBe('2026-02-28');
    });

    it('handles March (31 days)', () => {
      const config: BoardConfig = {
        id: 'cal-mar', boardType: 'calendaire',
        startDate: '2026-03-01', endDate: '2026-03-31',
      };
      const { sprints } = generateSprintsForBoard(config);

      expect(sprints[3].endDate).toBe('2026-03-31');
    });

    it('uses sprint IDs with _s prefix', () => {
      const config: BoardConfig = {
        id: 'cal-x', boardType: 'calendaire',
        startDate: '2026-06-01', endDate: '2026-06-30',
      };
      const { sprints } = generateSprintsForBoard(config);

      expect(sprints.map(s => s.id)).toEqual([
        'cal-x_s1', 'cal-x_s2', 'cal-x_s3', 'cal-x_s4',
      ]);
    });
  });

  describe('computeTotalCols', () => {
    it('returns durationWeeks for agile', () => {
      expect(computeTotalCols({ id: 'x', boardType: 'agile', startDate: '', endDate: '', durationWeeks: 6 })).toBe(6);
    });

    it('returns 4 for calendaire', () => {
      expect(computeTotalCols({ id: 'x', boardType: 'calendaire', startDate: '', endDate: '' })).toBe(4);
    });
  });

  describe('extractSprintNumber', () => {
    it('extracts from new _s format', () => {
      expect(extractSprintNumber('board-123_s3')).toBe(3);
    });

    it('extracts from legacy _inc format', () => {
      expect(extractSprintNumber('board-123_inc5')).toBe(5);
    });

    it('returns null for invalid input', () => {
      expect(extractSprintNumber('')).toBeNull();
      expect(extractSprintNumber(null)).toBeNull();
      expect(extractSprintNumber('no-suffix')).toBeNull();
    });
  });
});
