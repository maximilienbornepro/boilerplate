import { Router } from 'express';
import { initDb } from './dbService.js';
import { createRoutes } from './routes.js';
import { initSlackCollector } from './slackCollectorService.js';

export async function initSuivitess() {
  await initDb();
  try {
    await initSlackCollector();
  } catch (err) {
    console.warn('[SuiVitess] Slack collector init failed (non-blocking):', (err as Error).message);
  }
  console.log('[SuiVitess] Module initialized');
}

export function createSuivitessRouter(): Router {
  return createRoutes();
}
