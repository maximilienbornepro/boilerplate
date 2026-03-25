import type { ViewMode, TimeColumn } from '../types';

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

  const monthNames = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aout', 'Sep', 'Oct', 'Nov', 'Dec'];

  while (current <= endDate) {
    if (viewMode === 'month') {
      if (!isWeekend(current)) {
        columns.push({
          date: new Date(current),
          label: String(current.getDate()),
          isToday: isSameDay(current, today),
          isWeekend: false,
          isWeekStart: current.getDay() === 1,
        });
      }
      current = addDays(current, 1);
    } else if (viewMode === 'quarter') {
      const weekStart = new Date(current);
      const weekEnd = addDays(current, 6);
      const label = `${weekStart.getDate()} ${monthNames[weekStart.getMonth()]}`;
      columns.push({
        date: weekStart,
        label,
        isToday: isSameDay(weekStart, today) || (weekStart <= today && today <= weekEnd),
        isWeekend: false,
      });
      current = addDays(current, 7);
    } else {
      const label = `${monthNames[current.getMonth()]} ${current.getFullYear()}`;
      columns.push({
        date: new Date(current),
        label,
        isToday: current.getMonth() === today.getMonth() && current.getFullYear() === today.getFullYear(),
        isWeekend: false,
      });
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    }
  }

  return columns;
}

export function getColumnWidth(viewMode: ViewMode): number {
  switch (viewMode) {
    case 'month': return 40;
    case 'quarter': return 80;
    case 'year': return 120;
    default: return 40;
  }
}

export function calculateTaskPosition(
  taskStart: Date,
  taskEnd: Date,
  chartStart: Date,
  columnWidth: number,
  viewMode: ViewMode
): { left: number; width: number } {
  let startOffset: number;
  let taskDuration: number;

  if (viewMode === 'month') {
    startOffset = getBusinessDaysBetween(chartStart, taskStart);
    taskDuration = getBusinessDaysBetween(taskStart, taskEnd) + 1;
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
  viewMode: ViewMode
): Date {
  const offset = pixelX / columnWidth;
  if (viewMode === 'month') {
    return addBusinessDays(chartStart, Math.round(offset));
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
): { label: string; colSpan: number }[] {
  if (viewMode === 'year') {
    const groups: { label: string; colSpan: number }[] = [];
    let currentYear = -1;
    for (const col of columns) {
      const year = col.date.getFullYear();
      if (year !== currentYear) {
        groups.push({ label: String(year), colSpan: 1 });
        currentYear = year;
      } else {
        groups[groups.length - 1].colSpan++;
      }
    }
    return groups;
  }

  const monthNames = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
                      'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
  const groups: { label: string; colSpan: number }[] = [];
  let currentMonth = -1;
  let currentYear = -1;

  for (const col of columns) {
    const month = col.date.getMonth();
    const year = col.date.getFullYear();
    if (month !== currentMonth || year !== currentYear) {
      groups.push({ label: `${monthNames[month]} ${year}`, colSpan: 1 });
      currentMonth = month;
      currentYear = year;
    } else {
      groups[groups.length - 1].colSpan++;
    }
  }

  return groups;
}
