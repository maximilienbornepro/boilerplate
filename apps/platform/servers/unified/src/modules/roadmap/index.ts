import { Router } from 'express';
import { initDb, createRoadmapRoutes } from './routes.js';

export async function initRoadmap() {
  await initDb();
  console.log('[Roadmap] Module initialized');
}

export function createRoadmapRouter(): Router {
  return createRoadmapRoutes();
}
