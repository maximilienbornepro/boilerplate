/**
 * Pure functions to derive delivery-overlay dates on a roadmap Gantt.
 *
 * No DB, no Jira, no I/O. The roadmap route fetches raw data from Postgres
 * then calls `deriveOverlayTasks` to compute the final date ranges that the
 * frontend renders as read-only bars on top of the Gantt.
 *
 * MODEL (mirrors `apps/platform/src/modules/delivery/components/BurgerMenu.tsx`)
 *   Delivery uses a deterministic calendar for 2026:
 *     - `inc1` starts on 2026-01-19 (a Monday).
 *     - Each increment contains 3 sprints of 14 days = 42 days per increment.
 *     - `inc2` starts on `inc1.start + 42` days, etc. up to `inc8`.
 *
 *   Delivery tasks are placed on a 6-column grid inside their increment
 *   (TOTAL_COLS = 6). Since each increment is 42 days long, **1 column = 7
 *   days**. So a task with `startCol = 0, endCol = 2` spans exactly 14 days
 *   from the increment's start date.
 *
 *   A delivery task's `increment_id` follows the pattern `${boardId}_inc${N}`.
 *   We extract the `inc${N}` suffix to look up its start date.
 *
 * Rules:
 *   - Tasks whose `increment_id` cannot be resolved (unknown suffix,
 *     malformed, increment number out of the 1..8 range) are dropped.
 *   - Tasks without grid position cover the full increment (42 days).
 *   - Every task has a minimum duration of 7 days (clamped at the end).
 */

export interface RawDeliveryTask {
  id: string;
  title: string;
  type: string;
  status: string;
  source: 'manual' | 'jira';
  incrementId: string;
  /** delivery_tasks.parent_task_id — set for Jira tickets nested inside a
   *  manual container task. Null for top-level tasks. */
  parentTaskId: string | null;
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
  /** See RawDeliveryTask.parentTaskId. */
  parentTaskId: string | null;
  /** ISO YYYY-MM-DD */
  startDate: string;
  /** ISO YYYY-MM-DD */
  endDate: string;
}

export interface DeriveOverlayInput {
  rawTasks: RawDeliveryTask[];
}

/** 1 sprint = 14 days (2 weeks). */
export const SPRINT_DURATION_DAYS = 14;
/** Delivery boards have 3 sprints per increment. */
export const SPRINTS_PER_INCREMENT = 3;
/** Increment total duration = 3 * 14 = 42 days. */
export const INCREMENT_DURATION_DAYS = SPRINT_DURATION_DAYS * SPRINTS_PER_INCREMENT; // 42
/** Delivery boards use a 6-col grid. With a 42-day increment → 7 days/col. */
export const TOTAL_COLS = 6;
export const DAYS_PER_COLUMN = INCREMENT_DURATION_DAYS / TOTAL_COLS; // 7
/** First day of inc1, as defined in BurgerMenu.generateIncrements2026(). */
export const INC1_START_ISO = '2026-01-19';
/** Minimum visual duration so a 0-width task is still visible. */
export const MIN_TASK_DURATION_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse 'YYYY-MM-DD' into a UTC Date (midnight). Safe from local-TZ drift. */
function parseIsoDate(iso: string): Date {
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
 * Extract the increment number from a delivery increment_id like
 * `${boardId}_inc3`. Returns null if the suffix is missing, malformed,
 * or outside the 1..8 range supported by the delivery module.
 */
export function extractIncrementNumber(incrementId: string | null | undefined): number | null {
  if (!incrementId) return null;
  const match = incrementId.match(/_inc(\d+)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 8) return null;
  return n;
}

/**
 * Compute the start date of a given increment number (1..8).
 * `inc${n}.start = INC1_START + (n - 1) * 42 days`.
 */
export function getIncrementStartDate(incrementNumber: number): Date {
  return addDays(parseIsoDate(INC1_START_ISO), (incrementNumber - 1) * INCREMENT_DURATION_DAYS);
}

/**
 * Core derivation function. Pure — same inputs always produce same outputs.
 * No Math.random, no Date.now, no side effects, no planning dependency.
 */
export function deriveOverlayTasks(input: DeriveOverlayInput): DerivedDeliveryTask[] {
  const { rawTasks } = input;
  if (rawTasks.length === 0) return [];

  const result: DerivedDeliveryTask[] = [];

  for (const task of rawTasks) {
    const incNum = extractIncrementNumber(task.incrementId);
    if (incNum === null) continue; // Orphan task, unknown increment → skip.

    const incStart = getIncrementStartDate(incNum);

    let taskStart: Date;
    let taskEnd: Date;

    if (
      task.startCol !== null &&
      task.endCol !== null &&
      task.endCol > task.startCol
    ) {
      // Each column is exactly 7 days. 0 ≤ startCol < endCol ≤ TOTAL_COLS.
      const startCol = Math.max(0, task.startCol);
      const endCol = Math.min(TOTAL_COLS, task.endCol);
      taskStart = addDays(incStart, startCol * DAYS_PER_COLUMN);
      taskEnd = addDays(incStart, endCol * DAYS_PER_COLUMN);
    } else {
      // No grid position → cover the full increment.
      taskStart = incStart;
      taskEnd = addDays(incStart, INCREMENT_DURATION_DAYS);
    }

    // Clamp to minimum 7 days so single-day tasks stay visible.
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
