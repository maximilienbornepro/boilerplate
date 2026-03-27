import { describe, it, expect } from 'vitest';

// Tests for the Jira proxy endpoints logic in delivery/routes.ts
// These test pure logic (no DB, no HTTP) — integration tests would require a mock Jira server

describe('Delivery Jira Proxy', () => {
  describe('sprintIds parsing', () => {
    function parseSprintIds(sprintIds: string): number[] {
      return sprintIds.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
    }

    it('parses a single sprint id', () => {
      expect(parseSprintIds('42')).toEqual([42]);
    });

    it('parses multiple sprint ids', () => {
      expect(parseSprintIds('1,2,3')).toEqual([1, 2, 3]);
    });

    it('trims whitespace around ids', () => {
      expect(parseSprintIds('1, 2 , 3')).toEqual([1, 2, 3]);
    });

    it('ignores invalid ids', () => {
      expect(parseSprintIds('1,abc,3')).toEqual([1, 3]);
    });
  });

  describe('JQL sprint query building', () => {
    function buildSprintJql(ids: number[]): string {
      return `sprint in (${ids.join(', ')}) ORDER BY created DESC`;
    }

    it('builds JQL for a single sprint', () => {
      expect(buildSprintJql([101])).toBe('sprint in (101) ORDER BY created DESC');
    });

    it('builds JQL for multiple sprints', () => {
      expect(buildSprintJql([101, 102, 103])).toBe('sprint in (101, 102, 103) ORDER BY created DESC');
    });
  });

  describe('Jira proxy endpoint paths', () => {
    const ENDPOINTS = [
      '/jira/check',
      '/jira/projects',
      '/jira/sprints',
      '/jira/issues',
    ];

    it('defines all required endpoints', () => {
      expect(ENDPOINTS).toHaveLength(4);
      expect(ENDPOINTS).toContain('/jira/check');
      expect(ENDPOINTS).toContain('/jira/projects');
      expect(ENDPOINTS).toContain('/jira/sprints');
      expect(ENDPOINTS).toContain('/jira/issues');
    });

    it('all endpoint paths start with /jira/', () => {
      ENDPOINTS.forEach(path => {
        expect(path.startsWith('/jira/')).toBe(true);
      });
    });
  });

  describe('Sprint sorting (active first)', () => {
    function sortSprints(sprints: Array<{ id: number; state: string }>) {
      return [...sprints].sort((a, b) =>
        a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0
      );
    }

    it('puts active sprints first', () => {
      const sprints = [
        { id: 1, state: 'closed' },
        { id: 2, state: 'active' },
        { id: 3, state: 'closed' },
      ];
      const sorted = sortSprints(sprints);
      expect(sorted[0].state).toBe('active');
      expect(sorted[0].id).toBe(2);
    });

    it('keeps closed sprints in original order', () => {
      const sprints = [
        { id: 1, state: 'closed' },
        { id: 2, state: 'closed' },
      ];
      const sorted = sortSprints(sprints);
      expect(sorted).toEqual(sprints);
    });

    it('handles empty list', () => {
      expect(sortSprints([])).toEqual([]);
    });
  });
});
