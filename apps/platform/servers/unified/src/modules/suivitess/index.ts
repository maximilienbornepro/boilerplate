import { Router } from 'express';
import { initDb } from './dbService.js';
import { createRoutes } from './routes.js';
import { initSlackCollector } from './slackCollectorService.js';
import { initOutlookCollector } from './outlookCollectorService.js';

export async function initSuivitess() {
  await initDb();
  try { await initSlackCollector(); } catch (err) {
    console.warn('[SuiVitess] Slack collector init (non-blocking):', (err as Error).message);
  }
  try { await initOutlookCollector(); } catch (err) {
    console.warn('[SuiVitess] Outlook collector init (non-blocking):', (err as Error).message);
  }
  console.log('[SuiVitess] Module initialized');
}

export function createSuivitessRouter(): Router {
  return createRoutes();
}
