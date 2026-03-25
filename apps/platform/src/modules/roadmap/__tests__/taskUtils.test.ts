import { describe, it, expect } from 'vitest';
import {
  buildTaskHierarchy,
  flattenHierarchy,
  getDescendantIds,
  hasParentChildRelationship,
  calculateParentDates,
  TASK_COLORS,
  getNextColor,
} from '../utils/taskUtils';
import type { Task } from '../types';

function makeTask(overrides: Partial<Task> & { id: string; name: string }): Task {
  return {
    planningId: 'plan-1',
    parentId: null,
    description: null,
    startDate: '2026-01-15',
    endDate: '2026-01-20',
    color: '#00bcd4',
    progress: 0,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Task Utils', () => {
  describe('buildTaskHierarchy', () => {
    it('should build flat list as root tasks', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Task 1', sortOrder: 1 }),
        makeTask({ id: '2', name: 'Task 2', sortOrder: 2 }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      expect(hierarchy).toHaveLength(2);
      expect(hierarchy[0].name).toBe('Task 1');
      expect(hierarchy[1].name).toBe('Task 2');
    });

    it('should nest children under parent', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Parent', sortOrder: 1 }),
        makeTask({ id: '2', name: 'Child', parentId: '1', sortOrder: 1 }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0].children).toHaveLength(1);
      expect(hierarchy[0].children![0].name).toBe('Child');
    });

    it('should sort by sortOrder', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Third', sortOrder: 3 }),
        makeTask({ id: '2', name: 'First', sortOrder: 1 }),
        makeTask({ id: '3', name: 'Second', sortOrder: 2 }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      expect(hierarchy[0].name).toBe('First');
      expect(hierarchy[1].name).toBe('Second');
      expect(hierarchy[2].name).toBe('Third');
    });

    it('should compute parent dates from children', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Parent', sortOrder: 1, startDate: '2026-01-01', endDate: '2026-01-01' }),
        makeTask({ id: '2', name: 'Child 1', parentId: '1', sortOrder: 1, startDate: '2026-01-10', endDate: '2026-01-15' }),
        makeTask({ id: '3', name: 'Child 2', parentId: '1', sortOrder: 2, startDate: '2026-01-05', endDate: '2026-01-25' }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      expect(hierarchy[0].startDate).toBe('2026-01-05');
      expect(hierarchy[0].endDate).toBe('2026-01-25');
    });

    it('should handle orphaned children (missing parent)', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Orphan', parentId: 'missing-id', sortOrder: 1 }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0].name).toBe('Orphan');
    });
  });

  describe('flattenHierarchy', () => {
    it('should flatten hierarchy with levels', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Parent', sortOrder: 1 }),
        makeTask({ id: '2', name: 'Child', parentId: '1', sortOrder: 1 }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      const flat = flattenHierarchy(hierarchy, new Set());
      expect(flat).toHaveLength(2);
      expect(flat[0].level).toBe(0);
      expect(flat[1].level).toBe(1);
    });

    it('should hide children of collapsed tasks', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Parent', sortOrder: 1 }),
        makeTask({ id: '2', name: 'Child', parentId: '1', sortOrder: 1 }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      const flat = flattenHierarchy(hierarchy, new Set(['1']));
      expect(flat).toHaveLength(1);
      expect(flat[0].task.name).toBe('Parent');
    });

    it('should handle deeply nested hierarchy', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Root', sortOrder: 1 }),
        makeTask({ id: '2', name: 'Level 1', parentId: '1', sortOrder: 1 }),
        makeTask({ id: '3', name: 'Level 2', parentId: '2', sortOrder: 1 }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      const flat = flattenHierarchy(hierarchy, new Set());
      expect(flat).toHaveLength(3);
      expect(flat[0].level).toBe(0);
      expect(flat[1].level).toBe(1);
      expect(flat[2].level).toBe(2);
    });
  });

  describe('getDescendantIds', () => {
    it('should return empty array for leaf task', () => {
      const task = makeTask({ id: '1', name: 'Leaf' });
      expect(getDescendantIds(task)).toEqual([]);
    });

    it('should return all descendant IDs', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Root', sortOrder: 1 }),
        makeTask({ id: '2', name: 'Child 1', parentId: '1', sortOrder: 1 }),
        makeTask({ id: '3', name: 'Child 2', parentId: '1', sortOrder: 2 }),
        makeTask({ id: '4', name: 'Grandchild', parentId: '2', sortOrder: 1 }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      const ids = getDescendantIds(hierarchy[0]);
      expect(ids).toContain('2');
      expect(ids).toContain('3');
      expect(ids).toContain('4');
      expect(ids).toHaveLength(3);
    });
  });

  describe('hasParentChildRelationship', () => {
    it('should detect parent-child relationship', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Parent' }),
        makeTask({ id: '2', name: 'Child', parentId: '1' }),
      ];
      expect(hasParentChildRelationship(tasks, '1', '2')).toBe(true);
    });

    it('should detect in reverse order', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Parent' }),
        makeTask({ id: '2', name: 'Child', parentId: '1' }),
      ];
      expect(hasParentChildRelationship(tasks, '2', '1')).toBe(true);
    });

    it('should return false for unrelated tasks', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Task A' }),
        makeTask({ id: '2', name: 'Task B' }),
      ];
      expect(hasParentChildRelationship(tasks, '1', '2')).toBe(false);
    });

    it('should return false for missing tasks', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Task A' }),
      ];
      expect(hasParentChildRelationship(tasks, '1', 'missing')).toBe(false);
    });
  });

  describe('calculateParentDates', () => {
    it('should return null for leaf task', () => {
      const task = makeTask({ id: '1', name: 'Leaf' });
      expect(calculateParentDates(task)).toBeNull();
    });

    it('should return min start and max end from children', () => {
      const tasks = [
        makeTask({ id: '1', name: 'Parent', sortOrder: 1 }),
        makeTask({ id: '2', name: 'Child 1', parentId: '1', sortOrder: 1, startDate: '2026-01-10', endDate: '2026-01-15' }),
        makeTask({ id: '3', name: 'Child 2', parentId: '1', sortOrder: 2, startDate: '2026-01-05', endDate: '2026-01-25' }),
      ];
      const hierarchy = buildTaskHierarchy(tasks);
      const dates = calculateParentDates(hierarchy[0]);
      expect(dates).not.toBeNull();
      expect(dates!.startDate).toBe('2026-01-05');
      expect(dates!.endDate).toBe('2026-01-25');
    });
  });

  describe('TASK_COLORS', () => {
    it('should have 10 colors', () => {
      expect(TASK_COLORS).toHaveLength(10);
    });

    it('should have valid hex format', () => {
      for (const color of TASK_COLORS) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('should start with cyan', () => {
      expect(TASK_COLORS[0]).toBe('#00bcd4');
    });
  });

  describe('getNextColor', () => {
    it('should return first unused color', () => {
      expect(getNextColor([])).toBe('#00bcd4');
      expect(getNextColor(['#00bcd4'])).toBe('#10b981');
    });

    it('should cycle when all colors used', () => {
      const allColors = [...TASK_COLORS];
      const next = getNextColor(allColors);
      expect(TASK_COLORS).toContain(next);
    });
  });
});
