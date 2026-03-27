import { Router, type Request, type Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { authMiddleware, adminMiddleware } from '../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import { initJiraAuth } from './jiraAuth.js';

// Available apps for permissions
const AVAILABLE_APPS = ['conges', 'roadmap', 'suivitess', 'delivery', 'mon-cv', 'admin'];

let pool: Pool;

export async function initGateway() {
  pool = new Pool({ connectionString: config.appDatabaseUrl });

  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log('[Gateway] Database connected');
  } catch (err) {
    console.error('[Gateway] Database connection failed:', err);
    throw err;
  }

  // Share pool with jiraAuth module
  initJiraAuth(pool);

  // Always create default admin account (admin/admin)
  await createDefaultAdmin();

  // Create additional admin user if configured via env
  if (config.adminEmail && config.adminPassword) {
    await createAdminUser();
  }
}

async function createDefaultAdmin() {
  const defaultEmail = 'admin';
  const defaultPassword = 'admin';

  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [defaultEmail]);

  if (rows.length === 0) {
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, is_active, is_admin) VALUES ($1, $2, true, true) RETURNING id',
      [defaultEmail, passwordHash]
    );
    const userId = result.rows[0].id;

    // Add all permissions
    for (const appId of AVAILABLE_APPS) {
      await pool.query(
        'INSERT INTO user_permissions (user_id, app_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, appId]
      );
    }

    console.log('[Gateway] Default admin account created (admin/admin)');
  }
}

async function createAdminUser() {
  const passwordHash = await bcrypt.hash(config.adminPassword!, 10);
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [config.adminEmail]);

  let userId: number;

  if (rows.length === 0) {
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, is_active, is_admin) VALUES ($1, $2, true, true) RETURNING id',
      [config.adminEmail, passwordHash]
    );
    userId = result.rows[0].id;
    console.log(`[Gateway] Admin user created: ${config.adminEmail}`);
  } else {
    userId = rows[0].id;
    // Ensure password, active and admin status are up to date
    await pool.query(
      'UPDATE users SET password_hash = $1, is_active = true, is_admin = true WHERE id = $2',
      [passwordHash, userId]
    );
    console.log(`[Gateway] Admin user updated: ${config.adminEmail}`);
  }

  // Ensure all permissions
  for (const appId of AVAILABLE_APPS) {
    await pool.query(
      'INSERT INTO user_permissions (user_id, app_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, appId]
    );
  }
}

function generateToken(user: { id: number; email: string; isActive: boolean; isAdmin: boolean; jiraLinked?: boolean }) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      isAdmin: user.isAdmin,
      jiraLinked: user.jiraLinked || false,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

async function getUserPermissions(userId: number): Promise<string[]> {
  const { rows } = await pool.query(
    'SELECT app_id FROM user_permissions WHERE user_id = $1',
    [userId]
  );
  return rows.map((r) => r.app_id);
}

export function createGatewayRouter(): Router {
  const router = Router();

  // Register
  router.post('/auth/register', asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email et mot de passe requis' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
      return;
    }

    // Check if user exists
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length > 0) {
      res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
      return;
    }

    // Create user
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
      [email, passwordHash]
    );

    res.json({ message: 'Compte créé. Contactez un administrateur pour activation.' });
  }));

  // Login
  router.post('/auth/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email et mot de passe requis' });
      return;
    }

    // Find user
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, is_active, is_admin, jira_linked FROM users WHERE email = $1',
      [email]
    );

    if (rows.length === 0) {
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }

    const user = rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }

    // Get permissions
    const permissions = await getUserPermissions(user.id);

    // Generate token
    const token = generateToken({
      id: user.id,
      email: user.email,
      isActive: user.is_active,
      isAdmin: user.is_admin,
      jiraLinked: user.jira_linked || false,
    });

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'strict',
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        isActive: user.is_active,
        isAdmin: user.is_admin,
        jiraLinked: user.jira_linked || false,
        permissions,
      },
    });
  }));

  // Logout
  router.post('/auth/logout', (_req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: 'Déconnecté' });
  });

  // Get current user
  router.get('/auth/me', asyncHandler(async (req, res) => {
    const token = req.cookies.auth_token;

    if (!token) {
      res.json({ user: null });
      return;
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as {
        id: number;
      };

      // Always read fresh data from DB (permissions/admin status may have changed)
      const { rows } = await pool.query(
        'SELECT id, email, is_active, is_admin, jira_linked FROM users WHERE id = $1',
        [decoded.id]
      );

      if (rows.length === 0) {
        res.clearCookie('auth_token');
        res.json({ user: null });
        return;
      }

      const user = rows[0];
      const permissions = await getUserPermissions(user.id);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          isActive: user.is_active,
          isAdmin: user.is_admin,
          jiraLinked: user.jira_linked || false,
          permissions,
        },
      });
    } catch {
      res.clearCookie('auth_token');
      res.json({ user: null });
    }
  }));

  // ==================== Jira OAuth 2.0 ====================

  // GET /auth/jira — Redirect to Atlassian OAuth consent screen
  router.get('/auth/jira', (req: Request, res: Response) => {
    const { clientId, redirectUri } = config.jira.oauth;
    if (!clientId) {
      res.status(503).json({ error: 'Jira OAuth not configured (missing JIRA_OAUTH_CLIENT_ID)' });
      return;
    }

    // Build return URL from Referer or Origin header
    const referer = req.headers.referer || req.headers.origin as string | undefined;
    let returnUrl = '/';
    if (referer) {
      try {
        const u = new URL(referer);
        returnUrl = `${u.origin}/`;
      } catch { /* ignore */ }
    }

    // Resolve userId from cookie (SameSite=strict blocks cookie on callback redirect)
    let userId: number | null = null;
    const authToken = req.cookies?.auth_token;
    if (authToken) {
      try {
        const decoded = jwt.verify(authToken, config.jwtSecret) as { id: number };
        userId = decoded.id;
      } catch { /* ignore expired/invalid token */ }
    }

    // Generate state token to prevent CSRF
    const state = Buffer.from(JSON.stringify({
      userId,
      nonce: Math.random().toString(36).slice(2),
      returnUrl,
    })).toString('base64url');

    const params = new URLSearchParams({
      audience:      'api.atlassian.com',
      client_id:     clientId,
      scope:         'read:jira-user read:jira-work write:jira-work read:board-scope:jira-software read:sprint:jira-software offline_access',
      redirect_uri:  redirectUri,
      state,
      response_type: 'code',
      prompt:        'consent',
    });

    res.redirect(`https://auth.atlassian.com/authorize?${params}`);
  });

  // GET /auth/jira/callback — Exchange code for tokens
  router.get('/auth/jira/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string>;

    let userId: number | undefined;
    let returnUrl = '/';
    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
        userId = decoded.userId;
        if (decoded.returnUrl) returnUrl = decoded.returnUrl;
      } catch { /* ignore */ }
    }

    if (error) {
      console.error('[jira-oauth] Authorization error:', error);
      res.redirect(`${returnUrl}?jira_error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state' });
      return;
    }

    const { clientId, clientSecret, redirectUri } = config.jira.oauth;

    try {
      // 1. Exchange authorization code for access + refresh tokens
      const tokenResponse = await fetch('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type:    'authorization_code',
          client_id:     clientId,
          client_secret: clientSecret,
          code,
          redirect_uri:  redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const err = await tokenResponse.text();
        console.error('[jira-oauth] Token exchange failed:', err);
        res.redirect(`${returnUrl}?jira_error=token_exchange_failed`);
        return;
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      // 2. Get accessible Jira sites (cloud_id + site URL)
      const sitesResponse = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!sitesResponse.ok) {
        console.error('[jira-oauth] Could not fetch accessible resources');
        res.redirect(`${returnUrl}?jira_error=no_accessible_resources`);
        return;
      }

      const sites = await sitesResponse.json() as Array<{ id: string; url: string; name: string }>;
      if (!sites.length) {
        res.redirect(`${returnUrl}?jira_error=no_jira_sites`);
        return;
      }

      // Use the first site (or match by JIRA_BASE_URL if configured)
      const targetSite = config.jira.baseUrl
        ? sites.find(s => config.jira.baseUrl.includes(s.url.replace('https://', ''))) || sites[0]
        : sites[0];

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      // 3. userId comes from the state (encoded at OAuth initiation)
      if (!userId) {
        res.redirect(`${returnUrl}?jira_error=no_user_context`);
        return;
      }

      // 4. Store tokens in DB
      await pool.query(`
        INSERT INTO jira_tokens (user_id, access_token, refresh_token, expires_at, cloud_id, site_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE SET
          access_token  = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          expires_at    = EXCLUDED.expires_at,
          cloud_id      = EXCLUDED.cloud_id,
          site_url      = EXCLUDED.site_url,
          updated_at    = NOW()
      `, [userId, tokens.access_token, tokens.refresh_token || null, expiresAt, targetSite.id, targetSite.url]);

      // 5. Mark user as jira_linked and re-emit JWT
      await pool.query(
        'UPDATE users SET jira_linked = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [userId]
      );

      const { rows: userRows } = await pool.query(
        'SELECT id, email, is_active, is_admin, jira_linked FROM users WHERE id = $1',
        [userId]
      );

      if (userRows.length > 0) {
        const u = userRows[0];
        const newToken = generateToken({
          id: u.id,
          email: u.email,
          isActive: u.is_active,
          isAdmin: u.is_admin,
          jiraLinked: true,
        });
        res.cookie('auth_token', newToken, {
          httpOnly: true,
          secure: config.isProduction,
          sameSite: 'lax',
          maxAge: 90 * 24 * 60 * 60 * 1000,
        });
      }

      console.log(`[jira-oauth] User ${userId} connected to Jira site: ${targetSite.url}`);
      res.redirect(`${returnUrl}?jira_connected=1`);

    } catch (err: any) {
      console.error('[jira-oauth] Callback error:', err);
      res.redirect(`${returnUrl}?jira_error=server_error`);
    }
  });

  // GET /auth/jira/status — Check if current user has Jira connected via OAuth
  router.get('/auth/jira/status', authMiddleware, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT cloud_id, site_url, expires_at, updated_at FROM jira_tokens WHERE user_id = $1',
      [req.user!.id]
    );

    if (!result.rows.length) {
      res.json({ connected: false });
      return;
    }

    const token = result.rows[0];
    const isExpired = new Date(token.expires_at) < new Date();

    res.json({
      connected: true,
      siteUrl:   token.site_url,
      cloudId:   token.cloud_id,
      expiresAt: token.expires_at,
      isExpired,
      connectedAt: token.updated_at,
    });
  }));

  // DELETE /auth/jira — Disconnect Jira OAuth for current user
  router.delete('/auth/jira', authMiddleware, asyncHandler(async (req, res) => {
    const uid = req.user!.id;
    await pool.query('DELETE FROM jira_tokens WHERE user_id = $1', [uid]);
    await pool.query(
      'UPDATE users SET jira_linked = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [uid]
    );
    res.json({ success: true });
  }));

  // Admin: List users
  router.get('/admin/users', authMiddleware, adminMiddleware, asyncHandler(async (_req, res) => {
    const { rows: users } = await pool.query(
      'SELECT id, email, is_active, is_admin, created_at FROM users ORDER BY created_at DESC'
    );

    // Get permissions for each user
    const usersWithPermissions = await Promise.all(
      users.map(async (user) => {
        const permissions = await getUserPermissions(user.id);
        return {
          id: user.id,
          email: user.email,
          isActive: user.is_active,
          isAdmin: user.is_admin,
          createdAt: user.created_at,
          permissions,
        };
      })
    );

    res.json(usersWithPermissions);
  }));

  // Admin: Update user
  router.put('/admin/users/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { isActive, isAdmin, permissions } = req.body;

    // Update user
    if (isActive !== undefined || isAdmin !== undefined) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (isActive !== undefined) {
        updates.push(`is_active = $${paramIndex++}`);
        values.push(isActive);
      }
      if (isAdmin !== undefined) {
        updates.push(`is_admin = $${paramIndex++}`);
        values.push(isAdmin);
      }

      values.push(userId);
      await pool.query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
        values
      );
    }

    // Update permissions
    if (permissions !== undefined) {
      await pool.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);
      for (const appId of permissions) {
        if (AVAILABLE_APPS.includes(appId)) {
          await pool.query(
            'INSERT INTO user_permissions (user_id, app_id) VALUES ($1, $2)',
            [userId, appId]
          );
        }
      }

      // Sync is_admin flag with admin permission
      const hasAdminPerm = permissions.includes('admin');
      await pool.query(
        'UPDATE users SET is_admin = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [hasAdminPerm, userId]
      );
    }

    res.json({ success: true });
  }));

  // Admin: Delete user
  router.delete('/admin/users/:id', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id, 10);

    // Prevent deleting self
    if (req.user?.id === userId) {
      res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
      return;
    }

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
  }));

  return router;
}
