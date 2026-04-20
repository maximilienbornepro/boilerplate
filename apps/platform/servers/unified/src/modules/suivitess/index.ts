import { Router } from 'express';
import { initDb } from './dbService.js';
import { createRoutes } from './routes.js';
import { initSlackCollector } from './slackCollectorService.js';
import { initOutlookCollector } from './outlookCollectorService.js';
import { initRoutingMemory } from './routingMemoryService.js';

export async function initSuivitess() {
  await initDb();
  try { await initSlackCollector(); } catch (err) {
    console.warn('[SuiVitess] Slack collector init (non-blocking):', (err as Error).message);
  }
  try { await initOutlookCollector(); } catch (err) {
    console.warn('[SuiVitess] Outlook collector init (non-blocking):', (err as Error).message);
  }
  // Routing memory = pgvector-backed RAG of past (subject → review) decisions.
  // Non-blocking : if pgvector / embedding provider is down, the feature
  // silently disables but the rest of the module keeps working.
  try { await initRoutingMemory(); } catch (err) {
    console.warn('[SuiVitess] Routing memory init (non-blocking):', (err as Error).message);
  }
  console.log('[SuiVitess] Module initialized');
}

export function createSuivitessRouter(): Router {
  return createRoutes();
}
