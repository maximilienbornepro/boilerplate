import type { RequestHandler } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1):(517[0-9]|3010)$/;
const VITESS_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?vitess\.tech$/;

function getExtraOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

export function isOriginAllowed(origin: string): boolean {
  if (DEV_ORIGIN_RE.test(origin)) return true;
  if (VITESS_ORIGIN_RE.test(origin)) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  return getExtraOrigins().includes(origin);
}

/** CSRF defense for cookie-based auth. On mutating requests, require an
 *  `Origin` header that matches our CORS allowlist, falling back to
 *  `Referer`. Same-origin SPA POSTs always carry a legitimate Origin;
 *  cross-origin POSTs from malicious sites reflect the attacker domain
 *  which won't match our allowlist. Bearer-auth clients (extensions,
 *  CLI) are exempt — they don't rely on cookies. */
export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) { next(); return; }
  if (req.headers.authorization?.startsWith('Bearer ')) { next(); return; }

  const origin = req.header('origin');
  if (origin && isOriginAllowed(origin)) { next(); return; }

  // Some older clients / same-origin fetches omit Origin but send
  // Referer — accept that as a fallback signal.
  const referer = req.header('referer');
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (isOriginAllowed(refOrigin)) { next(); return; }
    } catch { /* malformed referer — fall through to rejection */ }
  }

  res.status(403).json({ error: 'Origin non autorisee (CSRF).' });
};
