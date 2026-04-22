import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { errorMiddleware } from '@boilerplate/shared/server';

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

// Security headers : CSP is relaxed because the SPA + Chrome extension
// already enforce their own CSP, and because several features (Jira
// OAuth redirect, email connectors, embed iframes) need to connect
// to third-party domains at runtime — tightening it would require a
// per-route policy. HSTS + noSniff + frameguard ('sameorigin', to
// allow our own embed views) are the concrete protections we add.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: { action: 'sameorigin' },
}));

// Middleware
// CORS : whitelist only — reflecting any Origin with credentials
// enabled (the previous `origin: true`) let any malicious site read
// authenticated responses. Allowed origins are :
//   - ALLOWED_ORIGINS env (comma-separated)
//   - Local dev ports (5170-5179) + the 3010 backend itself
//   - Anything from the deployed Vitess domain (studio.vitess.tech,
//     boilerplate.vitess.tech, francetv.vitess.tech) and their subs.
const DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1):(517[0-9]|3010)$/;
const VITESS_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?vitess\.tech$/;
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
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
}));
app.use(express.json());
app.use(cookieParser());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize modules
async function init() {
  console.log('[Server] Initializing modules...');

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

  // Start server
  app.listen(config.port, () => {
    console.log(`[Server] Running on port ${config.port}`);
    console.log(`[Server] Environment: ${config.nodeEnv}`);
  });
}

init().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
