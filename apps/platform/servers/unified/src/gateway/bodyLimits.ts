import type { RequestHandler } from 'express';
import type { AccessTier } from './accessControl.js';

// Per-tier upload ceilings. `public`/`embed` are strictly read-only so
// any meaningful payload is suspicious. `authenticated` covers JSON
// API traffic. `admin` accommodates file uploads (avatars, imports).
const TIER_LIMITS: Record<AccessTier, number> = {
  public:        10 * 1024,
  embed:         10 * 1024,
  authenticated: 1 * 1024 * 1024,
  admin:         25 * 1024 * 1024,
  role:          1 * 1024 * 1024,
};

/** Reject requests whose `Content-Length` exceeds the tier ceiling
 *  BEFORE `express.json()` allocates buffers. The global body-parser
 *  cap (25 MB) is the hard ceiling; this is the per-tier soft cap.
 *  Pass an explicit `override` to raise the cap for specific routes
 *  (e.g. multer file uploads beyond the tier default). */
export function bodyLimit(tier: AccessTier, override?: number): RequestHandler {
  const max = override ?? TIER_LIMITS[tier];
  return (req, res, next) => {
    const len = req.headers['content-length'];
    if (len && parseInt(len, 10) > max) {
      res.status(413).json({ error: `Payload trop volumineux (max ${max} octets).` });
      return;
    }
    next();
  };
}

export function getBodyLimit(tier: AccessTier): number {
  return TIER_LIMITS[tier];
}
