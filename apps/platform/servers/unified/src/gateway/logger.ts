import type { Request } from 'express';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

// Structured logger: one line of JSON per call in production (pipeable
// to any log aggregator), pretty-printed in development for readability.
// Intentionally no external dep — keeps the gateway self-contained.
function emit(level: LogLevel, msg: string, fields: LogFields): void {
  if (process.env.NODE_ENV === 'production') {
    const entry = { ts: new Date().toISOString(), level, msg, ...fields };
    process.stdout.write(JSON.stringify(entry) + '\n');
    return;
  }
  const ctx = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${level}] ${msg}${ctx}`);
}

export const logger = {
  debug: (msg: string, fields: LogFields = {}) => emit('debug', msg, fields),
  info:  (msg: string, fields: LogFields = {}) => emit('info',  msg, fields),
  warn:  (msg: string, fields: LogFields = {}) => emit('warn',  msg, fields),
  error: (msg: string, fields: LogFields = {}) => emit('error', msg, fields),
};

/** Returns a logger pre-bound to the current request's ID. Every call
 *  will include `reqId` in the structured output without having to
 *  thread it through manually. */
export function reqLogger(req: Request) {
  const reqId = req.requestId;
  return {
    debug: (msg: string, fields: LogFields = {}) => logger.debug(msg, { ...fields, reqId }),
    info:  (msg: string, fields: LogFields = {}) => logger.info(msg,  { ...fields, reqId }),
    warn:  (msg: string, fields: LogFields = {}) => logger.warn(msg,  { ...fields, reqId }),
    error: (msg: string, fields: LogFields = {}) => logger.error(msg, { ...fields, reqId }),
  };
}
