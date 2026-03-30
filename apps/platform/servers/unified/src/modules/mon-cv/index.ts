import { Router } from 'express';
import { initPool } from './dbService.js';
import { initAdaptationPool } from './adaptationDbService.js';
import { createMonCvRoutes } from './routes.js';

export async function initMonCv() {
  await initPool();
  await initAdaptationPool();
  console.log('[Mon-CV] Module initialized');
}

export function createMonCvRouter(): Router {
  return createMonCvRoutes();
}
