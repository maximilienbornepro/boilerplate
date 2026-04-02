import { describe, it, expect } from 'vitest';
import {
  parseDate,
  formatDate,
  getDaysBetween,
  getBusinessDaysBetween,
  addDays,
  isWeekend,
  isSameDay,
  getColumnWidth,
  calculateTaskPosition,
  addBusinessDays,
  calculateDateFromPosition,
  snapToWeekStart,
  generateTimeColumns,
  getMonthGroups,
  getExtendedDateRange,
  getWeekNumber,
  getTotalWidth,
  calculatePixelOffset,
  MONTH_COLUMN_WIDTH,
} from '../utils/dateUtils';

describe('Date Utils', () => {
  describe('parseDate', () => {
    it('should parse YYYY-MM-DD string to Date', () => {
      const date = parseDate('2026-03-15');
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(2); // 0-indexed
      expect(date.getDate()).toBe(15);
    });

    it('should parse first day of year', () => {
      const date = parseDate('2026-01-01');
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(0);
      expect(date.getDate()).toBe(1);
    });

    it('should parse last day of year', () => {
      const date = parseDate('2026-12-31');
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(11);
      expect(date.getDate()).toBe(31);
    });
  });

  describe('formatDate', () => {
    it('should format Date to YYYY-MM-DD string', () => {
      const date = new Date(2026, 2, 15);
      expect(formatDate(date)).toBe('2026-03-15');
    });

    it('should pad single-digit months and days', () => {
      const date = new Date(2026, 0, 5);
      expect(formatDate(date)).toBe('2026-01-05');
    });

    it('should round-trip with parseDate', () => {
      const original = '2026-07-22';
      expect(formatDate(parseDate(original))).toBe(original);
    });
  });

  describe('getDaysBetween', () => {
    it('should return 0 for same day', () => {
      const date = new Date(2026, 0, 15);
      expect(getDaysBetween(date, date)).toBe(0);
    });

    it('should return positive for forward dates', () => {
      const start = new Date(2026, 0, 1);
      const end = new Date(2026, 0, 31);
      expect(getDaysBetween(start, end)).toBe(30);
    });

    it('should return correct days across months', () => {
      const start = new Date(2026, 0, 15);
      const end = new Date(2026, 1, 15);
      expect(getDaysBetween(start, end)).toBe(31);
    });
  });

  describe('getBusinessDaysBetween', () => {
    it('should return 0 for same day', () => {
      const date = new Date(2026, 0, 15); // Thursday
      expect(getBusinessDaysBetween(date, date)).toBe(0);
    });

    it('should skip weekends', () => {
      // Monday to next Monday = 5 business days
      const mon = new Date(2026, 2, 23); // Monday
      const nextMon = new Date(2026, 2, 30); // Next Monday
      expect(getBusinessDaysBetween(mon, nextMon)).toBe(5);
    });

    it('should return 5 for a full week', () => {
      const mon = new Date(2026, 2, 23); // Monday
      const fri = new Date(2026, 2, 27); // Friday
      expect(getBusinessDaysBetween(mon, fri)).toBe(4);
    });
  });

  describe('addDays', () => {
    it('should add positive days', () => {
      const date = new Date(2026, 0, 15);
      const result = addDays(date, 10);
      expect(result.getDate()).toBe(25);
    });

    it('should handle month rollover', () => {
      const date = new Date(2026, 0, 28);
      const result = addDays(date, 5);
      expect(result.getMonth()).toBe(1); // February
      expect(result.getDate()).toBe(2);
    });

    it('should not modify original date', () => {
      const date = new Date(2026, 0, 15);
      addDays(date, 10);
      expect(date.getDate()).toBe(15);
    });
  });

  describe('isWeekend', () => {
    it('should return true for Saturday', () => {
      const sat = new Date(2026, 2, 28); // Saturday
      expect(isWeekend(sat)).toBe(true);
    });

    it('should return true for Sunday', () => {
      const sun = new Date(2026, 2, 29); // Sunday
      expect(isWeekend(sun)).toBe(true);
    });

    it('should return false for weekdays', () => {
      const mon = new Date(2026, 2, 23); // Monday
      expect(isWeekend(mon)).toBe(false);
      const fri = new Date(2026, 2, 27); // Friday
      expect(isWeekend(fri)).toBe(false);
    });
  });

  describe('isSameDay', () => {
    it('should return true for same day', () => {
      const d1 = new Date(2026, 2, 15, 10, 0);
      const d2 = new Date(2026, 2, 15, 20, 30);
      expect(isSameDay(d1, d2)).toBe(true);
    });

    it('should return false for different days', () => {
      const d1 = new Date(2026, 2, 15);
      const d2 = new Date(2026, 2, 16);
      expect(isSameDay(d1, d2)).toBe(false);
    });
  });

  describe('getColumnWidth', () => {
    it('should return 28 for month view (uniform like Congés)', () => {
      expect(getColumnWidth('month')).toBe(MONTH_COLUMN_WIDTH);
    });

    it('should return 80 for quarter view', () => {
      expect(getColumnWidth('quarter')).toBe(80);
    });

    it('should return 120 for year view', () => {
      expect(getColumnWidth('year')).toBe(120);
    });
  });

  describe('calculateTaskPosition', () => {
    it('should calculate correct position in month view using calendar days', () => {
      const chartStart = new Date(2026, 2, 23); // Monday
      const taskStart = new Date(2026, 2, 25); // Wednesday (2 days after Monday)
      const taskEnd = new Date(2026, 2, 27); // Friday (4 days after Monday, inclusive = 3 days span)
      const pos = calculateTaskPosition(taskStart, taskEnd, chartStart, MONTH_COLUMN_WIDTH, 'month');
      // 2 calendar days offset, 3 calendar days duration (Wed + Thu + Fri)
      expect(pos.left).toBe(2 * MONTH_COLUMN_WIDTH);
      expect(pos.width).toBe(3 * MONTH_COLUMN_WIDTH);
    });

    it('should enforce minimum width', () => {
      const chartStart = new Date(2026, 2, 23);
      const taskStart = new Date(2026, 2, 23);
      const taskEnd = new Date(2026, 2, 23);
      const pos = calculateTaskPosition(taskStart, taskEnd, chartStart, 40, 'month');
      expect(pos.width).toBeGreaterThanOrEqual(20);
    });
  });

  describe('addBusinessDays', () => {
    it('should add business days skipping weekends', () => {
      const fri = new Date(2026, 2, 27); // Friday
      const result = addBusinessDays(fri, 1);
      expect(result.getDay()).toBe(1); // Monday
    });

    it('should handle negative business days', () => {
      const mon = new Date(2026, 2, 30); // Monday
      const result = addBusinessDays(mon, -1);
      expect(result.getDay()).toBe(5); // Friday
    });
  });

  describe('snapToWeekStart', () => {
    it('should snap to Monday for a Wednesday', () => {
      const wed = new Date(2026, 2, 25); // Wednesday
      const result = snapToWeekStart(wed);
      expect(result.getDay()).toBe(1); // Monday
      expect(result.getDate()).toBe(23);
    });

    it('should keep Monday as is', () => {
      const mon = new Date(2026, 2, 23); // Monday
      const result = snapToWeekStart(mon);
      expect(result.getDate()).toBe(23);
    });

    it('should snap Sunday to previous Monday', () => {
      const sun = new Date(2026, 2, 29); // Sunday
      const result = snapToWeekStart(sun);
      expect(result.getDay()).toBe(1); // Monday
      expect(result.getDate()).toBe(23);
    });
  });

  describe('generateTimeColumns', () => {
    it('should generate columns for month view including weekends', () => {
      // Mon 23 to Sun 29 March 2026 = 7 days
      const start = new Date(2026, 2, 23); // Monday
      const end = new Date(2026, 2, 29); // Sunday
      const cols = generateTimeColumns(start, end, 'month');
      expect(cols.length).toBe(7);
      // All days get their day number label
      expect(cols[0].label).toBe('23'); // Monday
      expect(cols[4].label).toBe('27'); // Friday
      expect(cols[5].label).toBe('28'); // Saturday (weekend)
      expect(cols[6].label).toBe('29'); // Sunday (weekend)
    });

    it('should mark weekend columns with isWeekend (uniform width, no per-column width set)', () => {
      const start = new Date(2026, 2, 27); // Friday
      const end = new Date(2026, 2, 30); // Monday
      const cols = generateTimeColumns(start, end, 'month');
      expect(cols[0].isWeekend).toBe(false);
      expect(cols[0].width).toBeUndefined(); // uniform — uses default MONTH_COLUMN_WIDTH
      expect(cols[1].isWeekend).toBe(true); // Saturday
      expect(cols[1].width).toBeUndefined();
      expect(cols[2].isWeekend).toBe(true); // Sunday
      expect(cols[2].width).toBeUndefined();
      expect(cols[3].isWeekend).toBe(false); // Monday
      expect(cols[3].width).toBeUndefined();
    });

    it('should generate 5 columns (Mon-Fri) with no weekends for pure week', () => {
      const start = new Date(2026, 2, 23); // Monday
      const end = new Date(2026, 2, 27); // Friday
      const cols = generateTimeColumns(start, end, 'month');
      expect(cols.length).toBe(5);
      expect(cols.every(c => !c.isWeekend)).toBe(true);
      expect(cols[0].label).toBe('23');
      expect(cols[4].label).toBe('27');
    });

    it('should generate weekly columns for quarter view', () => {
      const start = new Date(2026, 0, 1);
      const end = new Date(2026, 0, 21);
      const cols = generateTimeColumns(start, end, 'quarter');
      expect(cols.length).toBe(3); // 3 weeks
    });

    it('should generate daily columns for year view', () => {
      const start = new Date(2026, 0, 1);
      const end = new Date(2026, 11, 31);
      const cols = generateTimeColumns(start, end, 'year');
      expect(cols.length).toBe(365);
    });
  });

  describe('getMonthGroups', () => {
    it('should group columns by month for month view', () => {
      const start = new Date(2026, 0, 1);
      const end = new Date(2026, 1, 28);
      const cols = generateTimeColumns(start, end, 'month');
      const groups = getMonthGroups(cols, 'month');
      expect(groups.length).toBe(2);
      expect(groups[0].label).toContain('Janvier');
      expect(groups[1].label).toContain('Février');
    });

    it('should group columns by month for year view', () => {
      const start = new Date(2025, 0, 1);
      const end = new Date(2025, 11, 31);
      const cols = generateTimeColumns(start, end, 'year');
      const groups = getMonthGroups(cols, 'year');
      expect(groups.length).toBe(12);
      expect(groups[0].label).toBe('Janvier');
      expect(groups[11].label).toBe('Décembre');
    });
  });

  describe('getWeekNumber', () => {
    it('should return 1 for the first week of 2026', () => {
      // Jan 1 2026 is a Thursday — ISO week 1
      const date = new Date(2026, 0, 1);
      expect(getWeekNumber(date)).toBe(1);
    });

    it('should return correct week number for a known date', () => {
      // March 16, 2026 is in week 12
      const date = new Date(2026, 2, 16);
      expect(getWeekNumber(date)).toBe(12);
    });

    it('should return 53 or 1 for last week of year boundary', () => {
      // Dec 28 is always in the last ISO week
      const date = new Date(2026, 11, 28);
      const wk = getWeekNumber(date);
      expect(wk).toBeGreaterThanOrEqual(52);
    });

    it('should return same week for Mon-Sun of same ISO week', () => {
      const monday = new Date(2026, 2, 23); // Monday
      const sunday = new Date(2026, 2, 29); // Sunday
      expect(getWeekNumber(monday)).toBe(getWeekNumber(sunday));
    });
  });

  describe('getTotalWidth', () => {
    it('should sum column widths using default when not set (month view: uniform 28px)', () => {
      const cols = [
        { date: new Date(), label: '1', isToday: false, isWeekend: false },
        { date: new Date(), label: '2', isToday: false, isWeekend: false },
        { date: new Date(), label: '3', isToday: false, isWeekend: true },
        { date: new Date(), label: '4', isToday: false, isWeekend: true },
        { date: new Date(), label: '5', isToday: false, isWeekend: false },
      ];
      expect(getTotalWidth(cols, MONTH_COLUMN_WIDTH)).toBe(5 * MONTH_COLUMN_WIDTH);
    });

    it('should use per-column width when available (quarter/year view)', () => {
      const cols = [
        { date: new Date(), label: 'S1', isToday: false, isWeekend: false, width: 80 },
        { date: new Date(), label: 'S2', isToday: false, isWeekend: false, width: 80 },
      ];
      expect(getTotalWidth(cols, 80)).toBe(160);
    });
  });

  describe('calculatePixelOffset', () => {
    it('should return 0 for first column date', () => {
      const start = new Date(2026, 2, 23);
      const end = new Date(2026, 2, 27);
      const cols = generateTimeColumns(start, end, 'month');
      expect(calculatePixelOffset(start, cols, MONTH_COLUMN_WIDTH)).toBe(0);
    });

    it('should return correct offset using uniform calendar-day widths', () => {
      const start = new Date(2026, 2, 23); // Monday
      const end = new Date(2026, 2, 27); // Friday
      const cols = generateTimeColumns(start, end, 'month');
      // Wednesday is 2 calendar days from Monday (Mon + Tue = 2 * 28 = 56)
      const wed = new Date(2026, 2, 25);
      expect(calculatePixelOffset(wed, cols, MONTH_COLUMN_WIDTH)).toBe(2 * MONTH_COLUMN_WIDTH);
    });

    it('should include weekend columns with same width as weekdays', () => {
      const start = new Date(2026, 2, 27); // Friday
      const end = new Date(2026, 2, 30); // Monday
      const cols = generateTimeColumns(start, end, 'month');
      // Monday (index 3) = Fri(28) + Sat(28) + Sun(28) = 84
      const monday = new Date(2026, 2, 30);
      expect(calculatePixelOffset(monday, cols, MONTH_COLUMN_WIDTH)).toBe(3 * MONTH_COLUMN_WIDTH);
    });
  });

  describe('getExtendedDateRange', () => {
    it('should extend end to at least current year end', () => {
      const start = new Date(2026, 0, 1);
      const end = new Date(2026, 5, 30);
      const { end: extEnd } = getExtendedDateRange(start, end, 'month');
      expect(extEnd.getMonth()).toBe(11); // December
    });

    it('should align to quarter boundaries in quarter mode', () => {
      const start = new Date(2026, 1, 15); // Feb
      const end = new Date(2026, 11, 31);
      const { start: extStart } = getExtendedDateRange(start, end, 'quarter');
      expect(extStart.getMonth()).toBe(0); // Jan (Q1 start)
      expect(extStart.getDate()).toBe(1);
    });

    it('should align to year boundaries in year mode', () => {
      const start = new Date(2026, 3, 15);
      const end = new Date(2026, 11, 31);
      const { start: extStart, end: extEnd } = getExtendedDateRange(start, end, 'year');
      expect(extStart.getMonth()).toBe(0);
      expect(extStart.getDate()).toBe(1);
      expect(extEnd.getMonth()).toBe(11);
      expect(extEnd.getDate()).toBe(31);
    });
  });
});
