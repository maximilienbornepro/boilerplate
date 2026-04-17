import express from 'express';
import cors from 'cors';
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

const app = express();

// Middleware
app.use(cors({
  origin: true,
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
