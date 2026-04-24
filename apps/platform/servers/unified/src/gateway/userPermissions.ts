import type { Pool } from 'pg';
import { logger } from './logger.js';

const CACHE_TTL_MS = 30_000;

let pool: Pool | null = null;
const cache = new Map<number, { perms: Set<string>; loadedAt: number }>();

export function initUserPermissions(dbPool: Pool): void {
  pool = dbPool;
  cache.clear();
}

async function loadPermissions(userId: number): Promise<Set<string>> {
  if (!pool) return new Set();
  try {
    const res = await pool.query<{ app_id: string }>(
      'SELECT app_id FROM user_permissions WHERE user_id = $1',
      [userId]
    );
    return new Set(res.rows.map(r => r.app_id));
  } catch (err) {
    logger.warn('userPermissions.load.failed', { userId, error: (err as Error).message });
    return new Set();
  }
}

/** Return true if `userId` has the named app permission. Results are
 *  cached per-user for CACHE_TTL_MS to avoid hammering `user_permissions`
 *  on every role-gated request. Admins are NOT auto-granted here —
 *  that bypass lives in `accessControl.requireRole` so tests can
 *  exercise both code paths independently. */
export async function userHasPermission(userId: number, permission: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.perms.has(permission);
  }
  const perms = await loadPermissions(userId);
  cache.set(userId, { perms, loadedAt: now });
  return perms.has(permission);
}

// Tests — seed the cache without a DB roundtrip.
export function __setUserPermissionsForTests(userId: number, perms: string[]): void {
  cache.set(userId, { perms: new Set(perms), loadedAt: Date.now() });
}
