import type { ViewMode, TimeColumn } from '../types';
import { isHoliday } from '../../conges/utils/holidays';

export const BUSINESS_DAY_WIDTH = 40; // kept for reference / quarter view
export const WEEKEND_DAY_WIDTH = 20;  // kept for reference
export const MONTH_COLUMN_WIDTH = 28; // uniform width for all days in month view (like Congés)

export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDaysBetween(start: Date, end: Date): number {
  const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUTC = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24));
}

export function getBusinessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    if (!isWeekend(current)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** ISO 8601 week number (S1…S52/53) */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function snapToWeekStart(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const daysToSubtract = day === 0 ? 6 : day - 1;
  result.setDate(result.getDate() - daysToSubtract);
  return result;
}

export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

export function generateTimeColumns(
  startDate: Date,
  endDate: Date,
  viewMode: ViewMode
): TimeColumn[] {
  const columns: TimeColumn[] = [];
  const today = new Date();
  let current = new Date(startDate);

  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

  while (current <= endDate) {
    if (viewMode === 'month') {
      const weekend = isWeekend(current);
      const dateStr = formatDate(current);
      columns.push({
        date: new Date(current),
        label: String(current.getDate()),
        isToday: isSameDay(current, today),
        isWeekend: weekend,
        isHoliday: isHoliday(dateStr),
        isWeekStart: current.getDay() === 1,
        // No per-column width — all days use the default MONTH_COLUMN_WIDTH (uniform like Congés)
      });
      current = addDays(current, 1);
    } else if (viewMode === 'quarter') {
      const weekStart = new Date(current);
      const weekEnd = addDays(current, 6);
      const weekNum = getWeekNumber(weekStart);
      columns.push({
        date: weekStart,
        label: `S${weekNum}`,
        isToday: isSameDay(weekStart, today) || (weekStart <= today && today <= weekEnd),
        isWeekend: false,
      });
      current = addDays(current, 7);
    } else {
      // Year view: daily columns like month, no fixed width (GanttBoard sets dynamic width)
      const weekend = isWeekend(current);
      const dateStr = formatDate(current);
      columns.push({
        date: new Date(current),
        label: String(current.getDate()),
        isToday: isSameDay(current, today),
        isWeekend: weekend,
        isHoliday: isHoliday(dateStr),
        isWeekStart: current.getDay() === 1,
      });
      current = addDays(current, 1);
    }
  }

  return columns;
}

export function getColumnWidth(viewMode: ViewMode): number {
  switch (viewMode) {
    case 'month': return MONTH_COLUMN_WIDTH; // 28px uniform (like Congés)
    case 'quarter': return 80;
    case 'year': return 120;
    default: return MONTH_COLUMN_WIDTH;
  }
}

/** Compute total chart width from actual column widths (handles variable-width weekend cols) */
export function getTotalWidth(columns: TimeColumn[], defaultColumnWidth: number): number {
  return columns.reduce((sum, col) => sum + (col.width ?? defaultColumnWidth), 0);
}

/** Pixel offset from chart start to a given date, using actual column widths */
export function calculatePixelOffset(
  targetDate: Date,
  columns: TimeColumn[],
  defaultColumnWidth: number
): number {
  let offset = 0;
  for (const col of columns) {
    if (col.date >= targetDate) break;
    offset += col.width ?? defaultColumnWidth;
  }
  return offset;
}

export function calculateTaskPosition(
  taskStart: Date,
  taskEnd: Date,
  chartStart: Date,
  columnWidth: number,
  viewMode: ViewMode,
  columns?: TimeColumn[]
): { left: number; width: number } {
  // Month/year view with columns — iterate for accurate pixel positioning
  if ((viewMode === 'month' || viewMode === 'year') && columns && columns.length > 0) {
    let left = 0;
    let width = 0;
    let counting = false;
    for (const col of columns) {
      const colW = col.width ?? columnWidth;
      if (!counting) {
        if (isSameDay(col.date, taskStart) || col.date >= taskStart) {
          counting = true;
        } else {
          left += colW;
        }
      }
      if (counting) {
        width += colW;
        if (isSameDay(col.date, taskEnd) || col.date > taskEnd) break;
      }
    }
    return { left, width: Math.max(width, 20) };
  }

  let startOffset: number;
  let taskDuration: number;

  if (viewMode === 'month') {
    startOffset = getDaysBetween(chartStart, taskStart);
    taskDuration = getDaysBetween(taskStart, taskEnd) + 1;
  } else if (viewMode === 'quarter') {
    startOffset = getDaysBetween(chartStart, taskStart) / 7;
    taskDuration = (getDaysBetween(taskStart, taskEnd) + 1) / 7;
  } else {
    const startMonths = (taskStart.getFullYear() - chartStart.getFullYear()) * 12 +
      (taskStart.getMonth() - chartStart.getMonth()) +
      (taskStart.getDate() - 1) / 30;
    const endMonths = (taskEnd.getFullYear() - chartStart.getFullYear()) * 12 +
      (taskEnd.getMonth() - chartStart.getMonth()) +
      taskEnd.getDate() / 30;
    startOffset = startMonths;
    taskDuration = endMonths - startMonths;
  }

  return {
    left: startOffset * columnWidth,
    width: Math.max(taskDuration * columnWidth, 20),
  };
}

export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remaining = days;
  const direction = days >= 0 ? 1 : -1;
  while (remaining !== 0) {
    result.setDate(result.getDate() + direction);
    if (!isWeekend(result)) remaining -= direction;
  }
  return result;
}

export function calculateDateFromPosition(
  pixelX: number,
  chartStart: Date,
  columnWidth: number,
  viewMode: ViewMode,
  columns?: TimeColumn[]
): Date {
  // Month/year view with columns — iterate for pixel-to-date mapping
  if ((viewMode === 'month' || viewMode === 'year') && columns && columns.length > 0) {
    let accumulated = 0;
    for (const col of columns) {
      const colW = col.width ?? columnWidth;
      if (accumulated + colW > pixelX) {
        return col.date;
      }
      accumulated += colW;
    }
    return columns[columns.length - 1]?.date ?? chartStart;
  }

  const offset = pixelX / columnWidth;
  if (viewMode === 'month') {
    return addDays(chartStart, Math.round(offset));
  } else if (viewMode === 'quarter') {
    const rawDate = addDays(chartStart, Math.round(offset * 7));
    return snapToWeekStart(rawDate);
  } else {
    const monthOffset = Math.round(offset);
    const result = new Date(chartStart);
    result.setMonth(result.getMonth() + monthOffset);
    return result;
  }
}

export function getExtendedDateRange(
  startDate: Date,
  endDate: Date,
  viewMode: ViewMode
): { start: Date; end: Date } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const currentYear = new Date().getFullYear();

  const minEndDate = new Date(currentYear, 11, 31);
  if (end < minEndDate) end.setTime(minEndDate.getTime());

  if (viewMode === 'quarter') {
    const startQuarter = Math.floor(start.getMonth() / 3);
    start.setMonth(startQuarter * 3);
    start.setDate(1);
    const endQuarter = Math.floor(end.getMonth() / 3);
    end.setMonth((endQuarter + 1) * 3);
    end.setDate(0);
  } else if (viewMode === 'year') {
    start.setMonth(0);
    start.setDate(1);
    end.setMonth(11);
    end.setDate(31);
  }

  return { start, end };
}

export function getMonthGroups(
  columns: TimeColumn[],
  viewMode: ViewMode
): { label: string; colSpan: number; width?: number }[] {
  const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const groups: { label: string; colSpan: number; width?: number }[] = [];
  let currentMonth = -1;
  let currentYear = -1;

  for (const col of columns) {
    const month = col.date.getMonth();
    const year = col.date.getFullYear();
    if (month !== currentMonth || year !== currentYear) {
      const label = monthNames[month];
      groups.push({ label, colSpan: 1, width: col.width });
      currentMonth = month;
      currentYear = year;
    } else {
      groups[groups.length - 1].colSpan++;
      if (col.width !== undefined && groups[groups.length - 1].width !== undefined) {
        groups[groups.length - 1].width! += col.width;
      }
    }
  }

  return groups;
}
