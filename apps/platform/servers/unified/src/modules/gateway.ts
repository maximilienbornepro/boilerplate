import { Router } from 'express';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { authMiddleware, adminMiddleware } from '../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';

// Available apps for permissions
const AVAILABLE_APPS = ['products', 'conges', 'roadmap', 'suivitess', 'admin'];

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

function generateToken(user: { id: number; email: string; isActive: boolean; isAdmin: boolean }) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      isAdmin: user.isAdmin,
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
      'SELECT id, email, password_hash, is_active, is_admin FROM users WHERE email = $1',
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
        'SELECT id, email, is_active, is_admin FROM users WHERE id = $1',
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
          permissions,
        },
      });
    } catch {
      res.clearCookie('auth_token');
      res.json({ user: null });
    }
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
