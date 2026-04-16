import pg from 'pg';
import { config } from '../../config.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: config.appDatabaseUrl,
});

// ============ Tasks CRUD ============

export interface TaskRow {
  id: string;
  title: string;
  type: string;
  status: string;
  storyPoints: number | null;
  estimatedDays: number | null;
  assignee: string | null;
  priority: string;
  incrementId: string | null;
  sprintName: string | null;
  source: 'manual' | 'jira';
  parentTaskId: string | null;
  description: string | null;
}

function mapTaskRow(row: Record<string, unknown>): TaskRow {
  return {
    id: row.id as string,
    title: row.title as string,
    type: row.type as string,
    status: row.status as string,
    storyPoints: row.story_points ? parseFloat(row.story_points as string) : null,
    estimatedDays: row.estimated_days ? parseFloat(row.estimated_days as string) : null,
    assignee: row.assignee as string | null,
    priority: row.priority as string,
    incrementId: row.increment_id as string | null,
    sprintName: row.sprint_name as string | null,
    source: (row.source as 'manual' | 'jira') || 'manual',
    parentTaskId: row.parent_task_id as string | null,
    description: row.description as string | null,
  };
}

const TASK_COLUMNS = 'id, title, type, status, story_points, estimated_days, assignee, priority, increment_id, sprint_name, source, parent_task_id, description';

export async function getAllTasks(incrementId: string): Promise<TaskRow[]> {
  const result = await pool.query(
    `SELECT ${TASK_COLUMNS} FROM delivery_tasks WHERE increment_id = $1 ORDER BY created_at`,
    [incrementId]
  );
  return result.rows.map(mapTaskRow);
}

/**
 * Fetch all tasks belonging to a board, across ALL sprints.
 * Matches:
 *   - `${boardId}_s1`, `${boardId}_s2`, ... (new sprint format)
 *   - `${boardId}_inc1`, ... (legacy increment format)
 *   - `${boardId}` (bare board ID — tasks created during the transition)
 */
export async function getAllTasksForBoard(boardId: string): Promise<TaskRow[]> {
  const result = await pool.query(
    `SELECT ${TASK_COLUMNS} FROM delivery_tasks
     WHERE increment_id = $1 OR increment_id LIKE $2 ESCAPE '\\'
     ORDER BY increment_id, created_at`,
    [boardId, `${boardId}\\_%`]
  );
  return result.rows.map(mapTaskRow);
}

/**
 * Fetch all positions for a board, across ALL sprints.
 */
export async function getPositionsForBoard(boardId: string): Promise<TaskPosition[]> {
  const result = await pool.query(
    `SELECT task_id, increment_id, start_col, end_col, row, row_span
     FROM delivery_positions
     WHERE increment_id = $1 OR increment_id LIKE $2 ESCAPE '\\'`,
    [boardId, `${boardId}\\_%`]
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    taskId: row.task_id as string,
    incrementId: row.increment_id as string,
    startCol: row.start_col as number,
    endCol: row.end_col as number,
    row: row.row as number,
    rowSpan: (row.row_span as number) || 1,
  }));
}

export async function createTask(task: {
  title: string;
  type?: string;
  status?: string;
  storyPoints?: number;
  estimatedDays?: number;
  assignee?: string;
  priority?: string;
  incrementId?: string;
  sprintName?: string;
  source?: 'manual' | 'jira';
  description?: string | null;
}): Promise<TaskRow> {
  const result = await pool.query(
    `INSERT INTO delivery_tasks (title, type, status, story_points, estimated_days, assignee, priority, increment_id, sprint_name, source, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${TASK_COLUMNS}`,
    [
      task.title,
      task.type || 'feature',
      task.status || 'todo',
      task.storyPoints || null,
      task.estimatedDays || null,
      task.assignee || null,
      task.priority || 'medium',
      task.incrementId || null,
      task.sprintName || null,
      task.source || 'manual',
      task.description || null,
    ]
  );
  return mapTaskRow(result.rows[0]);
}

export async function updateTask(id: string, updates: Partial<{
  title: string;
  type: string;
  status: string;
  storyPoints: number;
  estimatedDays: number;
  assignee: string;
  priority: string;
  incrementId: string;
  sprintName: string;
  parentTaskId: string | null;
  description: string | null;
}>): Promise<TaskRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) { fields.push(`title = $${idx++}`); values.push(updates.title); }
  if (updates.type !== undefined) { fields.push(`type = $${idx++}`); values.push(updates.type); }
  if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }
  if (updates.storyPoints !== undefined) { fields.push(`story_points = $${idx++}`); values.push(updates.storyPoints); }
  if (updates.estimatedDays !== undefined) { fields.push(`estimated_days = $${idx++}`); values.push(updates.estimatedDays); }
  if (updates.assignee !== undefined) { fields.push(`assignee = $${idx++}`); values.push(updates.assignee); }
  if (updates.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(updates.priority); }
  if (updates.incrementId !== undefined) { fields.push(`increment_id = $${idx++}`); values.push(updates.incrementId); }
  if (updates.sprintName !== undefined) { fields.push(`sprint_name = $${idx++}`); values.push(updates.sprintName); }
  if (updates.parentTaskId !== undefined) { fields.push(`parent_task_id = $${idx++}`); values.push(updates.parentTaskId); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }

  if (fields.length === 0) return null;

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query(
    `UPDATE delivery_tasks SET ${fields.join(', ')} WHERE id = $${idx}
     RETURNING ${TASK_COLUMNS}`,
    values
  );

  if (result.rows.length === 0) return null;
  return mapTaskRow(result.rows[0]);
}

export async function nestTask(childId: string, parentId: string): Promise<TaskRow | null> {
  // Validate: parent must be manual, child must be jira, child must not have children
  const parent = await pool.query('SELECT source FROM delivery_tasks WHERE id = $1', [parentId]);
  if (parent.rows.length === 0 || parent.rows[0].source !== 'manual') return null;

  const childChildren = await pool.query('SELECT id FROM delivery_tasks WHERE parent_task_id = $1 LIMIT 1', [childId]);
  if (childChildren.rows.length > 0) return null; // no multi-level nesting

  const result = await pool.query(
    `UPDATE delivery_tasks SET parent_task_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING ${TASK_COLUMNS}`,
    [parentId, childId]
  );
  return result.rows.length > 0 ? mapTaskRow(result.rows[0]) : null;
}

export async function unnestTask(childId: string): Promise<TaskRow | null> {
  const result = await pool.query(
    `UPDATE delivery_tasks SET parent_task_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING ${TASK_COLUMNS}`,
    [childId]
  );
  return result.rows.length > 0 ? mapTaskRow(result.rows[0]) : null;
}

export async function getChildTasks(parentId: string): Promise<TaskRow[]> {
  const result = await pool.query(
    `SELECT ${TASK_COLUMNS} FROM delivery_tasks WHERE parent_task_id = $1 ORDER BY created_at`,
    [parentId]
  );
  return result.rows.map(mapTaskRow);
}

export async function deleteTask(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM delivery_tasks WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}

// ============ Task Positions ============

export interface TaskPosition {
  taskId: string;
  incrementId: string;
  startCol: number;
  endCol: number;
  row: number;
  rowSpan: number;
}

export async function saveTaskPosition(position: TaskPosition): Promise<void> {
  await pool.query(
    `INSERT INTO delivery_positions (task_id, increment_id, start_col, end_col, row, row_span, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (task_id, increment_id)
     DO UPDATE SET
       start_col = EXCLUDED.start_col,
       end_col = EXCLUDED.end_col,
       row = EXCLUDED.row,
       row_span = EXCLUDED.row_span,
       updated_at = CURRENT_TIMESTAMP`,
    [position.taskId, position.incrementId, position.startCol, position.endCol, position.row, position.rowSpan || 1]
  );
}

export async function getTaskPositions(incrementId: string): Promise<TaskPosition[]> {
  const result = await pool.query(
    'SELECT task_id, increment_id, start_col, end_col, row, row_span FROM delivery_positions WHERE increment_id = $1',
    [incrementId]
  );
  return result.rows.map(row => ({
    taskId: row.task_id,
    incrementId: row.increment_id,
    startCol: row.start_col,
    endCol: row.end_col,
    row: row.row,
    rowSpan: row.row_span || 1,
  }));
}

export async function deleteTaskPosition(incrementId: string, taskId: string): Promise<void> {
  await pool.query(
    'DELETE FROM delivery_positions WHERE increment_id = $1 AND task_id = $2',
    [incrementId, taskId]
  );
}

/**
 * Bulk-upsert positions for multiple tasks in a single transaction.
 * All entries are written atomically — if one fails, none are applied.
 * Each entry must provide a resolved `incrementId` (caller decides which
 * sprint/board increment the task lives in).
 */
export async function bulkUpsertPositions(positions: TaskPosition[]): Promise<void> {
  if (positions.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of positions) {
      await client.query(
        `INSERT INTO delivery_positions (task_id, increment_id, start_col, end_col, row, row_span, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         ON CONFLICT (task_id, increment_id)
         DO UPDATE SET
           start_col = EXCLUDED.start_col,
           end_col = EXCLUDED.end_col,
           row = EXCLUDED.row,
           row_span = EXCLUDED.row_span,
           updated_at = CURRENT_TIMESTAMP`,
        [p.taskId, p.incrementId, p.startCol, p.endCol, p.row, p.rowSpan || 1]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============ Increment State ============

export interface HiddenTask {
  taskId: string;
  title?: string;
  sprintName?: string;
}

export interface IncrementState {
  incrementId: string;
  isFrozen: boolean;
  hiddenTaskIds: string[];
  hiddenTasks: HiddenTask[];
  frozenAt: Date | null;
}

export async function getIncrementState(incrementId: string): Promise<IncrementState> {
  let result = await pool.query(
    'SELECT increment_id, is_frozen, hidden_task_ids, frozen_at FROM delivery_increment_state WHERE increment_id = $1',
    [incrementId]
  );

  if (result.rows.length === 0) {
    await pool.query(
      'INSERT INTO delivery_increment_state (increment_id, is_frozen, hidden_task_ids) VALUES ($1, FALSE, $2)',
      [incrementId, []]
    );
    return {
      incrementId,
      isFrozen: false,
      hiddenTaskIds: [],
      hiddenTasks: [],
      frozenAt: null,
    };
  }

  const row = result.rows[0];
  const hiddenTaskIds: string[] = row.hidden_task_ids || [];

  // Fetch task info for hidden tasks
  let hiddenTasks: HiddenTask[] = [];
  if (hiddenTaskIds.length > 0) {
    const tasksResult = await pool.query(
      'SELECT id, title, sprint_name FROM delivery_tasks WHERE id = ANY($1)',
      [hiddenTaskIds]
    );
    const taskMap = new Map(tasksResult.rows.map(r => [r.id, { title: r.title, sprintName: r.sprint_name }]));
    hiddenTasks = hiddenTaskIds.map(taskId => ({
      taskId,
      title: taskMap.get(taskId)?.title,
      sprintName: taskMap.get(taskId)?.sprintName,
    }));
  }

  return {
    incrementId: row.increment_id,
    isFrozen: row.is_frozen,
    hiddenTaskIds,
    hiddenTasks,
    frozenAt: row.frozen_at,
  };
}

export async function toggleIncrementFreeze(incrementId: string): Promise<IncrementState> {
  const current = await getIncrementState(incrementId);
  const newFrozenState = !current.isFrozen;
  const frozenAt = newFrozenState ? new Date() : null;

  await pool.query(
    `UPDATE delivery_increment_state
     SET is_frozen = $2, frozen_at = $3, updated_at = CURRENT_TIMESTAMP
     WHERE increment_id = $1`,
    [incrementId, newFrozenState, frozenAt]
  );

  return {
    ...current,
    isFrozen: newFrozenState,
    frozenAt,
  };
}

export async function hideTaskInIncrement(incrementId: string, taskId: string): Promise<HiddenTask[]> {
  await getIncrementState(incrementId);

  await pool.query(
    `UPDATE delivery_increment_state
     SET hidden_task_ids = array_append(
       COALESCE(hidden_task_ids, ARRAY[]::UUID[]),
       $2::UUID
     ),
     updated_at = CURRENT_TIMESTAMP
     WHERE increment_id = $1 AND NOT ($2::UUID = ANY(COALESCE(hidden_task_ids, ARRAY[]::UUID[])))`,
    [incrementId, taskId]
  );

  const state = await getIncrementState(incrementId);
  return state.hiddenTasks;
}

export async function restoreTasksInIncrement(incrementId: string, taskIds: string[]): Promise<HiddenTask[]> {
  for (const taskId of taskIds) {
    await pool.query(
      `UPDATE delivery_increment_state
       SET hidden_task_ids = array_remove(COALESCE(hidden_task_ids, ARRAY[]::UUID[]), $2::UUID),
       updated_at = CURRENT_TIMESTAMP
       WHERE increment_id = $1`,
      [incrementId, taskId]
    );
  }

  const state = await getIncrementState(incrementId);
  return state.hiddenTasks;
}

// ============ Snapshots ============

export interface SnapshotData {
  taskPositions: {
    taskId: string;
    startCol: number;
    endCol: number;
    row: number;
  }[];
  incrementState: {
    isFrozen: boolean;
    hiddenTaskIds: string[];
    frozenAt: string | null;
  };
}

export interface Snapshot {
  id: number;
  incrementId: string;
  snapshotData: SnapshotData;
  createdAt: string;
  /** Optional human-readable label (e.g. "Avant rangement IA"). */
  label: string | null;
}

export async function createSnapshot(incrementId: string, label?: string): Promise<Snapshot> {
  const positions = await getTaskPositions(incrementId);
  const state = await getIncrementState(incrementId);

  const snapshotData: SnapshotData = {
    taskPositions: positions.map(p => ({
      taskId: p.taskId,
      startCol: p.startCol,
      endCol: p.endCol,
      row: p.row,
    })),
    incrementState: {
      isFrozen: state.isFrozen,
      hiddenTaskIds: state.hiddenTaskIds,
      frozenAt: state.frozenAt ? state.frozenAt.toISOString() : null,
    },
  };

  const result = await pool.query(
    `INSERT INTO delivery_snapshots (increment_id, snapshot_data, label)
     VALUES ($1, $2, $3)
     RETURNING id, increment_id, snapshot_data, created_at, label`,
    [incrementId, JSON.stringify(snapshotData), label ?? null]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    incrementId: row.increment_id,
    snapshotData: row.snapshot_data,
    createdAt: row.created_at.toISOString(),
    label: row.label ?? null,
  };
}

export async function getSnapshots(incrementId: string): Promise<Snapshot[]> {
  const result = await pool.query(
    `SELECT id, increment_id, snapshot_data, created_at, label
     FROM delivery_snapshots
     WHERE increment_id = $1
     ORDER BY created_at DESC LIMIT 10`,
    [incrementId]
  );

  return result.rows.map(row => ({
    id: row.id,
    incrementId: row.increment_id,
    snapshotData: row.snapshot_data,
    createdAt: row.created_at.toISOString(),
    label: row.label ?? null,
  }));
}

export async function getSnapshotById(snapshotId: number): Promise<Snapshot | null> {
  const result = await pool.query(
    'SELECT id, increment_id, snapshot_data, created_at, label FROM delivery_snapshots WHERE id = $1',
    [snapshotId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    incrementId: row.increment_id,
    snapshotData: row.snapshot_data,
    createdAt: row.created_at.toISOString(),
    label: row.label ?? null,
  };
}

export async function restoreFromSnapshot(snapshotId: number): Promise<void> {
  const snapshot = await getSnapshotById(snapshotId);
  if (!snapshot) {
    throw new Error('Snapshot not found');
  }

  const { incrementId, snapshotData } = snapshot;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Restore positions
    await client.query(
      'DELETE FROM delivery_positions WHERE increment_id = $1',
      [incrementId]
    );

    for (const pos of snapshotData.taskPositions) {
      await client.query(
        `INSERT INTO delivery_positions (task_id, increment_id, start_col, end_col, row, updated_at)
         VALUES ($1::UUID, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [pos.taskId, incrementId, pos.startCol, pos.endCol, pos.row]
      );
    }

    // Restore increment state
    await client.query(
      `UPDATE delivery_increment_state
       SET is_frozen = $2,
           hidden_task_ids = $3,
           frozen_at = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE increment_id = $1`,
      [
        incrementId,
        snapshotData.incrementState.isFrozen,
        snapshotData.incrementState.hiddenTaskIds,
        snapshotData.incrementState.frozenAt,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDailySnapshot(incrementId: string): Promise<boolean> {
  // Check if a snapshot was created today
  const result = await pool.query(
    `SELECT 1 FROM delivery_snapshots
     WHERE increment_id = $1 AND created_at::date = CURRENT_DATE`,
    [incrementId]
  );

  if (result.rows.length === 0) {
    await createSnapshot(incrementId);
    return true;
  }
  return false;
}

// ============ Boards CRUD ============

export type BoardType = 'agile' | 'calendaire';

export interface BoardRow {
  id: string;
  userId: number;
  name: string;
  description: string | null;
  boardType: BoardType;
  startDate: string | null;
  endDate: string | null;
  durationWeeks: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Format a Date created by the pg driver from a DATE column.
 * The pg driver parses DATE values into `new Date(year, month, day)` using
 * the SERVER's local timezone. We must read back with local getters (not
 * toISOString which converts to UTC and can shift the date by −1 day in
 * timezones east of UTC like France CEST).
 */
function formatPgDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mapBoardRow(row: Record<string, unknown>): BoardRow {
  return {
    id: row.id as string,
    userId: row.user_id as number,
    name: row.name as string,
    description: (row.description as string) ?? null,
    boardType: (row.board_type as BoardType) ?? 'agile',
    startDate: row.start_date ? formatPgDate(row.start_date as Date) : null,
    endDate: row.end_date ? formatPgDate(row.end_date as Date) : null,
    durationWeeks: (row.duration_weeks as number) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function getAllBoards(userId: number, isAdmin?: boolean): Promise<BoardRow[]> {
  if (isAdmin) {
    const result = await pool.query('SELECT * FROM delivery_boards ORDER BY created_at DESC');
    return result.rows.map(mapBoardRow);
  }
  const result = await pool.query(
    `SELECT DISTINCT b.* FROM delivery_boards b
     LEFT JOIN resource_sharing rs ON rs.resource_type = 'delivery' AND rs.resource_id = b.id::text
     LEFT JOIN resource_shares rsh ON rsh.resource_type = 'delivery' AND rsh.resource_id = b.id::text AND rsh.shared_with_user_id = $1
     WHERE b.user_id = $1 OR rs.visibility = 'public' OR rsh.id IS NOT NULL
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows.map(mapBoardRow);
}

/** Public variant — returns ALL boards without user filtering.
 *  Used by the Figma plugin which doesn't authenticate. */
export async function getAllBoardsPublic(): Promise<Array<{ id: string; name: string; boardType: string; startDate: string | null; endDate: string | null; durationWeeks: number | null }>> {
  const result = await pool.query('SELECT id, name, board_type, start_date, end_date, duration_weeks FROM delivery_boards ORDER BY name');
  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
    boardType: ((row.board_type as string) ?? 'agile'),
    startDate: row.start_date ? formatPgDate(row.start_date as Date) : null,
    endDate: row.end_date ? formatPgDate(row.end_date as Date) : null,
    durationWeeks: (row.duration_weeks as number) ?? null,
  }));
}

export async function getBoardById(id: string): Promise<BoardRow | null> {
  const result = await pool.query('SELECT * FROM delivery_boards WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return mapBoardRow(result.rows[0]);
}

export async function createBoard(
  userId: number,
  name: string,
  description?: string | null,
  boardType: BoardType = 'agile',
  startDate?: string | null,
  endDate?: string | null,
  durationWeeks?: number | null,
): Promise<BoardRow> {
  const result = await pool.query(
    `INSERT INTO delivery_boards (user_id, name, description, board_type, start_date, end_date, duration_weeks)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, name, description ?? null, boardType, startDate ?? null, endDate ?? null, durationWeeks ?? null]
  );
  return mapBoardRow(result.rows[0]);
}

export async function updateBoard(id: string, data: {
  name?: string;
  description?: string | null;
  boardType?: BoardType;
  startDate?: string | null;
  endDate?: string | null;
  durationWeeks?: number | null;
}): Promise<BoardRow> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
  if (data.boardType !== undefined) { fields.push(`board_type = $${idx++}`); values.push(data.boardType); }
  if (data.startDate !== undefined) { fields.push(`start_date = $${idx++}`); values.push(data.startDate); }
  if (data.endDate !== undefined) { fields.push(`end_date = $${idx++}`); values.push(data.endDate); }
  if (data.durationWeeks !== undefined) { fields.push(`duration_weeks = $${idx++}`); values.push(data.durationWeeks); }
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query(
    `UPDATE delivery_boards SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (result.rows.length === 0) throw new Error('Board not found');
  return mapBoardRow(result.rows[0]);
}

export async function deleteBoard(id: string): Promise<void> {
  await pool.query('DELETE FROM delivery_boards WHERE id = $1', [id]);
}

// ============ Init ============

export async function initDeliveryDb(): Promise<void> {
  // Auto-migration: create missing tables and add new columns (for existing DBs)
  try {
    // Ensure delivery_boards exists (introduced in 13_delivery_boards_schema.sql)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS delivery_boards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_delivery_boards_user ON delivery_boards(user_id)`);
    // Existing delivery_boards tables need explicit ALTER for columns added
    // after initial schema creation (CREATE TABLE IF NOT EXISTS is a no-op
    // when the table already exists).
    await pool.query(`ALTER TABLE delivery_boards ADD COLUMN IF NOT EXISTS description TEXT`);
    await pool.query(`ALTER TABLE delivery_boards ADD COLUMN IF NOT EXISTS board_type VARCHAR(20) DEFAULT 'agile'`);
    await pool.query(`ALTER TABLE delivery_boards ADD COLUMN IF NOT EXISTS start_date DATE`);
    await pool.query(`ALTER TABLE delivery_boards ADD COLUMN IF NOT EXISTS end_date DATE`);
    await pool.query(`ALTER TABLE delivery_boards ADD COLUMN IF NOT EXISTS duration_weeks INTEGER`);
    // Backfill existing boards with default agile config (6 weeks, matching
    // the old inc1 = 42 days model, starting 2026-01-19).
    await pool.query(`
      UPDATE delivery_boards
      SET board_type = 'agile', start_date = '2026-01-19',
          end_date = '2026-01-19'::date + INTERVAL '42 days',
          duration_weeks = 6
      WHERE start_date IS NULL
    `);

    await pool.query(`ALTER TABLE delivery_tasks ADD COLUMN IF NOT EXISTS source VARCHAR(10) DEFAULT 'manual'`);
    await pool.query(`ALTER TABLE delivery_tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES delivery_tasks(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE delivery_tasks ADD COLUMN IF NOT EXISTS description TEXT`);
    await pool.query(`ALTER TABLE delivery_positions ADD COLUMN IF NOT EXISTS row_span INTEGER NOT NULL DEFAULT 1`);
    await pool.query(`ALTER TABLE delivery_snapshots ADD COLUMN IF NOT EXISTS label VARCHAR(100)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_delivery_tasks_parent ON delivery_tasks(parent_task_id)`);
    // Backfill source for existing Jira tasks
    await pool.query(`UPDATE delivery_tasks SET source = 'jira' WHERE sprint_name IS NOT NULL AND source = 'manual'`);
  } catch (err) {
    // Columns may already exist — ignore errors
    console.warn('[Delivery] Migration note:', (err as Error).message);
  }
  // Backfill resource_sharing entries for existing boards
  try {
    const { ensureOwnership } = await import('../shared/resourceSharing.js');
    const boards = await pool.query('SELECT id, user_id FROM delivery_boards');
    for (const b of boards.rows) {
      await ensureOwnership('delivery', String(b.id), b.user_id, 'private');
    }
  } catch { /* sharing table may not exist yet */ }

  console.log('[Delivery] Database service initialized');
}
