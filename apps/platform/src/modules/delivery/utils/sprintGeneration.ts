/**
 * Pure functions to compute sprint structure from a board's configuration.
 * Replaces the hardcoded `generateIncrements2026()` from BurgerMenu.tsx.
 *
 * No side effects, no DB, no API calls — safe to use in both frontend
 * rendering and backend overlay derivation.
 *
 * MODEL
 *   Agile : board has 2, 4, 6, or 8 weeks → 1 to 4 sprints of 2 weeks.
 *           Grid columns = 1 per week → totalCols = durationWeeks.
 *   Calendaire : board covers a single month → 4 fixed weeks:
 *           week 1 = 1–7, week 2 = 8–14, week 3 = 15–21, week 4 = 22–end.
 *           Grid columns = 4 (always).
 */

export type BoardType = 'agile' | 'calendaire';

export interface BoardConfig {
  id: string;
  boardType: BoardType;
  /** ISO YYYY-MM-DD */
  startDate: string;
  /** ISO YYYY-MM-DD */
  endDate: string;
  /** Agile only: 2 | 4 | 6 | 8 */
  durationWeeks?: number | null;
}

export interface GeneratedSprint {
  /** `${boardId}_s${N}` */
  id: string;
  /** Human label: "Sprint 1", "Semaine 1", etc. */
  name: string;
  /** ISO YYYY-MM-DD */
  startDate: string;
  /** ISO YYYY-MM-DD */
  endDate: string;
}

export interface BoardSprintConfig {
  sprints: GeneratedSprint[];
  /** Number of columns in the board's grid. Agile: durationWeeks. Calendaire: 4. */
  totalCols: number;
  /** Days represented by one grid column (always 7 — 1 week). */
  daysPerColumn: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Generate the sprint list and grid config for a board. Pure function.
 */
export function generateSprintsForBoard(config: BoardConfig): BoardSprintConfig {
  if (config.boardType === 'calendaire') {
    return generateCalendaireSprints(config);
  }
  return generateAgileSprints(config);
}

function generateAgileSprints(config: BoardConfig): BoardSprintConfig {
  const weeks = config.durationWeeks ?? 8;
  const sprintCount = Math.floor(weeks / 2);
  const start = parseDate(config.startDate);
  const sprints: GeneratedSprint[] = [];

  for (let i = 0; i < sprintCount; i++) {
    const sprintStart = addDays(start, i * 14);
    const sprintEnd = addDays(sprintStart, 13); // 14 days - 1
    sprints.push({
      id: `${config.id}_s${i + 1}`,
      name: `Sprint ${i + 1}`,
      startDate: formatDate(sprintStart),
      endDate: formatDate(sprintEnd),
    });
  }

  return {
    sprints,
    totalCols: weeks,    // 1 col = 1 week
    daysPerColumn: 7,
  };
}

function generateCalendaireSprints(config: BoardConfig): BoardSprintConfig {
  const start = parseDate(config.startDate);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const lastDay = lastDayOfMonth(year, month);

  // 4 fixed weeks: 1-7, 8-14, 15-21, 22-end
  const weekBounds: [number, number][] = [
    [1, 7],
    [8, 14],
    [15, 21],
    [22, lastDay],
  ];

  const sprints: GeneratedSprint[] = weekBounds.map(([dayStart, dayEnd], i) => ({
    id: `${config.id}_s${i + 1}`,
    name: `Semaine ${i + 1}`,
    startDate: formatDate(new Date(Date.UTC(year, month, dayStart))),
    endDate: formatDate(new Date(Date.UTC(year, month, dayEnd))),
  }));

  return {
    sprints,
    totalCols: 4,
    daysPerColumn: 7,
  };
}

/**
 * Compute totalCols for a board (shorthand when you don't need the full
 * sprint list).
 */
export function computeTotalCols(config: BoardConfig): number {
  if (config.boardType === 'calendaire') return 4;
  return config.durationWeeks ?? 8;
}

/**
 * Extract the sprint number from a sprint/increment id like `boardId_s3`
 * or legacy `boardId_inc3`. Returns null if not parseable.
 */
export function extractSprintNumber(sprintId: string | null | undefined): number | null {
  if (!sprintId) return null;
  // New format: _s1, _s2, ...
  const matchNew = sprintId.match(/_s(\d+)$/);
  if (matchNew) return parseInt(matchNew[1], 10);
  // Legacy format: _inc1, _inc2, ...
  const matchLegacy = sprintId.match(/_inc(\d+)$/);
  if (matchLegacy) return parseInt(matchLegacy[1], 10);
  return null;
}
