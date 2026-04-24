import type { RequestHandler } from 'express';
import type { Pool } from 'pg';

let pool: Pool | null = null;
const startedAt = Date.now();

export function initHealthCheck(dbPool: Pool): void {
  pool = dbPool;
}

interface HealthCheckEntry {
  status: 'ok' | 'fail';
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeS: number;
  checks: Record<string, HealthCheckEntry>;
  version: string;
  timestamp: string;
}

/** Deep health endpoint for ops tooling. Returns 200 if every dep is
 *  reachable, 503 if a hard dep (DB) is down. `/health` remains the
 *  shallow liveness probe; `/gateway/health` is readiness. */
export const healthCheck: RequestHandler = async (_req, res) => {
  const checks: HealthResponse['checks'] = {};
  let healthy = true;

  if (pool) {
    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      checks.database = { status: 'ok', latencyMs: Date.now() - start };
    } catch (err) {
      checks.database = { status: 'fail', error: (err as Error).message };
      healthy = false;
    }
  }

  const response: HealthResponse = {
    status: healthy ? 'ok' : 'degraded',
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
    checks,
    version: process.env.npm_package_version ?? '1.0.0',
    timestamp: new Date().toISOString(),
  };
  res.status(healthy ? 200 : 503).json(response);
};
