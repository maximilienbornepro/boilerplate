import express, { type Application } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { Pool } from 'pg';

import { requestContext } from './requestContext.js';
import { accessLog } from './accessLog.js';
import { metricsCollector, metricsEndpoint } from './metrics.js';
import { healthCheck, initHealthCheck } from './healthCheck.js';
import { initAccessControl } from './accessControl.js';
import { initFeatureFlags } from './featureFlags.js';
import { initAuditLog } from './auditLog.js';
import { logger } from './logger.js';

// Public API of the gateway package.
export { route } from './accessControl.js';
export type { AccessTier, RouteOptions } from './accessControl.js';
export { logger, reqLogger } from './logger.js';
export { requireFeature, isFeatureEnabled } from './featureFlags.js';
export { audit, withAudit } from './auditLog.js';
export type { AuditDetails } from './auditLog.js';
export { onShutdown, installShutdownHandlers } from './gracefulShutdown.js';
export { getRateLimiter, getRateLimitConfig } from './rateLimits.js';
export type { RateLimitTier } from './rateLimits.js';

export interface GatewayBaseOptions {
  cors: CorsOptions;
}

/** Mount the gateway's cross-cutting middlewares, in order:
 *    helmet → CORS → requestContext → body parser → cookies →
 *    accessLog → metricsCollector.
 *  Call once, BEFORE any application route is registered. After this,
 *  every route automatically gets: request-id header round-trip,
 *  structured HTTP logging, metrics counters. */
export function applyGatewayBase(app: Application, opts: GatewayBaseOptions): void {
  app.use(helmet({
    // Relaxed because the SPA + Chrome extension enforce their own
    // CSPs and several features (Jira OAuth redirect, email
    // connectors, embed iframes) reach third-party domains. HSTS +
    // noSniff + frameguard are the concrete protections we keep.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'sameorigin' },
  }));
  app.use(cors(opts.cors));
  app.use(requestContext);
  // Global hard cap matches the largest legitimate payload (admin
  // imports). Per-tier soft caps are applied via `route({ tier })`
  // and reject earlier for non-admin tiers — see `bodyLimits.ts`.
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());
  app.use(accessLog);
  app.use(metricsCollector);
  logger.info('gateway.base.ready');
}

/** Wire the DB-dependent parts of the gateway. Call once after the PG
 *  pool is created but BEFORE mounting application routes so guards
 *  (embed visibility, feature flags, audit log) have the pool ready. */
export function initGatewayWithPool(pool: Pool): void {
  initAccessControl(pool);
  initFeatureFlags(pool);
  initAuditLog(pool);
  initHealthCheck(pool);
  logger.info('gateway.pool.wired');
}

/** Mount the gateway's admin endpoints. Kept separate so the caller
 *  controls the URL prefix and can add more cross-cutting endpoints
 *  (e.g. /gateway/version) in one place. */
export function mountGatewayEndpoints(app: Application): void {
  app.get('/gateway/health', healthCheck);
  app.get('/gateway/metrics', metricsEndpoint);
}
