/**
 * Pure functions to derive delivery-overlay dates on a roadmap Gantt.
 *
 * No DB, no Jira, no I/O. The roadmap route fetches raw data from Postgres
 * then calls `deriveOverlayTasks` to compute the final date ranges that the
 * frontend renders as read-only bars on top of the Gantt.
 *
 * Rules (validated with the user):
 *  - An increment's duration is (planning_duration / N_increments),
 *    equally split across all distinct increments of the board.
 *  - Within an increment, a task's date range is derived from its grid
 *    position (start_col / end_col) proportionally to the increment range.
 *  - Tasks without a grid position cover the full increment range.
 *  - Every task has a minimum duration of 7 days (clamped at the end).
 *  - If the planning has non-positive duration, or the board has no
 *    increments, nothing is returned.
 */

export interface RawDeliveryTask {
  id: string;
  title: string;
  type: string;
  status: string;
  source: 'manual' | 'jira';
  incrementId: string;
  /** delivery_positions.start_col — null when no position is stored */
  startCol: number | null;
  /** delivery_positions.end_col — null when no position is stored */
  endCol: number | null;
}

export interface DerivedDeliveryTask {
  id: string;
  title: string;
  type: string;
  status: string;
  source: 'manual' | 'jira';
  incrementId: string;
  /** ISO YYYY-MM-DD */
  startDate: string;
  /** ISO YYYY-MM-DD */
  endDate: string;
}

export interface DeriveOverlayInput {
  /** ISO YYYY-MM-DD */
  planningStart: string;
  /** ISO YYYY-MM-DD */
  planningEnd: string;
  rawTasks: RawDeliveryTask[];
}

export const MIN_TASK_DURATION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Natural-ordering compare: "inc2" < "inc10" (not "inc10" < "inc2" as in
 * plain string sort). Used so increments listed as inc1..inc10..inc11
 * are ordered chronologically regardless of zero-padding.
 */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Parse 'YYYY-MM-DD' into a UTC Date (midnight). Safe from local-TZ drift. */
function parseIsoDate(iso: string): Date {
  // Accept both full ISO and plain date — trim time part if present.
  const datePart = iso.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC Date back to 'YYYY-MM-DD'. */
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

/**
 * Core derivation function. Pure — same inputs always produce same outputs.
 * No Math.random, no Date.now, no side effects.
 */
export function deriveOverlayTasks(input: DeriveOverlayInput): DerivedDeliveryTask[] {
  const { planningStart, planningEnd, rawTasks } = input;

  const start = parseIsoDate(planningStart);
  const end = parseIsoDate(planningEnd);
  const totalDays = diffDays(start, end);

  // Guard: non-positive planning range → nothing to render.
  if (totalDays <= 0) return [];
  if (rawTasks.length === 0) return [];

  // Group tasks by increment.
  const tasksByIncrement = new Map<string, RawDeliveryTask[]>();
  for (const task of rawTasks) {
    if (!task.incrementId) continue;
    const bucket = tasksByIncrement.get(task.incrementId) ?? [];
    bucket.push(task);
    tasksByIncrement.set(task.incrementId, bucket);
  }

  const increments = Array.from(tasksByIncrement.keys()).sort(naturalCompare);
  const n = increments.length;

  // Guard: no increments → nothing to render.
  if (n === 0) return [];

  const incrementDurationDays = totalDays / n;

  const result: DerivedDeliveryTask[] = [];

  for (let i = 0; i < n; i++) {
    const incrementId = increments[i];
    const tasks = tasksByIncrement.get(incrementId)!;
    const incStart = addDays(start, i * incrementDurationDays);
    const incEnd = addDays(start, (i + 1) * incrementDurationDays);

    // Max column used in this increment, used to scale task positions.
    // Filter out tasks without a position before computing max.
    const positioned = tasks.filter(t => t.startCol !== null && t.endCol !== null);
    const maxCol = positioned.reduce(
      (acc, t) => Math.max(acc, t.endCol ?? 0),
      0
    );

    for (const task of tasks) {
      let taskStart: Date;
      let taskEnd: Date;

      if (
        task.startCol !== null &&
        task.endCol !== null &&
        maxCol > 0 &&
        task.endCol > task.startCol
      ) {
        // Proportional mapping inside the increment.
        const startRatio = task.startCol / maxCol;
        const endRatio = task.endCol / maxCol;
        taskStart = addDays(incStart, startRatio * incrementDurationDays);
        taskEnd = addDays(incStart, endRatio * incrementDurationDays);
      } else {
        // No position or degenerate range → cover the full increment.
        taskStart = incStart;
        taskEnd = incEnd;
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
        startDate: formatIsoDate(taskStart),
        endDate: formatIsoDate(taskEnd),
      });
    }
  }

  return result;
}
