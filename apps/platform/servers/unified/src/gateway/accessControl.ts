import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { authMiddleware } from '../middleware/auth.js';
import { getRateLimiter, type RateLimitTier } from './rateLimits.js';
import { bodyLimit } from './bodyLimits.js';
import { csrfProtection } from './csrf.js';
import { userHasPermission, initUserPermissions } from './userPermissions.js';
import { logger } from './logger.js';

export type AccessTier = 'public' | 'embed' | 'authenticated' | 'admin' | 'role';

export interface RouteOptions {
  tier: AccessTier;
  /** Override the default rate-limit tier for this route. */
  rateLimit?: RateLimitTier;
  /** Required for `tier: 'role'` — the user's `user_permissions.app_id` must include this. */
  permission?: string;
  /** Required for `tier: 'embed'` — looked up in `resource_sharing`. */
  resourceType?: 'roadmap' | 'delivery' | 'suivitess';
  /** Name of the `req.params` key that holds the resource id. Defaults to `'id'`. */
  resourceIdParam?: string;
  /** Raise the per-tier body limit in bytes — useful for multer upload
   *  routes that legitimately receive large payloads (PDF, docx, ...).
   *  Pass `false` to disable the Content-Length check entirely. */
  bodyLimit?: number | false;
}

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `embed` tier — the resolved public resource. */
      resource?: {
        type: string;
        id: string;
        ownerId: number;
        visibility: 'private' | 'public';
      };
    }
  }
}

// Default rate-limit tier per access tier. Tight on public surface,
// generous for authenticated application traffic.
const DEFAULT_RATE_TIER: Record<AccessTier, RateLimitTier> = {
  public:        'public',
  embed:         'public',
  authenticated: 'default',
  admin:         'default',
  role:          'default',
};

let embedPool: Pool | null = null;

export function initAccessControl(pool: Pool): void {
  embedPool = pool;
  initUserPermissions(pool);
}

function requireAdmin(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) { res.status(401).json({ error: 'Non authentifie.' }); return; }
    if (!req.user.isAdmin) { res.status(403).json({ error: 'Acces reserve aux administrateurs.' }); return; }
    next();
  };
}

function requireRole(permission: string): RequestHandler {
  return async (req, res, next) => {
    if (!req.user) { res.status(401).json({ error: 'Non authentifie.' }); return; }
    // Admins bypass permission checks — matches the existing in-module
    // behaviour and keeps the admin escape-hatch consistent.
    if (req.user.isAdmin) { next(); return; }
    try {
      const ok = await userHasPermission(req.user.id, permission);
      if (!ok) {
        res.status(403).json({ error: `Acces reserve (permission: ${permission}).` });
        return;
      }
      next();
    } catch (err) {
      logger.error('accessControl.role.failed', { error: (err as Error).message });
      res.status(500).json({ error: 'Erreur verification permissions.' });
    }
  };
}

function requireEmbedPublic(resourceType: string, idParam: string): RequestHandler {
  return async (req, res, next) => {
    if (!embedPool) {
      res.status(500).json({ error: 'Gateway embed non initialise.' });
      return;
    }
    const rawId = req.params[idParam];
    // Express 5 widened params to `string | string[]` — embeds only
    // accept a single identifier, not an array.
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id) { res.status(400).json({ error: `Parametre manquant: ${idParam}.` }); return; }
    try {
      const r = await embedPool.query<{ owner_id: number; visibility: string }>(
        `SELECT owner_id, visibility FROM resource_sharing
         WHERE resource_type = $1 AND resource_id = $2`,
        [resourceType, id]
      );
      if (r.rowCount === 0 || r.rows[0].visibility !== 'public') {
        // 404 rather than 403 — don't leak existence of private
        // resources to unauthenticated callers.
        res.status(404).json({ error: 'Ressource introuvable.' });
        return;
      }
      req.resource = {
        type: resourceType,
        id,
        ownerId: r.rows[0].owner_id,
        visibility: 'public',
      };
      next();
    } catch (err) {
      logger.error('accessControl.embed.failed', { error: (err as Error).message });
      res.status(500).json({ error: 'Erreur gateway.' });
    }
  };
}

/** Build the middleware chain for a route according to its access tier.
 *
 *  Order matters and is deliberate:
 *    1. bodyLimit     → reject oversized payloads before buffering
 *    2. rateLimiter   → reject noise before touching auth DB
 *    3. CSRF          → only on cookie-auth tiers + mutating methods
 *    4. auth          → verify JWT for authenticated tiers
 *    5. tier guard    → admin flag / role permission / embed visibility
 *
 *  Returns an array suitable for spreading into Express's router:
 *    router.get('/x', ...route({ tier: 'admin' }), handler);
 */
export function route(opts: RouteOptions): RequestHandler[] {
  const chain: RequestHandler[] = [];
  if (opts.bodyLimit !== false) {
    chain.push(bodyLimit(opts.tier, typeof opts.bodyLimit === 'number' ? opts.bodyLimit : undefined));
  }
  chain.push(getRateLimiter(opts.rateLimit ?? DEFAULT_RATE_TIER[opts.tier]));

  const needsCookieAuth = opts.tier === 'authenticated' || opts.tier === 'admin' || opts.tier === 'role';
  if (needsCookieAuth) {
    chain.push(csrfProtection);
    chain.push(authMiddleware);
  }

  switch (opts.tier) {
    case 'admin':
      chain.push(requireAdmin());
      break;
    case 'role':
      if (!opts.permission) {
        throw new Error("route({ tier: 'role' }) requires a 'permission' option");
      }
      chain.push(requireRole(opts.permission));
      break;
    case 'embed':
      if (!opts.resourceType) {
        throw new Error("route({ tier: 'embed' }) requires a 'resourceType' option");
      }
      chain.push(requireEmbedPublic(opts.resourceType, opts.resourceIdParam ?? 'id'));
      break;
    case 'public':
    case 'authenticated':
      break;
  }

  return chain;
}
