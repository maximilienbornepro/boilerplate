import express from 'express';
import pg from 'pg';
import type { CorsOptions } from 'cors';
import { config } from './config.js';
import { errorMiddleware } from '@boilerplate/shared/server';
import {
  applyGatewayBase,
  initGatewayWithPool,
  mountGatewayEndpoints,
  installShutdownHandlers,
  onShutdown,
  logger,
} from './gateway/index.js';

// Import modules
import { initGateway, createGatewayRouter } from './modules/gateway.js';
import { initConges, createCongesRouter } from './modules/conges/index.js';
import { initRoadmap, createRoadmapRouter } from './modules/roadmap/index.js';
import { initSuivitess, createSuivitessRouter } from './modules/suivitess/index.js';
import { initDelivery, createDeliveryRouter } from './modules/delivery/index.js';
import { initMonCv, createMonCvRouter } from './modules/mon-cv/index.js';
import { initConnectors, createConnectorsRouter } from './modules/connectors/index.js';
import { initRag, createRagRouter } from './modules/rag/index.js';
import { initAiSkills, createAiSkillsRouter } from './modules/aiSkills/index.js';
import { initPromptLogs, createPromptLogsRouter } from './modules/promptLogs/index.js';

const app = express();

// === CORS allowlist — same rules as before, now consumed by the
//     application-side gateway base (`applyGatewayBase`). ===
const DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1):(517[0-9]|3010)$/;
const VITESS_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?vitess\.tech$/;
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    // Same-origin (curl / server-to-server) → allow.
    if (!origin) { cb(null, true); return; }
    if (DEV_ORIGIN_RE.test(origin)) { cb(null, true); return; }
    if (VITESS_ORIGIN_RE.test(origin)) { cb(null, true); return; }
    if (EXTRA_ORIGINS.includes(origin)) { cb(null, true); return; }
    // Chrome extension origins (chrome-extension://…) — used by the
    // suivitess-importer extension.
    if (origin.startsWith('chrome-extension://')) { cb(null, true); return; }
    cb(new Error(`CORS: origin not allowed (${origin})`));
  },
  credentials: true,
};

// Gateway base: helmet + CORS + request-id + body parser + cookies +
// access log + metrics collector. Must run before any route is
// registered — everything downstream gets `req.requestId`, structured
// HTTP logs, and contributes to /gateway/metrics.
applyGatewayBase(app, { cors: corsOptions });

// Shallow liveness probe (used by Docker healthcheck). The deeper
// readiness check (`/gateway/health`) is mounted by `mountGatewayEndpoints`.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Shared PG pool for the gateway's DB-backed guards (embed visibility,
// feature flags, audit log, user permissions, readiness check).
const gatewayPool = new pg.Pool({ connectionString: config.appDatabaseUrl });
onShutdown(() => gatewayPool.end());

// Initialize modules
async function init() {
  logger.info('server.init.start');

  // Wire the gateway's DB-dependent subsystems BEFORE mounting app
  // routes, so guards have the pool ready on the first request.
  initGatewayWithPool(gatewayPool);
  mountGatewayEndpoints(app);

  // Resource sharing (ownership + visibility)
  const { initSharingPool } = await import('./modules/shared/resourceSharing.js');
  await initSharingPool();

  // Credits system
  const { initCreditPool } = await import('./modules/connectors/creditService.js');
  await initCreditPool();

  // Gateway (auth)
  await initGateway();
  app.use('/api', createGatewayRouter());

  // Conges
  await initConges();
  app.use('/conges/api', createCongesRouter());

  // Roadmap
  await initRoadmap();
  app.use('/roadmap/api', createRoadmapRouter());

  // SuiViTess
  await initSuivitess();
  app.use('/suivitess/api', createSuivitessRouter());

  // Delivery
  await initDelivery();
  app.use('/delivery/api', createDeliveryRouter());

  // Mon CV
  await initMonCv();
  app.use('/mon-cv/api', createMonCvRouter());

  // Connectors (platform-level feature)
  await initConnectors();
  app.use('/api/connectors', createConnectorsRouter());

  // RAG
  await initRag();
  app.use('/rag/api', createRagRouter());

  // AI Skills (admin editor)
  await initAiSkills();
  app.use('/ai-skills/api', createAiSkillsRouter());

  // Prompt Logs (Claude Code hook ingestion + admin viewer)
  await initPromptLogs();
  app.use('/prompt-logs/api', createPromptLogsRouter());

  // Error handling
  app.use(errorMiddleware);

  // Start server + wire graceful shutdown so SIGTERM drains in-flight
  // requests and closes the gateway PG pool cleanly (see onShutdown()
  // above). Never call process.exit directly once this is installed —
  // that bypasses the cleanup chain.
  const server = app.listen(config.port, () => {
    logger.info('server.ready', { port: config.port, env: config.nodeEnv });
  });
  installShutdownHandlers(server);
}

init().catch((err) => {
  logger.error('server.init.failed', { error: (err as Error).message });
  process.exit(1);
});
