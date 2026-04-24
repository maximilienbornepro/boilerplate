import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';

export type RateLimitTier = 'public' | 'auth' | 'heavy' | 'default';

// Per-tier rate-limit budgets. Tight on `public`/`auth` to protect
// unauthenticated surface area (login, embeds). `heavy` is for LLM
// calls (each costs real money). `default` covers authenticated app
// traffic — generous enough not to throttle normal users.
const TIER_CONFIG: Record<RateLimitTier, { windowMs: number; max: number }> = {
  public:  { windowMs: 60_000, max: 30 },
  auth:    { windowMs: 60_000, max: 10 },
  heavy:   { windowMs: 60_000, max: 10 },
  default: { windowMs: 60_000, max: 300 },
};

function buildLimiter(tier: RateLimitTier): RateLimitRequestHandler {
  const { windowMs, max } = TIER_CONFIG[tier];
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de requetes, reessaye dans un instant.' },
    // Key by authenticated user ID when available, otherwise by IP.
    // Protects a shared-office IP from being collectively throttled
    // while still stopping anonymous abuse. `ipKeyGenerator` collapses
    // IPv6 addresses onto their /64 prefix, so a single client can't
    // bypass limits by cycling through its own IPv6 range.
    keyGenerator: (req) => {
      const userId = req.user?.id;
      if (userId) return `u:${userId}`;
      return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
    },
  });
}

const limiters: Record<RateLimitTier, RateLimitRequestHandler> = {
  public:  buildLimiter('public'),
  auth:    buildLimiter('auth'),
  heavy:   buildLimiter('heavy'),
  default: buildLimiter('default'),
};

export function getRateLimiter(tier: RateLimitTier): RateLimitRequestHandler {
  return limiters[tier];
}

export function getRateLimitConfig(tier: RateLimitTier): { windowMs: number; max: number } {
  return TIER_CONFIG[tier];
}
