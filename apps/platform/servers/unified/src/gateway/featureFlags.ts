import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { logger } from './logger.js';

const CACHE_TTL_MS = 30_000;

let pool: Pool | null = null;
let cache = new Map<string, boolean>();
let cacheLoadedAt = 0;

export function initFeatureFlags(dbPool: Pool): void {
  pool = dbPool;
  cacheLoadedAt = 0;
  cache = new Map();
}

async function loadFlags(): Promise<void> {
  if (!pool) return;
  try {
    const res = await pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM platform_settings'
    );
    const next = new Map<string, boolean>();
    for (const row of res.rows) next.set(row.key, row.value === 'true');
    cache = next;
    cacheLoadedAt = Date.now();
  } catch (err) {
    logger.warn('featureFlags.load.failed', { error: (err as Error).message });
  }
}

async function ensureFresh(): Promise<void> {
  if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return;
  await loadFlags();
}

/** Fail-open: a key that doesn't exist in the table is considered
 *  enabled. Only an explicit `'false'` value disables the feature.
 *  Rationale — a missing row is often just a new feature that hasn't
 *  been seeded yet, and blocking it by default would break deploys. */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  await ensureFresh();
  return cache.get(key) !== false;
}

/** Middleware guard: respond 503 if the named feature flag is disabled.
 *  Attach to a module's base router when you want admins to be able to
 *  turn it off globally without a redeploy. */
export function requireFeature(key: string): RequestHandler {
  return async (_req, res, next) => {
    const enabled = await isFeatureEnabled(key);
    if (!enabled) {
      res.status(503).json({ error: `Fonctionnalite desactivee (${key}).` });
      return;
    }
    next();
  };
}

// For tests — bypass the cache and force a specific state.
export function __setFeatureFlagForTests(key: string, value: boolean): void {
  cache.set(key, value);
  cacheLoadedAt = Date.now();
}
