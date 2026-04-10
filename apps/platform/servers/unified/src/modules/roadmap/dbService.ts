import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export async function initPool() {
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  try {
    await pool.query('SELECT 1');
    console.log('[Roadmap] Database connected');
  } catch (err) {
    console.error('[Roadmap] Database connection failed:', err);
    throw err;
  }
}

// Types
export interface Planning {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  planningId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  color: string;
  progress: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Dependency {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  type: string;
  createdAt: string;
}

export interface Marker {
  id: string;
  planningId: string;
  name: string;
  markerDate: string;
  color: string;
  type: string;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatDate(date: Date | string | null): string {
  if (!date) return '';
  if (typeof date === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const parsed = new Date(date);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return date;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatPlanning(row: any): Planning {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startDate: formatDate(row.start_date),
    endDate: formatDate(row.end_date),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function formatTask(row: any): Task {
  return {
    id: row.id,
    planningId: row.planning_id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
    startDate: formatDate(row.start_date),
    endDate: formatDate(row.end_date),
    color: row.color,
    progress: row.progress,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function formatMarker(row: any): Marker {
  return {
    id: row.id,
    planningId: row.planning_id,
    name: row.name,
    markerDate: formatDate(row.marker_date),
    color: row.color,
    type: row.type,
    taskId: row.task_id || null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ==================== PLANNINGS ====================

export async function getAllPlannings(): Promise<Planning[]> {
  const result = await pool.query('SELECT * FROM roadmap_plannings ORDER BY created_at DESC');
  return result.rows.map(formatPlanning);
}

export async function getPlanningById(id: string): Promise<Planning | null> {
  const result = await pool.query('SELECT * FROM roadmap_plannings WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return formatPlanning(result.rows[0]);
}

export async function createPlanning(name: string, startDate: string, endDate: string, description?: string): Promise<Planning> {
  const result = await pool.query(
    `INSERT INTO roadmap_plannings (name, description, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, description || null, startDate, endDate]
  );
  return formatPlanning(result.rows[0]);
}

export async function updatePlanning(id: string, data: Partial<{ name: string; description: string; startDate: string; endDate: string }>): Promise<Planning | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (data.name !== undefined) { updates.push(`name = $${p++}`); values.push(data.name); }
  if (data.description !== undefined) { updates.push(`description = $${p++}`); values.push(data.description); }
  if (data.startDate !== undefined) { updates.push(`start_date = $${p++}`); values.push(data.startDate); }
  if (data.endDate !== undefined) { updates.push(`end_date = $${p++}`); values.push(data.endDate); }

  if (updates.length === 0) return getPlanningById(id);
  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query(`UPDATE roadmap_plannings SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`, values);
  if (result.rows.length === 0) return null;
  return formatPlanning(result.rows[0]);
}

export async function deletePlanning(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM roadmap_plannings WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}

// ==================== TASKS ====================

export async function getTasksByPlanning(planningId: string): Promise<Task[]> {
  const result = await pool.query('SELECT * FROM roadmap_tasks WHERE planning_id = $1 ORDER BY sort_order, created_at', [planningId]);
  return result.rows.map(formatTask);
}

export async function getTaskById(id: string): Promise<Task | null> {
  const result = await pool.query('SELECT * FROM roadmap_tasks WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return formatTask(result.rows[0]);
}

export async function createTask(
  planningId: string, name: string, startDate: string, endDate: string,
  data?: Partial<{ parentId: string; description: string; color: string; progress: number; sortOrder: number }>
): Promise<Task> {
  const result = await pool.query(
    `INSERT INTO roadmap_tasks (planning_id, parent_id, name, description, start_date, end_date, color, progress, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [planningId, data?.parentId || null, name, data?.description || null, startDate, endDate, data?.color || '#00bcd4', data?.progress || 0, data?.sortOrder || 0]
  );
  return formatTask(result.rows[0]);
}

export async function updateTask(id: string, data: Partial<{ name: string; description: string; startDate: string; endDate: string; color: string; progress: number; sortOrder: number; parentId: string | null }>): Promise<Task | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (data.name !== undefined) { updates.push(`name = $${p++}`); values.push(data.name); }
  if (data.description !== undefined) { updates.push(`description = $${p++}`); values.push(data.description); }
  if (data.startDate !== undefined) { updates.push(`start_date = $${p++}`); values.push(data.startDate); }
  if (data.endDate !== undefined) { updates.push(`end_date = $${p++}`); values.push(data.endDate); }
  if (data.color !== undefined) { updates.push(`color = $${p++}`); values.push(data.color); }
  if (data.progress !== undefined) { updates.push(`progress = $${p++}`); values.push(data.progress); }
  if (data.sortOrder !== undefined) { updates.push(`sort_order = $${p++}`); values.push(data.sortOrder); }
  if (data.parentId !== undefined) { updates.push(`parent_id = $${p++}`); values.push(data.parentId); }

  if (updates.length === 0) return getTaskById(id);
  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query(`UPDATE roadmap_tasks SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`, values);
  if (result.rows.length === 0) return null;
  return formatTask(result.rows[0]);
}

export async function deleteTask(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM roadmap_tasks WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}

// ==================== DEPENDENCIES ====================

export async function getDependenciesByPlanning(planningId: string): Promise<Dependency[]> {
  const result = await pool.query(
    `SELECT d.* FROM roadmap_dependencies d JOIN roadmap_tasks t ON d.from_task_id = t.id WHERE t.planning_id = $1`,
    [planningId]
  );
  return result.rows.map(row => ({
    id: row.id, fromTaskId: row.from_task_id, toTaskId: row.to_task_id, type: row.type, createdAt: row.created_at.toISOString(),
  }));
}

export async function createDependency(fromTaskId: string, toTaskId: string, type: string = 'finish-to-start'): Promise<Dependency> {
  const result = await pool.query(
    `INSERT INTO roadmap_dependencies (from_task_id, to_task_id, type) VALUES ($1, $2, $3) RETURNING *`,
    [fromTaskId, toTaskId, type]
  );
  const row = result.rows[0];
  return { id: row.id, fromTaskId: row.from_task_id, toTaskId: row.to_task_id, type: row.type, createdAt: row.created_at.toISOString() };
}

export async function deleteDependency(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM roadmap_dependencies WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}

// ==================== MARKERS ====================

export async function getMarkersByPlanning(planningId: string): Promise<Marker[]> {
  const result = await pool.query('SELECT * FROM roadmap_markers WHERE planning_id = $1 ORDER BY marker_date', [planningId]);
  return result.rows.map(formatMarker);
}

export async function createMarker(planningId: string, name: string, markerDate: string, color?: string, type?: string): Promise<Marker> {
  const result = await pool.query(
    `INSERT INTO roadmap_markers (planning_id, name, marker_date, color, type) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [planningId, name, markerDate, color || '#f59e0b', type || 'milestone']
  );
  return formatMarker(result.rows[0]);
}

export async function updateMarker(id: string, data: Partial<{ name: string; markerDate: string; color: string; type: string; taskId: string | null }>): Promise<Marker | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (data.name !== undefined) { updates.push(`name = $${p++}`); values.push(data.name); }
  if (data.markerDate !== undefined) { updates.push(`marker_date = $${p++}`); values.push(data.markerDate); }
  if (data.color !== undefined) { updates.push(`color = $${p++}`); values.push(data.color); }
  if (data.type !== undefined) { updates.push(`type = $${p++}`); values.push(data.type); }
  if (data.taskId !== undefined) { updates.push(`task_id = $${p++}`); values.push(data.taskId); }

  if (updates.length === 0) return null;
  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query(`UPDATE roadmap_markers SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`, values);
  if (result.rows.length === 0) return null;
  return formatMarker(result.rows[0]);
}

export async function deleteMarker(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM roadmap_markers WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}

// ==================== TASK-SUBJECT LINKS ====================

export interface LinkedSubject {
  id: string;
  title: string;
  status: string;
  situation: string | null;
  responsibility: string | null;
  section_id: string;
  section_name: string;
  document_id: string;
  document_title: string;
}

export async function getLinkedSubjects(taskId: string): Promise<LinkedSubject[]> {
  const result = await pool.query(
    `SELECT
      sub.id,
      sub.title,
      sub.status,
      sub.situation,
      sub.responsibility,
      sec.id     AS section_id,
      sec.name   AS section_name,
      doc.id     AS document_id,
      doc.title  AS document_title
     FROM roadmap_task_subjects rts
     JOIN suivitess_subjects  sub ON rts.subject_id = sub.id
     JOIN suivitess_sections  sec ON sub.section_id  = sec.id
     JOIN suivitess_documents doc ON sec.document_id = doc.id
     WHERE rts.task_id = $1
     ORDER BY doc.title, sec.name, sub.title`,
    [taskId]
  );
  return result.rows;
}

export async function linkSubject(taskId: string, subjectId: string): Promise<void> {
  await pool.query(
    'INSERT INTO roadmap_task_subjects (task_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [taskId, subjectId]
  );
}

export async function unlinkSubject(taskId: string, subjectId: string): Promise<void> {
  await pool.query(
    'DELETE FROM roadmap_task_subjects WHERE task_id = $1 AND subject_id = $2',
    [taskId, subjectId]
  );
}

export async function ensureTaskSubjectsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roadmap_task_subjects (
      task_id    UUID NOT NULL,
      subject_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (task_id, subject_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rts_task ON roadmap_task_subjects(task_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rts_subject ON roadmap_task_subjects(subject_id)');
}

// ==================== PLANNING-DELIVERY BOARD LINKS ====================

export interface LinkedDeliveryBoard {
  id: string;
  name: string;
  createdAt: string;
}

export async function ensurePlanningDeliveryBoardsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roadmap_planning_delivery_boards (
      planning_id UUID NOT NULL,
      board_id    UUID NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (planning_id, board_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rpdb_planning ON roadmap_planning_delivery_boards(planning_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rpdb_board    ON roadmap_planning_delivery_boards(board_id)');
}

export async function getLinkedBoards(planningId: string): Promise<LinkedDeliveryBoard[]> {
  const result = await pool.query(
    `SELECT b.id, b.name, rpdb.created_at
       FROM roadmap_planning_delivery_boards rpdb
       JOIN delivery_boards b ON b.id = rpdb.board_id
      WHERE rpdb.planning_id = $1
      ORDER BY b.name`,
    [planningId]
  );
  return result.rows.map((row: { id: string; name: string; created_at: Date }) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function linkBoard(planningId: string, boardId: string): Promise<void> {
  await pool.query(
    'INSERT INTO roadmap_planning_delivery_boards (planning_id, board_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [planningId, boardId]
  );
}

export async function unlinkBoard(planningId: string, boardId: string): Promise<void> {
  await pool.query(
    'DELETE FROM roadmap_planning_delivery_boards WHERE planning_id = $1 AND board_id = $2',
    [planningId, boardId]
  );
}

/**
 * Raw fetch of all tasks belonging to a board, joined with their grid position.
 * Returns rows shaped for `deriveOverlayTasks`.
 *
 * A board id is a UUID (no underscores); increment_id is formatted as
 * `${boardId}_inc1`, `${boardId}_inc2`, ... The LIKE pattern with ESCAPE
 * guarantees we only match increments of this exact board.
 */
export async function getRawDeliveryTasksForBoard(boardId: string): Promise<{
  boardName: string;
  boardConfig: {
    boardType: 'agile' | 'calendaire';
    startDate: string;
    endDate: string;
    durationWeeks: number | null;
  } | null;
  tasks: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    source: 'manual' | 'jira';
    incrementId: string;
    parentTaskId: string | null;
    startCol: number | null;
    endCol: number | null;
  }>;
}> {
  // Board info (name + config for overlay date derivation)
  const boardResult = await pool.query(
    'SELECT name, board_type, start_date, end_date, duration_weeks FROM delivery_boards WHERE id = $1',
    [boardId]
  );
  if (boardResult.rows.length === 0) {
    return { boardName: '', boardConfig: null, tasks: [] };
  }
  const row = boardResult.rows[0];
  const boardName = row.name as string;
  // Use local getters (not toISOString) because the pg driver creates Date
  // objects in the server's local timezone for DATE columns. In France
  // (CEST, UTC+2) toISOString would shift April 1 back to March 31.
  const pgDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const boardConfig = {
    boardType: (row.board_type as 'agile' | 'calendaire') ?? 'agile',
    startDate: row.start_date ? pgDate(row.start_date as Date) : '2026-01-19',
    endDate: row.end_date ? pgDate(row.end_date as Date) : '2026-03-02',
    durationWeeks: (row.duration_weeks as number) ?? null,
  };

  // Tasks + positions. LEFT JOIN because a task may not have a grid position.
  // parent_task_id lets us reconstruct the delivery container → child relation
  // (manual task containing Jira tickets, 1 level deep).
  const result = await pool.query(
    `SELECT
        t.id, t.title, t.type, t.status, t.source, t.increment_id,
        t.parent_task_id,
        p.start_col, p.end_col
       FROM delivery_tasks t
       LEFT JOIN delivery_positions p
         ON p.task_id = t.id AND p.increment_id = t.increment_id
      WHERE t.increment_id = $1 OR t.increment_id LIKE $2 ESCAPE '\\'
      ORDER BY t.increment_id, t.created_at`,
    [boardId, `${boardId}\\_%`]
  );

  const tasks = result.rows.map((row: {
    id: string;
    title: string;
    type: string;
    status: string;
    source: string;
    increment_id: string;
    parent_task_id: string | null;
    start_col: number | null;
    end_col: number | null;
  }) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    source: (row.source === 'jira' ? 'jira' : 'manual') as 'manual' | 'jira',
    incrementId: row.increment_id,
    parentTaskId: row.parent_task_id,
    startCol: row.start_col,
    endCol: row.end_col,
  }));

  return { boardName, boardConfig, tasks };
}

/**
 * List all delivery boards (used by the planning form to offer a selector).
 * We intentionally keep this inside roadmap's dbService so the route can
 * avoid a cross-module HTTP round-trip.
 */
export async function getAllDeliveryBoards(): Promise<Array<{ id: string; name: string }>> {
  const result = await pool.query(
    'SELECT id, name FROM delivery_boards ORDER BY name'
  );
  return result.rows.map((row: { id: string; name: string }) => ({
    id: row.id,
    name: row.name,
  }));
}
