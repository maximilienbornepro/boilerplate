import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export async function initPool() {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  try {
    await pool.query('SELECT 1');
    console.log('[Conges] Database connected');
  } catch (err) {
    console.error('[Conges] Database connection failed:', err);
    throw err;
  }
}

// Types
export interface Member {
  id: number;
  email: string;
  color: string;
  sortOrder: number;
}

export interface Leave {
  id: string;
  memberId: number;
  startDate: string;
  endDate: string;
  startPeriod: 'full' | 'morning' | 'afternoon';
  endPeriod: 'full' | 'morning' | 'afternoon';
  reason: string | null;
  status: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_COLORS = [
  '#00bcd4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#6366f1', '#14b8a6',
];

function formatDate(date: Date | string): string {
  if (typeof date === 'string') {
    return date.split('T')[0];
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatLeave(row: any): Leave {
  return {
    id: row.id,
    memberId: row.member_id,
    startDate: formatDate(row.start_date),
    endDate: formatDate(row.end_date),
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    reason: row.reason,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ==================== MEMBERS (from gateway users) ====================

export async function getCongesUsers(): Promise<Member[]> {
  const result = await pool.query(
    `SELECT u.id, u.email, cup.color, cup.sort_order
     FROM users u
     JOIN user_permissions up ON u.id = up.user_id
     LEFT JOIN conges_user_preferences cup ON u.id = cup.user_id
     WHERE u.is_active = true AND up.app_id = 'conges'
     ORDER BY COALESCE(cup.sort_order, 999), u.email`
  );

  return result.rows.map((row: any, index: number) => ({
    id: row.id,
    email: row.email,
    color: row.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    sortOrder: row.sort_order ?? index,
  }));
}

export async function updateUserPreferences(
  userId: number,
  data: Partial<{ color: string; sortOrder: number }>
): Promise<void> {
  if (data.color === undefined && data.sortOrder === undefined) return;

  await pool.query(
    `INSERT INTO conges_user_preferences (user_id, color, sort_order)
     VALUES ($1, COALESCE($2, '#00bcd4'), COALESCE($3, 0))
     ON CONFLICT (user_id) DO UPDATE SET
       color = COALESCE($2, conges_user_preferences.color),
       sort_order = COALESCE($3, conges_user_preferences.sort_order)`,
    [userId, data.color ?? null, data.sortOrder ?? null]
  );
}

// ==================== LEAVES ====================

export async function getLeavesByPeriod(startDate: string, endDate: string): Promise<Leave[]> {
  const result = await pool.query(
    `SELECT * FROM conges_leaves
     WHERE end_date >= $1 AND start_date <= $2
     ORDER BY start_date`,
    [startDate, endDate]
  );
  return result.rows.map(formatLeave);
}

export async function getLeaveById(id: string): Promise<Leave | null> {
  const result = await pool.query('SELECT * FROM conges_leaves WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return formatLeave(result.rows[0]);
}

export async function createLeave(
  memberId: number,
  startDate: string,
  endDate: string,
  data?: Partial<{
    startPeriod: string;
    endPeriod: string;
    reason: string;
    createdBy: number;
  }>
): Promise<Leave> {
  const result = await pool.query(
    `INSERT INTO conges_leaves (member_id, start_date, end_date, start_period, end_period, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      memberId,
      startDate,
      endDate,
      data?.startPeriod || 'full',
      data?.endPeriod || 'full',
      data?.reason || null,
      data?.createdBy || null,
    ]
  );
  return formatLeave(result.rows[0]);
}

export async function updateLeave(
  id: string,
  data: Partial<{
    startDate: string;
    endDate: string;
    startPeriod: string;
    endPeriod: string;
    reason: string;
  }>
): Promise<Leave | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.startDate !== undefined) { updates.push(`start_date = $${paramIndex++}`); values.push(data.startDate); }
  if (data.endDate !== undefined) { updates.push(`end_date = $${paramIndex++}`); values.push(data.endDate); }
  if (data.startPeriod !== undefined) { updates.push(`start_period = $${paramIndex++}`); values.push(data.startPeriod); }
  if (data.endPeriod !== undefined) { updates.push(`end_period = $${paramIndex++}`); values.push(data.endPeriod); }
  if (data.reason !== undefined) { updates.push(`reason = $${paramIndex++}`); values.push(data.reason); }

  if (updates.length === 0) return getLeaveById(id);

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query(
    `UPDATE conges_leaves SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) return null;
  return formatLeave(result.rows[0]);
}

export async function deleteLeave(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM conges_leaves WHERE id = $1', [id]);
  return (result.rowCount || 0) > 0;
}
