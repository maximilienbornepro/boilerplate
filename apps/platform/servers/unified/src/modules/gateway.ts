import { Router, type Request, type Response } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { authMiddleware, adminMiddleware } from '../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import { initJiraAuth } from './jiraAuth.js';

// Available apps for permissions
const AVAILABLE_APPS = ['conges', 'roadmap', 'suivitess', 'delivery', 'mon-cv', 'rag', 'design-system', 'admin'];

// Consistent cookie options — must be the same for set AND clear to avoid duplicate cookies in browsers
function authCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };
}

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

  // Ensure platform_settings table exists (idempotent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key         VARCHAR(100) PRIMARY KEY,
      value       TEXT         NOT NULL DEFAULT 'false',
      description TEXT,
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO platform_settings (key, value, description)
    VALUES ('credits_enabled', 'false', 'Système de crédits pour limiter l''usage des services')
    ON CONFLICT (key) DO UPDATE SET
      description = EXCLUDED.description
  `);

  // Seed global feature toggles for connectors + modules. Admins can
  // flip these on/off from /admin-features — the values are read by
  // the frontend (to hide UI) and can be checked server-side by any
  // route that wants to no-op when disabled.
  const defaultToggles: Array<[string, string, string]> = [
    // Connectors — IA / LLM providers
    ['connector_anthropic_enabled', 'true', 'Fournisseur IA Anthropic (Claude)'],
    ['connector_openai_enabled', 'true', 'Fournisseur IA OpenAI (GPT-4, GPT-5)'],
    ['connector_mistral_enabled', 'true', 'Fournisseur IA Mistral'],
    ['connector_scaleway_enabled', 'true', 'Fournisseur IA Scaleway (LLM + embeddings)'],
    // Connectors — data sources
    ['connector_gmail_enabled', 'true', 'Connecteur Gmail (import emails)'],
    ['connector_outlook_enabled', 'true', 'Connecteur Outlook (import emails)'],
    ['connector_slack_enabled', 'true', 'Connecteur Slack (import messages)'],
    ['connector_jira_enabled', 'true', 'Connecteur Jira (import tickets, OAuth/token)'],
    ['connector_fathom_enabled', 'true', 'Connecteur Fathom (import transcriptions)'],
    ['connector_otter_enabled', 'true', 'Connecteur Otter.ai (import transcriptions)'],
    ['connector_notion_enabled', 'true', 'Connecteur Notion (création de pages)'],
    ['connector_teams_recorder_enabled', 'true', 'Recorder Teams (enregistrement automatique)'],
    // Modules
    ['module_suivitess_enabled', 'true', 'Module SuiviTess (suivi de sujets)'],
    ['module_delivery_enabled', 'true', 'Module Delivery (board de livraison)'],
    ['module_roadmap_enabled', 'true', 'Module Roadmap (planification tâches)'],
    ['module_mon_cv_enabled', 'true', 'Module Mon CV (gestion CV)'],
    ['module_conges_enabled', 'true', 'Module Congés (gestion absences)'],
    ['module_ai_logs_enabled', 'true', 'Pages admin IA (Logs / Évaluations / Playground)'],
  ];
  for (const [key, value, description] of defaultToggles) {
    await pool.query(
      `INSERT INTO platform_settings (key, value, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
      [key, value, description],
    );
  }

  // Email OAuth tokens table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_oauth_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(20) NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      email_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, provider)
    )
  `);

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
      ...authCookieOptions(),
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
    res.clearCookie('auth_token', authCookieOptions());
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
        res.clearCookie('auth_token', authCookieOptions());
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
      res.clearCookie('auth_token', authCookieOptions());
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
      scope:         'read:jira-user read:jira-work write:jira-work read:board-scope:jira-software read:sprint:jira-software read:confluence-space.summary read:confluence-content.all read:confluence-content.body offline_access',
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
          ...authCookieOptions(),
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

  // ==================== FATHOM OAUTH ====================
  router.get('/auth/fathom', (req: Request, res: Response) => {
    const { clientId, redirectUri } = config.fathom.oauth;
    if (!clientId) { res.status(503).json({ error: 'Fathom OAuth not configured' }); return; }

    let userId: number | null = null;
    const authToken = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
    if (authToken) {
      try { const decoded = jwt.verify(authToken, config.jwtSecret) as { id: number }; userId = decoded.id; } catch {}
    }

    const returnUrl = (req.query.returnUrl as string) || '/';
    const state = Buffer.from(JSON.stringify({ userId, nonce: Math.random().toString(36).slice(2), returnUrl })).toString('base64url');

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'public_api',
      state,
    });
    res.redirect(`https://fathom.video/external/v1/oauth2/authorize?${params}`);
  });

  router.get('/auth/fathom/callback', async (req: Request, res: Response) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    let userId: number | undefined;
    let returnUrl = '/';
    if (state) { try { const d = JSON.parse(Buffer.from(state, 'base64url').toString()); userId = d.userId; returnUrl = d.returnUrl || '/'; } catch {} }
    if (oauthError || !code) { res.redirect(`${returnUrl}?fathom_error=${encodeURIComponent(oauthError || 'no_code')}`); return; }

    try {
      const { clientId, clientSecret, redirectUri } = config.fathom.oauth;
      const tokenRes = await fetch('https://fathom.video/external/v1/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error('[Fathom OAuth] token exchange failed:', errText);
        res.redirect(`${returnUrl}?fathom_error=token_exchange_failed`);
        return;
      }
      const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in?: number };
      const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
      await pool.query(`
        INSERT INTO email_oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, email_address)
        VALUES ($1, 'fathom', $2, $3, $4, NULL)
        ON CONFLICT (user_id, provider) DO UPDATE SET
          access_token = EXCLUDED.access_token, refresh_token = COALESCE(EXCLUDED.refresh_token, email_oauth_tokens.refresh_token),
          expires_at = EXCLUDED.expires_at, updated_at = NOW()
      `, [userId, tokens.access_token, tokens.refresh_token || null, expiresAt]);

      res.redirect(`${returnUrl}?fathom_connected=1`);
    } catch (err) {
      console.error('[Fathom OAuth] Callback error:', err);
      res.redirect(`${returnUrl}?fathom_error=callback_failed`);
    }
  });

  router.get('/auth/fathom/status', authMiddleware, asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT expires_at, updated_at FROM email_oauth_tokens WHERE user_id = $1 AND provider = $2',
      [req.user!.id, 'fathom']
    );
    if (!rows.length) { res.json({ connected: false }); return; }
    const t = rows[0];
    res.json({ connected: true, expiresAt: t.expires_at, isExpired: new Date(t.expires_at) < new Date(), connectedAt: t.updated_at });
  }));

  router.delete('/auth/fathom', authMiddleware, asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM email_oauth_tokens WHERE user_id = $1 AND provider = $2', [req.user!.id, 'fathom']);
    res.json({ success: true });
  }));

  // ==================== EMAIL OAUTH (Outlook + Gmail) ====================

  // --- Outlook OAuth ---
  router.get('/auth/outlook', (req: Request, res: Response) => {
    const { clientId, redirectUri } = config.outlook.oauth;
    if (!clientId) { res.status(503).json({ error: 'Outlook OAuth not configured' }); return; }

    let userId: number | null = null;
    const authToken = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
    if (authToken) {
      try { const decoded = jwt.verify(authToken, config.jwtSecret) as { id: number }; userId = decoded.id; } catch {}
    }

    const returnUrl = (req.query.returnUrl as string) || '/';
    const state = Buffer.from(JSON.stringify({ userId, nonce: Math.random().toString(36).slice(2), returnUrl })).toString('base64url');

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access',
      state,
      prompt: 'consent',
    });
    res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
  });

  router.get('/auth/outlook/callback', async (req: Request, res: Response) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    let userId: number | undefined;
    let returnUrl = '/';
    if (state) { try { const d = JSON.parse(Buffer.from(state, 'base64url').toString()); userId = d.userId; returnUrl = d.returnUrl || '/'; } catch {} }
    if (oauthError || !code) { res.redirect(`${returnUrl}?outlook_error=${encodeURIComponent(oauthError || 'no_code')}`); return; }

    try {
      const { clientId, clientSecret, redirectUri } = config.outlook.oauth;
      const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) { res.redirect(`${returnUrl}?outlook_error=token_exchange_failed`); return; }
      const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in: number };

      // Get user email
      const meRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const me = await meRes.json() as { mail?: string; userPrincipalName?: string };
      const emailAddress = me.mail || me.userPrincipalName || '';

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      await pool.query(`
        INSERT INTO email_oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, email_address)
        VALUES ($1, 'outlook', $2, $3, $4, $5)
        ON CONFLICT (user_id, provider) DO UPDATE SET
          access_token = EXCLUDED.access_token, refresh_token = COALESCE(EXCLUDED.refresh_token, email_oauth_tokens.refresh_token),
          expires_at = EXCLUDED.expires_at, email_address = EXCLUDED.email_address, updated_at = NOW()
      `, [userId, tokens.access_token, tokens.refresh_token || null, expiresAt, emailAddress]);

      res.redirect(`${returnUrl}?outlook_connected=1`);
    } catch (err) {
      console.error('[Outlook OAuth] Callback error:', err);
      res.redirect(`${returnUrl}?outlook_error=callback_failed`);
    }
  });

  router.get('/auth/outlook/status', authMiddleware, asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT email_address, expires_at, updated_at FROM email_oauth_tokens WHERE user_id = $1 AND provider = $2',
      [req.user!.id, 'outlook']
    );
    if (!rows.length) { res.json({ connected: false }); return; }
    const t = rows[0];
    res.json({ connected: true, emailAddress: t.email_address, expiresAt: t.expires_at, isExpired: new Date(t.expires_at) < new Date(), connectedAt: t.updated_at });
  }));

  router.delete('/auth/outlook', authMiddleware, asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM email_oauth_tokens WHERE user_id = $1 AND provider = $2', [req.user!.id, 'outlook']);
    res.json({ success: true });
  }));

  // --- Gmail OAuth ---
  router.get('/auth/gmail', (req: Request, res: Response) => {
    const { clientId, redirectUri } = config.gmail.oauth;
    if (!clientId) { res.status(503).json({ error: 'Gmail OAuth not configured' }); return; }

    let userId: number | null = null;
    const authToken = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
    if (authToken) {
      try { const decoded = jwt.verify(authToken, config.jwtSecret) as { id: number }; userId = decoded.id; } catch {}
    }

    const returnUrl = (req.query.returnUrl as string) || '/';
    const state = Buffer.from(JSON.stringify({ userId, nonce: Math.random().toString(36).slice(2), returnUrl })).toString('base64url');

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  router.get('/auth/gmail/callback', async (req: Request, res: Response) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    let userId: number | undefined;
    let returnUrl = '/';
    if (state) { try { const d = JSON.parse(Buffer.from(state, 'base64url').toString()); userId = d.userId; returnUrl = d.returnUrl || '/'; } catch {} }
    if (oauthError || !code) { res.redirect(`${returnUrl}?gmail_error=${encodeURIComponent(oauthError || 'no_code')}`); return; }

    try {
      const { clientId, clientSecret, redirectUri } = config.gmail.oauth;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) { res.redirect(`${returnUrl}?gmail_error=token_exchange_failed`); return; }
      const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in: number };

      // Get user email
      const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profile = await profileRes.json() as { emailAddress?: string };
      const emailAddress = profile.emailAddress || '';

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      await pool.query(`
        INSERT INTO email_oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, email_address)
        VALUES ($1, 'gmail', $2, $3, $4, $5)
        ON CONFLICT (user_id, provider) DO UPDATE SET
          access_token = EXCLUDED.access_token, refresh_token = COALESCE(EXCLUDED.refresh_token, email_oauth_tokens.refresh_token),
          expires_at = EXCLUDED.expires_at, email_address = EXCLUDED.email_address, updated_at = NOW()
      `, [userId, tokens.access_token, tokens.refresh_token || null, expiresAt, emailAddress]);

      res.redirect(`${returnUrl}?gmail_connected=1`);
    } catch (err) {
      console.error('[Gmail OAuth] Callback error:', err);
      res.redirect(`${returnUrl}?gmail_error=callback_failed`);
    }
  });

  router.get('/auth/gmail/status', authMiddleware, asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT email_address, expires_at, updated_at FROM email_oauth_tokens WHERE user_id = $1 AND provider = $2',
      [req.user!.id, 'gmail']
    );
    if (!rows.length) { res.json({ connected: false }); return; }
    const t = rows[0];
    res.json({ connected: true, emailAddress: t.email_address, expiresAt: t.expires_at, isExpired: new Date(t.expires_at) < new Date(), connectedAt: t.updated_at });
  }));

  router.delete('/auth/gmail', authMiddleware, asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM email_oauth_tokens WHERE user_id = $1 AND provider = $2', [req.user!.id, 'gmail']);
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

  // ==================== PLATFORM SETTINGS ====================

  // GET /platform/settings/public — authenticated users read all flags as { key: boolean }
  router.get('/platform/settings/public', authMiddleware, asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT key, value FROM platform_settings ORDER BY key'
    );
    const result: Record<string, boolean> = {};
    for (const row of rows) {
      result[row.key] = row.value === 'true';
    }
    res.json(result);
  }));

  // GET /platform/settings — admin reads full settings list
  router.get('/platform/settings', authMiddleware, adminMiddleware, asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT key, value, description, updated_at FROM platform_settings ORDER BY key'
    );
    res.json(rows);
  }));

  // PUT /platform/settings/:key — admin updates a flag
  router.put('/platform/settings/:key', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;
    if (value !== 'true' && value !== 'false') {
      res.status(400).json({ error: 'value must be "true" or "false"' });
      return;
    }
    const { rowCount } = await pool.query(
      'UPDATE platform_settings SET value = $1, updated_at = NOW() WHERE key = $2',
      [value, key]
    );
    if (rowCount === 0) {
      res.status(404).json({ error: 'Setting not found' });
      return;
    }
    res.json({ key, value });
  }));

  // ==================== CREDITS ADMIN ====================

  // GET /admin/credits — all users' balances
  router.get('/admin/credits', authMiddleware, adminMiddleware, asyncHandler(async (_req, res) => {
    const { getAllBalances } = await import('./connectors/creditService.js');
    const balances = await getAllBalances();
    res.json(balances);
  }));

  // PUT /admin/credits/:userId — add credits or set allocation
  router.put('/admin/credits/:userId', authMiddleware, adminMiddleware, asyncHandler(async (req, res) => {
    const { addCredits, setMonthlyAllocation, getBalance } = await import('./connectors/creditService.js');
    const userId = parseInt(req.params.userId);
    const { addAmount, monthlyAllocation } = req.body as { addAmount?: number; monthlyAllocation?: number };

    if (addAmount && addAmount > 0) {
      await addCredits(userId, addAmount, `Rechargement admin (+${addAmount})`, 'allocation');
    }
    if (monthlyAllocation !== undefined && monthlyAllocation >= 0) {
      await setMonthlyAllocation(userId, monthlyAllocation);
    }

    const balance = await getBalance(userId);
    res.json(balance);
  }));

  // POST /admin/credits/reset-monthly — reset all users
  router.post('/admin/credits/reset-monthly', authMiddleware, adminMiddleware, asyncHandler(async (_req, res) => {
    const { resetMonthlyCredits } = await import('./connectors/creditService.js');
    const count = await resetMonthlyCredits();
    res.json({ success: true, usersReset: count });
  }));

  // ==================== Resource Sharing ====================

  // Get sharing config for a resource
  router.get('/sharing/:resourceType/:resourceId', authMiddleware, asyncHandler(async (req, res) => {
    const { getResourceSharing } = await import('./shared/resourceSharing.js');
    const sharing = await getResourceSharing(
      req.params.resourceType as 'roadmap' | 'delivery' | 'suivitess',
      req.params.resourceId
    );
    if (!sharing) {
      res.json({ ownerId: null, visibility: 'private', shares: [] });
      return;
    }
    res.json(sharing);
  }));

  // Update sharing config (visibility + shares)
  router.put('/sharing/:resourceType/:resourceId', authMiddleware, asyncHandler(async (req, res) => {
    const { setVisibility, shareWithEmail, unshare, getResourceSharing, ensureOwnership } = await import('./shared/resourceSharing.js');
    const resourceType = req.params.resourceType as 'roadmap' | 'delivery' | 'suivitess';
    const resourceId = req.params.resourceId;
    const { visibility, sharedEmails, addEmail } = req.body as {
      visibility?: 'private' | 'public';
      sharedEmails?: string[];
      addEmail?: string;
    };

    // Ensure ownership entry exists
    await ensureOwnership(resourceType, resourceId, req.user!.id);

    if (visibility) {
      await setVisibility(resourceType, resourceId, visibility);
    }

    // Add a single email share
    if (addEmail) {
      const result = await shareWithEmail(resourceType, resourceId, addEmail, req.user!.id);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
    }

    if (sharedEmails !== undefined) {
      // Get current shares
      const current = await getResourceSharing(resourceType, resourceId);
      const currentEmails = new Set(current?.shares.map(s => s.email) || []);
      const targetEmails = new Set(sharedEmails);

      // Remove shares no longer in the list
      for (const share of current?.shares || []) {
        if (!targetEmails.has(share.email)) {
          await unshare(resourceType, resourceId, share.userId);
        }
      }

      // Add new shares
      const errors: string[] = [];
      for (const email of sharedEmails) {
        if (!currentEmails.has(email)) {
          const result = await shareWithEmail(resourceType, resourceId, email, req.user!.id);
          if (!result.success && result.error) errors.push(result.error);
        }
      }

      if (errors.length > 0) {
        res.json({ success: true, warnings: errors });
        return;
      }
    }

    res.json({ success: true });
  }));

  // Remove a single share
  router.delete('/sharing/:resourceType/:resourceId/:userId', authMiddleware, asyncHandler(async (req, res) => {
    const { unshare } = await import('./shared/resourceSharing.js');
    await unshare(
      req.params.resourceType as 'roadmap' | 'delivery' | 'suivitess',
      req.params.resourceId,
      parseInt(req.params.userId)
    );
    res.json({ success: true });
  }));

  // List all users (for sharing autocomplete)
  router.get('/users/list', authMiddleware, asyncHandler(async (_req, res) => {
    const result = await pool.query('SELECT id, email FROM users WHERE is_active = true ORDER BY email');
    res.json(result.rows.map((r: { id: number; email: string }) => ({ id: r.id, email: r.email })));
  }));

  return router;
}
