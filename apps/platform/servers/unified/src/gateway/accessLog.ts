import type { RequestHandler } from 'express';
import { logger } from './logger.js';

const SLOW_REQUEST_MS = parseInt(process.env.GATEWAY_SLOW_REQUEST_MS ?? '5000', 10);

/** HTTP access log middleware. Emits one entry per request with method,
 *  path, status, duration, reqId, IP, authenticated user ID. Slow
 *  requests (> GATEWAY_SLOW_REQUEST_MS, default 5s) are escalated to
 *  WARN so they surface in log dashboards without extra instrumentation. */
export const accessLog: RequestHandler = (req, res, next) => {
  res.on('finish', () => {
    const duration = Date.now() - (req.startedAt ?? Date.now());
    const fields = {
      reqId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      userId: req.user?.id ?? null,
    };
    if (duration > SLOW_REQUEST_MS) {
      logger.warn('http.slow', { ...fields, thresholdMs: SLOW_REQUEST_MS });
    } else if (res.statusCode >= 500) {
      logger.error('http.error', fields);
    } else {
      logger.info('http', fields);
    }
  });
  next();
};
