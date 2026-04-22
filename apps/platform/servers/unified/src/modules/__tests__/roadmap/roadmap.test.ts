import { describe, it, expect } from 'vitest';

describe('Roadmap Backend Module', () => {
  describe('Date formatting', () => {
    function formatDate(date: Date | string): string {
      if (typeof date === 'string') {
        return date.split('T')[0];
      }
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    it('should format Date object correctly', () => {
      const date = new Date(2026, 0, 15);
      expect(formatDate(date)).toBe('2026-01-15');
    });

    it('should format string date correctly', () => {
      expect(formatDate('2026-01-15')).toBe('2026-01-15');
    });

    it('should handle ISO string dates', () => {
      expect(formatDate('2026-01-15T10:30:00.000Z')).toBe('2026-01-15');
    });

    it('should pad single-digit months and days', () => {
      const date = new Date(2026, 2, 5);
      expect(formatDate(date)).toBe('2026-03-05');
    });
  });

  describe('Planning validation', () => {
    function isValidDateRange(startDate: string, endDate: string): boolean {
      return new Date(startDate) <= new Date(endDate);
    }

    function isValidPlanningName(name: string): boolean {
      return name.trim().length > 0 && name.trim().length <= 100;
    }

    it('should accept valid date range', () => {
      expect(isValidDateRange('2026-01-01', '2026-12-31')).toBe(true);
    });

    it('should accept same-day range', () => {
      expect(isValidDateRange('2026-06-15', '2026-06-15')).toBe(true);
    });

    it('should reject invalid date range', () => {
      expect(isValidDateRange('2026-12-31', '2026-01-01')).toBe(false);
    });

    it('should validate planning name length', () => {
      expect(isValidPlanningName('Roadmap 2026')).toBe(true);
      expect(isValidPlanningName('')).toBe(false);
      expect(isValidPlanningName('   ')).toBe(false);
      expect(isValidPlanningName('a'.repeat(101))).toBe(false);
    });
  });

  describe('Task validation', () => {
    function isValidProgress(progress: number): boolean {
      return progress >= 0 && progress <= 100;
    }

    function isValidColor(color: string): boolean {
      return /^#[0-9a-fA-F]{6}$/.test(color);
    }

    it('should validate progress values', () => {
      expect(isValidProgress(0)).toBe(true);
      expect(isValidProgress(50)).toBe(true);
      expect(isValidProgress(100)).toBe(true);
      expect(isValidProgress(-1)).toBe(false);
      expect(isValidProgress(101)).toBe(false);
    });

    it('should validate color format', () => {
      expect(isValidColor('#00bcd4')).toBe(true);
      expect(isValidColor('#8b5cf6')).toBe(true);
      expect(isValidColor('red')).toBe(false);
      expect(isValidColor('#xyz')).toBe(false);
    });
  });

  describe('Dependency types', () => {
    const VALID_TYPES = ['finish-to-start', 'start-to-start', 'finish-to-finish', 'start-to-finish'];

    function isValidDependencyType(type: string): boolean {
      return VALID_TYPES.includes(type);
    }

    it('should accept valid dependency types', () => {
      for (const type of VALID_TYPES) {
        expect(isValidDependencyType(type)).toBe(true);
      }
    });

    it('should reject invalid dependency type', () => {
      expect(isValidDependencyType('invalid')).toBe(false);
      expect(isValidDependencyType('')).toBe(false);
    });
  });

  describe('Row formatting', () => {
    function formatTask(row: any) {
      return {
        id: row.id,
        planningId: row.planning_id,
        parentId: row.parent_id,
        name: row.name,
        description: row.description,
        startDate: row.start_date,
        endDate: row.end_date,
        color: row.color,
        progress: row.progress,
        sortOrder: row.sort_order,
      };
    }

    it('should map snake_case to camelCase', () => {
      const row = {
        id: 'uuid-123',
        planning_id: 'plan-1',
        parent_id: null,
        name: 'Task 1',
        description: 'Description',
        start_date: '2026-01-15',
        end_date: '2026-01-20',
        color: '#00bcd4',
        progress: 50,
        sort_order: 1,
      };

      const task = formatTask(row);
      expect(task.planningId).toBe('plan-1');
      expect(task.parentId).toBeNull();
      expect(task.startDate).toBe('2026-01-15');
      expect(task.endDate).toBe('2026-01-20');
      expect(task.sortOrder).toBe(1);
    });

    it('should handle parent_id value', () => {
      const row = {
        id: 'uuid-456',
        planning_id: 'plan-1',
        parent_id: 'uuid-123',
        name: 'Sub Task',
        description: null,
        start_date: '2026-01-16',
        end_date: '2026-01-18',
        color: '#10b981',
        progress: 0,
        sort_order: 2,
      };

      const task = formatTask(row);
      expect(task.parentId).toBe('uuid-123');
      expect(task.description).toBeNull();
    });
  });

  describe('API routes structure', () => {
    it('should define correct route paths', () => {
      const routes = {
        plannings: '/roadmap/api/plannings',
        planningById: '/roadmap/api/plannings/:id',
        tasks: '/roadmap/api/plannings/:id/tasks',
        taskById: '/roadmap/api/tasks/:id',
        dependencies: '/roadmap/api/plannings/:id/dependencies',
        dependencyById: '/roadmap/api/dependencies/:id',
        markers: '/roadmap/api/plannings/:id/markers',
        markerById: '/roadmap/api/markers/:id',
        embed: '/roadmap/api/embed/:id',
      };

      expect(routes.plannings).toContain('/plannings');
      expect(routes.taskById).toContain(':id');
      expect(routes.embed).toContain('/embed/');
    });
  });

  describe('Task colors', () => {
    const TASK_COLORS = [
      '#00bcd4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#f97316', '#ec4899', '#6366f1', '#14b8a6',
    ];

    it('should have 10 default colors', () => {
      expect(TASK_COLORS).toHaveLength(10);
    });

    it('should use valid hex colors', () => {
      for (const color of TASK_COLORS) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('should start with cyan', () => {
      expect(TASK_COLORS[0]).toBe('#00bcd4');
    });
  });
});

// ==================== Integration: Roadmap ↔ SuiviTess ====================

describe('Roadmap ↔ SuiviTess Integration', () => {
  // Removed: Platform feature flag logic tests — the
  // integration_roadmap_suivitess flag has been deleted (the linking
  // feature is now always-on, no longer gated by a platform setting).

  describe('Task-Subject link data structure', () => {
    interface LinkedSubject {
      id: string;
      title: string;
      status: string;
      situation: string | null;
      responsibility: string | null;
      section_name: string;
      document_id: string;
      document_title: string;
    }

    it('should have correct LinkedSubject shape', () => {
      const subject: LinkedSubject = {
        id: 'uuid-1',
        title: 'Mise en conformité RGPD',
        status: '🟡 en cours',
        situation: 'En attente de validation juridique',
        responsibility: 'DPO',
        section_name: 'Conformité',
        document_id: 'audit-2025',
        document_title: 'Audit 2025',
      };
      expect(subject.id).toBe('uuid-1');
      expect(subject.status).toContain('🟡');
      expect(subject.document_id).toBe('audit-2025');
    });

    it('should allow null situation and responsibility', () => {
      const subject: LinkedSubject = {
        id: 'uuid-2',
        title: 'Migration DB',
        status: '🔴 à faire',
        situation: null,
        responsibility: null,
        section_name: 'Infra',
        document_id: 'infra-doc',
        document_title: 'Infra',
      };
      expect(subject.situation).toBeNull();
      expect(subject.responsibility).toBeNull();
    });

    it('should deduplicate linked subjects by id', () => {
      const subjects: LinkedSubject[] = [
        { id: 'uuid-1', title: 'S1', status: '🔴 à faire', situation: null, responsibility: null, section_name: 'A', document_id: 'doc1', document_title: 'Doc 1' },
        { id: 'uuid-2', title: 'S2', status: '🟡 en cours', situation: null, responsibility: null, section_name: 'B', document_id: 'doc1', document_title: 'Doc 1' },
        { id: 'uuid-1', title: 'S1 dup', status: '🔴 à faire', situation: null, responsibility: null, section_name: 'A', document_id: 'doc1', document_title: 'Doc 1' },
      ];
      const unique = subjects.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);
      expect(unique).toHaveLength(2);
      expect(unique[0].title).toBe('S1');
    });
  });

  describe('Search subject filtering', () => {
    interface SubjectSearchResult {
      id: string;
      title: string;
      status: string;
      section_name: string;
      document_id: string;
      document_title: string;
    }

    const mockResults: SubjectSearchResult[] = [
      { id: 'a', title: 'RGPD conformité', status: '🟡 en cours', section_name: 'Sec1', document_id: 'doc1', document_title: 'Doc 1' },
      { id: 'b', title: 'Migration base', status: '🔴 à faire', section_name: 'Sec2', document_id: 'doc2', document_title: 'Doc 2' },
      { id: 'c', title: 'Audit sécurité', status: '🟢 fait', section_name: 'Sec1', document_id: 'doc1', document_title: 'Doc 1' },
    ];

    it('should filter out already linked subjects from results', () => {
      const linkedIds = new Set(['a', 'c']);
      const filtered = mockResults.filter(r => !linkedIds.has(r.id));
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('b');
    });

    it('should not search when query is less than 2 chars', () => {
      function shouldSearch(q: string): boolean {
        return q.trim().length >= 2;
      }
      expect(shouldSearch('')).toBe(false);
      expect(shouldSearch('r')).toBe(false);
      expect(shouldSearch('rg')).toBe(true);
      expect(shouldSearch('RGPD')).toBe(true);
    });
  });
});
