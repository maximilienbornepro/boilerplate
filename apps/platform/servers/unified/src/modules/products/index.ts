import { Router } from 'express';
import { initDb, createProductsRoutes } from './routes.js';

export async function initProducts() {
  await initDb();
  console.log('[Products] Module initialized');
}

export function createProductsRouter(): Router {
  return createProductsRoutes();
}
