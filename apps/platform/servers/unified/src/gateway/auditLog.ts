import type { Request, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { logger } from './logger.js';

let pool: Pool | null = null;

export function initAuditLog(dbPool: Pool): void {
  pool = dbPool;
}

export interface AuditDetails {
  /** Short verb: 'delete.document', 'share.planning', 'reset.skill', ... */
  action: string;
  resourceType?: string;
  resourceId?: string;
}

/** Record a security-relevant action. Always emits a structured log
 *  line (so events survive DB outages), and fire-and-forgets a DB
 *  insert into `gateway_audit_log` when the pool is wired. Safe to
 *  call from any handler — never throws. */
export function audit(req: Request, details: AuditDetails, extra: Record<string, unknown> = {}): void {
  const entry = {
    reqId: req.requestId ?? null,
    userId: req.user?.id ?? null,
    ip: req.ip ?? null,
    ua: req.headers['user-agent'] ?? null,
    ...details,
    at: new Date().toISOString(),
  };
  logger.info('audit', { ...entry, extra });

  if (!pool) return;
  pool.query(
    `INSERT INTO gateway_audit_log
       (request_id, user_id, action, resource_type, resource_id, ip, user_agent, extra, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      entry.reqId,
      entry.userId,
      entry.action,
      entry.resourceType ?? null,
      entry.resourceId ?? null,
      entry.ip,
      entry.ua,
      JSON.stringify(extra),
    ]
  ).catch(err => logger.warn('audit.persist.failed', { error: (err as Error).message }));
}

/** Declarative helper: attach to a route so that on a successful
 *  response (< 400), an audit record is written automatically. The
 *  details can be static or computed from the request (to pull the
 *  resource ID out of `req.params`, for instance). */
export function withAudit(details: AuditDetails | ((req: Request) => AuditDetails)): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const d = typeof details === 'function' ? details(req) : details;
      audit(req, d);
    });
    next();
  };
}
