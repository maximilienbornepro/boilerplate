/**
 * Centralized resource sharing helper.
 * Handles ownership, visibility (public/private), and per-user sharing
 * for roadmap plannings, delivery boards, and suivitess documents.
 *
 * Tables: resource_sharing (ownership + visibility), resource_shares (per-user).
 * Auto-creates tables at first call (idempotent).
 */

import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export async function initSharingPool() {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  // Auto-create tables (idempotent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resource_sharing (
      id SERIAL PRIMARY KEY,
      resource_type VARCHAR(20) NOT NULL,
      resource_id VARCHAR(100) NOT NULL,
      owner_id INTEGER NOT NULL,
      visibility VARCHAR(10) NOT NULL DEFAULT 'private',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(resource_type, resource_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resource_shares (
      id SERIAL PRIMARY KEY,
      resource_type VARCHAR(20) NOT NULL,
      resource_id VARCHAR(100) NOT NULL,
      shared_with_user_id INTEGER NOT NULL,
      shared_by_user_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(resource_type, resource_id, shared_with_user_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rs_type_id ON resource_sharing(resource_type, resource_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rs_owner ON resource_sharing(owner_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rsh_user ON resource_shares(shared_with_user_id)');

  console.log('[Sharing] Tables initialized');
}

export type ResourceType = 'roadmap' | 'delivery' | 'suivitess';

// ── Ownership + Visibility ────────────────────────────────────────────

export async function ensureOwnership(
  resourceType: ResourceType,
  resourceId: string,
  ownerId: number,
  visibility: 'private' | 'public' = 'private'
): Promise<void> {
  await pool.query(
    `INSERT INTO resource_sharing (resource_type, resource_id, owner_id, visibility)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (resource_type, resource_id) DO NOTHING`,
    [resourceType, resourceId, ownerId, visibility]
  );
}

export async function setVisibility(
  resourceType: ResourceType,
  resourceId: string,
  visibility: 'private' | 'public'
): Promise<void> {
  await pool.query(
    `UPDATE resource_sharing SET visibility = $3, updated_at = NOW()
     WHERE resource_type = $1 AND resource_id = $2`,
    [resourceType, resourceId, visibility]
  );
}

export async function getResourceSharing(
  resourceType: ResourceType,
  resourceId: string
): Promise<{ ownerId: number; visibility: string; shares: Array<{ userId: number; email: string }> } | null> {
  const ownerResult = await pool.query(
    'SELECT owner_id, visibility FROM resource_sharing WHERE resource_type = $1 AND resource_id = $2',
    [resourceType, resourceId]
  );
  if (ownerResult.rows.length === 0) return null;

  const sharesResult = await pool.query(
    `SELECT rs.shared_with_user_id AS user_id, u.email
     FROM resource_shares rs
     JOIN users u ON u.id = rs.shared_with_user_id
     WHERE rs.resource_type = $1 AND rs.resource_id = $2
     ORDER BY u.email`,
    [resourceType, resourceId]
  );

  return {
    ownerId: ownerResult.rows[0].owner_id as number,
    visibility: ownerResult.rows[0].visibility as string,
    shares: sharesResult.rows.map((r: { user_id: number; email: string }) => ({
      userId: r.user_id,
      email: r.email,
    })),
  };
}

// ── Per-user sharing ──────────────────────────────────────────────────

export async function shareWithEmail(
  resourceType: ResourceType,
  resourceId: string,
  email: string,
  sharedByUserId: number
): Promise<{ success: boolean; error?: string }> {
  // Find user by email
  const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (userResult.rows.length === 0) {
    return { success: false, error: `Utilisateur "${email}" non trouvé` };
  }
  const targetUserId = userResult.rows[0].id as number;

  await pool.query(
    `INSERT INTO resource_shares (resource_type, resource_id, shared_with_user_id, shared_by_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [resourceType, resourceId, targetUserId, sharedByUserId]
  );
  return { success: true };
}

export async function unshare(
  resourceType: ResourceType,
  resourceId: string,
  userId: number
): Promise<void> {
  await pool.query(
    'DELETE FROM resource_shares WHERE resource_type = $1 AND resource_id = $2 AND shared_with_user_id = $3',
    [resourceType, resourceId, userId]
  );
}

// ── Access control ────────────────────────────────────────────────────

/**
 * Check if a user can access a resource.
 * Order: owner → public → shared → admin → denied.
 */
export async function canUserAccess(
  userId: number,
  isAdmin: boolean,
  resourceType: ResourceType,
  resourceId: string
): Promise<boolean> {
  if (isAdmin) return true;

  const result = await pool.query(
    `SELECT owner_id, visibility FROM resource_sharing
     WHERE resource_type = $1 AND resource_id = $2`,
    [resourceType, resourceId]
  );

  if (result.rows.length === 0) return true; // No sharing entry → legacy, allow all

  const { owner_id, visibility } = result.rows[0];
  if (owner_id === userId) return true;
  if (visibility === 'public') return true;

  // Check shares
  const shareResult = await pool.query(
    `SELECT 1 FROM resource_shares
     WHERE resource_type = $1 AND resource_id = $2 AND shared_with_user_id = $3`,
    [resourceType, resourceId, userId]
  );
  return shareResult.rows.length > 0;
}

/**
 * Get all resource IDs a user can access for a given type.
 * Used by list endpoints to filter results.
 */
export async function getVisibleResourceIds(
  userId: number,
  isAdmin: boolean,
  resourceType: ResourceType
): Promise<string[] | 'all'> {
  if (isAdmin) return 'all';

  const result = await pool.query(
    `SELECT DISTINCT resource_id FROM (
       SELECT resource_id FROM resource_sharing
       WHERE resource_type = $1 AND (owner_id = $2 OR visibility = 'public')
       UNION
       SELECT resource_id FROM resource_shares
       WHERE resource_type = $1 AND shared_with_user_id = $2
     ) accessible`,
    [resourceType, userId]
  );

  return result.rows.map((r: { resource_id: string }) => r.resource_id);
}

// ── Bulk operations (for backfill) ────────────────────────────────────

export async function backfillOwnership(
  resourceType: ResourceType,
  items: Array<{ id: string; ownerId: number }>
): Promise<number> {
  let count = 0;
  for (const item of items) {
    await ensureOwnership(resourceType, item.id, item.ownerId);
    count++;
  }
  return count;
}
