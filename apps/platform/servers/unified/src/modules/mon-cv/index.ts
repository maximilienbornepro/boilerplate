import { Router } from 'express';
import { initPool } from './dbService.js';
import { createMonCvRoutes } from './routes.js';

export async function initMonCv() {
  await initPool();
  console.log('[Mon-CV] Module initialized');
}

export function createMonCvRouter(): Router {
  return createMonCvRoutes();
}
