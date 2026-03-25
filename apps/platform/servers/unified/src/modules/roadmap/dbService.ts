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
