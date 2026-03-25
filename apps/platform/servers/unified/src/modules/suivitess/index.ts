import { Router } from 'express';
import { initDb } from './dbService.js';
import { createRoutes } from './routes.js';

export async function initSuivitess() {
  await initDb();
  console.log('[SuiVitess] Module initialized');
}

export function createSuivitessRouter(): Router {
  return createRoutes();
}
