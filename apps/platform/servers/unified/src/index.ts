import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { errorMiddleware } from '@boilerplate/shared/server';

// Import modules
import { initGateway, createGatewayRouter } from './modules/gateway.js';
import { initProducts, createProductsRouter } from './modules/products/index.js';
import { initConges, createCongesRouter } from './modules/conges/index.js';
import { initRoadmap, createRoadmapRouter } from './modules/roadmap/index.js';
import { initSuivitess, createSuivitessRouter } from './modules/suivitess/index.js';

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

  // Gateway (auth)
  await initGateway();
  app.use('/api', createGatewayRouter());

  // Products
  await initProducts();
  app.use('/products/api', createProductsRouter());

  // Conges
  await initConges();
  app.use('/conges/api', createCongesRouter());

  // Roadmap
  await initRoadmap();
  app.use('/roadmap/api', createRoadmapRouter());

  // SuiViTess
  await initSuivitess();
  app.use('/suivitess/api', createSuivitessRouter());

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
