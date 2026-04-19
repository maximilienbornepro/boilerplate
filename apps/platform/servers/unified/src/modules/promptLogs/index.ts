// Module entry point.
// POST /prompt-logs/api/events is PUBLIC (Claude Code hook posts here).
// All GET routes are admin-gated inside `createRoutes`.

import { initPromptLogsPool } from './dbService.js';
import { createRoutes } from './routes.js';

export async function initPromptLogs(): Promise<void> {
  await initPromptLogsPool();
  console.log('[PromptLogs] ready');
}

export function createPromptLogsRouter() {
  return createRoutes();
}
