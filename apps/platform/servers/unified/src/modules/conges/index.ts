import { Router } from 'express';
import { initDb, createCongesRoutes } from './routes.js';

export async function initConges() {
  await initDb();
  console.log('[Conges] Module initialized');
}

export function createCongesRouter(): Router {
  return createCongesRoutes();
}
