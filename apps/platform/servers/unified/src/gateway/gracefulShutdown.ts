import type { Server } from 'http';
import { logger } from './logger.js';

type Cleanup = () => Promise<void> | void;
const cleanups: Cleanup[] = [];

const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.GATEWAY_SHUTDOWN_TIMEOUT_MS ?? '15000', 10);

/** Register a cleanup to run during graceful shutdown. Typical callers:
 *  PG pool.end(), Redis disconnect, close filesystem locks. Cleanups
 *  run sequentially in registration order and share a single global
 *  timeout — slow cleanups get a chance, but can't stall shutdown. */
export function onShutdown(fn: Cleanup): void {
  cleanups.push(fn);
}

/** Install SIGTERM/SIGINT handlers that:
 *    1. stop accepting new connections,
 *    2. wait for in-flight requests (capped at SHUTDOWN_TIMEOUT_MS),
 *    3. run each registered cleanup in order,
 *    4. exit 0.
 *  Replaces any direct `process.exit()` — calling that bypasses
 *  cleanup and can corrupt pool state or lose buffered writes. */
export function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown.start', { signal });

    server.close((err) => {
      if (err) logger.error('shutdown.server.close.failed', { error: err.message });
      else logger.info('shutdown.server.closed');
    });

    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    const runCleanups = async () => {
      for (const fn of cleanups) {
        try { await fn(); } catch (err) {
          logger.error('shutdown.cleanup.failed', { error: (err as Error).message });
        }
      }
    };

    await Promise.race([
      runCleanups(),
      new Promise<void>(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
    ]);

    logger.info('shutdown.done');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
}

// Reset registered cleanups (tests only).
export function __resetCleanupsForTests(): void {
  cleanups.length = 0;
}
