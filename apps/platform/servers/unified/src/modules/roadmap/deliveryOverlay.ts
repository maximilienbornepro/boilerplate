/**
 * Pure functions to derive delivery-overlay dates on a roadmap Gantt.
 *
 * No DB, no Jira, no I/O. The roadmap route fetches raw data from Postgres
 * then calls `deriveOverlayTasks` to compute the final date ranges that the
 * frontend renders as read-only bars on top of the Gantt.
 *
 * MODEL (mirrors `apps/platform/src/modules/delivery/utils/sprintGeneration.ts`)
 *   Each board has a type (agile | calendaire), a start_date, an end_date,
 *   and (for agile) a duration_weeks. From this config we compute the sprint
 *   list and the column-to-day mapping:
 *     - Agile : 1 col = 1 week. totalCols = durationWeeks.
 *     - Calendaire : 4 cols = 4 weeks of the month. totalCols = 4.
 *
 *   A delivery task's `increment_id` follows the pattern
 *   `${boardId}_s${N}` (new) or `${boardId}_inc${N}` (legacy).
 *   We extract the sprint number to look up its start date.
 *
 * Rules:
 *   - Tasks whose sprint cannot be resolved are dropped.
 *   - Tasks without grid position cover the full sprint.
 *   - Every task has a minimum duration of 7 days (clamped at the end).
 */

export interface BoardConfigForOverlay {
  boardType: 'agile' | 'calendaire';
  startDate: string;   // ISO YYYY-MM-DD
  endDate: string;     // ISO YYYY-MM-DD
  durationWeeks: number | null;
}

export interface RawDeliveryTask {
  id: string;
  title: string;
  type: string;
  status: string;
  source: 'manual' | 'jira';
  incrementId: string;
  parentTaskId: string | null;
  startCol: number | null;
  endCol: number | null;
}

export interface DerivedDeliveryTask {
  id: string;
  title: string;
  type: string;
  status: string;
  source: 'manual' | 'jira';
  incrementId: string;
  parentTaskId: string | null;
  startDate: string;
  endDate: string;
}

export interface DeriveOverlayInput {
  rawTasks: RawDeliveryTask[];
  boardConfig: BoardConfigForOverlay;
}

export const MIN_TASK_DURATION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function diffDays(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_PER_DAY;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Extract the sprint number from a sprint/increment id like `boardId_s3`
 * or legacy `boardId_inc3`. Returns null if not parseable.
 */
export function extractSprintNumber(sprintId: string | null | undefined): number | null {
  if (!sprintId) return null;
  const matchNew = sprintId.match(/_s(\d+)$/);
  if (matchNew) return parseInt(matchNew[1], 10);
  const matchLegacy = sprintId.match(/_inc(\d+)$/);
  if (matchLegacy) return parseInt(matchLegacy[1], 10);
  return null;
}

interface SprintDateRange {
  startDate: Date;
  endDate: Date;
  daysPerColumn: number;
}

/**
 * Compute the sprint date ranges from the board config. Pure function.
 * Returns a 1-indexed map: sprintRanges[1] = first sprint, etc.
 */
function computeSprintRanges(config: BoardConfigForOverlay): Map<number, SprintDateRange> {
  const map = new Map<number, SprintDateRange>();

  if (config.boardType === 'calendaire') {
    const start = parseIsoDate(config.startDate);
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth();
    const last = lastDayOfMonth(year, month);
    const weekBounds: [number, number][] = [[1, 7], [8, 14], [15, 21], [22, last]];
    weekBounds.forEach(([d1, d2], i) => {
      map.set(i + 1, {
        startDate: new Date(Date.UTC(year, month, d1)),
        endDate: new Date(Date.UTC(year, month, d2)),
        daysPerColumn: 7,
      });
    });
  } else {
    // Agile: each sprint = 2 weeks (2 columns)
    const weeks = config.durationWeeks ?? 6;
    const sprintCount = Math.floor(weeks / 2);
    const boardStart = parseIsoDate(config.startDate);
    for (let i = 0; i < sprintCount; i++) {
      const sprintStart = addDays(boardStart, i * 14);
      const sprintEnd = addDays(sprintStart, 13);
      map.set(i + 1, {
        startDate: sprintStart,
        endDate: sprintEnd,
        daysPerColumn: 7,
      });
    }
  }

  return map;
}

/**
 * Compute totalCols for a board config.
 */
function computeTotalCols(config: BoardConfigForOverlay): number {
  if (config.boardType === 'calendaire') return 4;
  return config.durationWeeks ?? 6;
}

/**
 * Core derivation function. Pure — same inputs always produce same outputs.
 * Reads board config to compute sprint date ranges, then maps each task's
 * grid position to calendar dates.
 */
export function deriveOverlayTasks(input: DeriveOverlayInput): DerivedDeliveryTask[] {
  const { rawTasks, boardConfig } = input;
  if (rawTasks.length === 0) return [];

  const sprintRanges = computeSprintRanges(boardConfig);
  const totalCols = computeTotalCols(boardConfig);
  if (totalCols <= 0) return [];

  // For agile, each sprint has 2 cols. For calendaire, each "sprint" (week) has 1 col.
  const colsPerSprint = boardConfig.boardType === 'calendaire' ? 1 : 2;

  const result: DerivedDeliveryTask[] = [];

  for (const task of rawTasks) {
    const sprintNum = extractSprintNumber(task.incrementId);
    if (sprintNum === null) continue;

    const sprint = sprintRanges.get(sprintNum);
    if (!sprint) continue;

    let taskStart: Date;
    let taskEnd: Date;

    if (
      task.startCol !== null &&
      task.endCol !== null &&
      task.endCol > task.startCol
    ) {
      // Map global column position to date. Each column = 7 days.
      // Compute the offset from the board start, not the sprint start,
      // to handle tasks that span across sprints.
      const boardStart = parseIsoDate(boardConfig.startDate);
      taskStart = addDays(boardStart, task.startCol * 7);
      taskEnd = addDays(boardStart, task.endCol * 7);
    } else {
      // No grid position → cover the full sprint.
      taskStart = sprint.startDate;
      taskEnd = addDays(sprint.endDate, 1); // endDate is inclusive
    }

    // Clamp to minimum 7 days.
    if (diffDays(taskStart, taskEnd) < MIN_TASK_DURATION_DAYS) {
      taskEnd = addDays(taskStart, MIN_TASK_DURATION_DAYS);
    }

    result.push({
      id: task.id,
      title: task.title,
      type: task.type,
      status: task.status,
      source: task.source,
      incrementId: task.incrementId,
      parentTaskId: task.parentTaskId,
      startDate: formatIsoDate(taskStart),
      endDate: formatIsoDate(taskEnd),
    });
  }

  return result;
}
