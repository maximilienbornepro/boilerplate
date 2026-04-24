import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startedAt: number;
    }
  }
}

// Safe charset for request IDs forwarded by an upstream gateway (nginx,
// CDN). Guards against log-injection attempts where an attacker crafts
// a header containing newlines or JSON control characters.
const VALID_REQ_ID = /^[a-zA-Z0-9._-]{8,128}$/;

/** Pick up `X-Request-ID` from upstream when well-formed, otherwise
 *  generate a fresh UUID. Echoes the resolved ID back on the response
 *  so the client can correlate server logs with its own traces. */
export const requestContext: RequestHandler = (req, res, next) => {
  const fromHeader = req.header('x-request-id');
  const id = typeof fromHeader === 'string' && VALID_REQ_ID.test(fromHeader)
    ? fromHeader
    : randomUUID();
  req.requestId = id;
  req.startedAt = Date.now();
  res.setHeader('X-Request-ID', id);
  next();
};
