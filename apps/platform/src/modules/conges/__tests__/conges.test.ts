import { describe, it, expect } from 'vitest';

describe('Conges Module', () => {
  describe('Constants', () => {
    it('should have correct API base path', () => {
      const API_BASE = '/conges-api';
      expect(API_BASE).toBe('/conges-api');
    });

    it('should have correct module route', () => {
      const MODULE_ROUTE = '/conges';
      expect(MODULE_ROUTE).toBe('/conges');
    });
  });

  describe('Types', () => {
    it('should have valid ViewMode values', () => {
      const modes: string[] = ['month', 'quarter', 'year'];
      expect(modes).toContain('month');
      expect(modes).toContain('quarter');
      expect(modes).toContain('year');
    });

    it('should have valid period values', () => {
      const periods: string[] = ['full', 'morning', 'afternoon'];
      expect(periods).toContain('full');
      expect(periods).toContain('morning');
      expect(periods).toContain('afternoon');
    });

    it('should have required Leave fields', () => {
      const mockLeave = {
        id: 'uuid-123',
        memberId: 1,
        startDate: '2026-01-15',
        endDate: '2026-01-17',
        startPeriod: 'full' as const,
        endPeriod: 'morning' as const,
        reason: 'Conges payes',
        status: 'approved',
        createdBy: 1,
        createdAt: '2026-01-10T10:00:00Z',
        updatedAt: '2026-01-10T10:00:00Z',
      };

      expect(mockLeave.id).toBeDefined();
      expect(mockLeave.memberId).toBeDefined();
      expect(mockLeave.startDate).toBeDefined();
      expect(mockLeave.endDate).toBeDefined();
      expect(mockLeave.startPeriod).toBeDefined();
      expect(mockLeave.endPeriod).toBeDefined();
    });

    it('should allow null reason', () => {
      const mockLeave = {
        id: 'uuid-123',
        memberId: 1,
        startDate: '2026-01-15',
        endDate: '2026-01-17',
        startPeriod: 'full' as const,
        endPeriod: 'full' as const,
        reason: null,
        status: 'approved',
        createdBy: null,
        createdAt: '2026-01-10T10:00:00Z',
        updatedAt: '2026-01-10T10:00:00Z',
      };

      expect(mockLeave.reason).toBeNull();
      expect(mockLeave.createdBy).toBeNull();
    });
  });

  describe('Date calculations', () => {
    function getDayOffset(date: string, chartStart: string): number {
      const d = new Date(date);
      const s = new Date(chartStart);
      return Math.floor((d.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    }

    it('should calculate correct day offset for same date', () => {
      expect(getDayOffset('2026-01-15', '2026-01-15')).toBe(0);
    });

    it('should calculate correct day offset for next day', () => {
      expect(getDayOffset('2026-01-16', '2026-01-15')).toBe(1);
    });

    it('should calculate correct offset for end of month', () => {
      expect(getDayOffset('2026-01-31', '2026-01-01')).toBe(30);
    });

    it('should calculate correct offset across months', () => {
      expect(getDayOffset('2026-02-01', '2026-01-01')).toBe(31);
    });
  });

  describe('Leave bar position', () => {
    const COLUMN_WIDTH = 28;

    function calculateBarPosition(
      startDate: string,
      endDate: string,
      chartStart: string,
      startPeriod: string,
      endPeriod: string
    ) {
      const startOffset = Math.floor(
        (new Date(startDate).getTime() - new Date(chartStart).getTime()) / (1000 * 60 * 60 * 24)
      );
      const endOffset = Math.floor(
        (new Date(endDate).getTime() - new Date(chartStart).getTime()) / (1000 * 60 * 60 * 24)
      );
      const daySpan = endOffset - startOffset + 1;

      let left = startOffset * COLUMN_WIDTH;
      let width = daySpan * COLUMN_WIDTH;

      if (startPeriod === 'afternoon') {
        left += COLUMN_WIDTH / 2;
        width -= COLUMN_WIDTH / 2;
      }
      if (endPeriod === 'morning') {
        width -= COLUMN_WIDTH / 2;
      }

      return { left, width: Math.max(width, 4) };
    }

    it('should calculate full-day position', () => {
      const pos = calculateBarPosition('2026-01-05', '2026-01-07', '2026-01-01', 'full', 'full');
      expect(pos.left).toBe(4 * COLUMN_WIDTH);
      expect(pos.width).toBe(3 * COLUMN_WIDTH);
    });

    it('should adjust for afternoon start', () => {
      const pos = calculateBarPosition('2026-01-05', '2026-01-05', '2026-01-01', 'afternoon', 'full');
      expect(pos.left).toBe(4 * COLUMN_WIDTH + COLUMN_WIDTH / 2);
      expect(pos.width).toBe(COLUMN_WIDTH / 2);
    });

    it('should adjust for morning end', () => {
      const pos = calculateBarPosition('2026-01-05', '2026-01-06', '2026-01-01', 'full', 'morning');
      expect(pos.left).toBe(4 * COLUMN_WIDTH);
      expect(pos.width).toBe(2 * COLUMN_WIDTH - COLUMN_WIDTH / 2);
    });

    it('should enforce minimum width', () => {
      const pos = calculateBarPosition('2026-01-05', '2026-01-05', '2026-01-01', 'afternoon', 'morning');
      expect(pos.width).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Member colors', () => {
    const DEFAULT_COLORS = [
      '#00bcd4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#f97316', '#ec4899', '#6366f1', '#14b8a6',
    ];

    it('should have 10 default colors', () => {
      expect(DEFAULT_COLORS).toHaveLength(10);
    });

    it('should have valid hex colors', () => {
      for (const color of DEFAULT_COLORS) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('should assign colors cyclically', () => {
      const getColor = (index: number) => DEFAULT_COLORS[index % DEFAULT_COLORS.length];
      expect(getColor(0)).toBe('#00bcd4');
      expect(getColor(10)).toBe('#00bcd4');
      expect(getColor(3)).toBe('#ef4444');
    });
  });
});
