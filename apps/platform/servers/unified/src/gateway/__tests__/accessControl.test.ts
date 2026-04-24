import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { route } from '../accessControl.js';
import { __setUserPermissionsForTests, initUserPermissions } from '../userPermissions.js';
import { config } from '../../config.js';

// Mock PG pool — only needs `.query` for userPermissions.ts.
const fakePool = {
  query: async () => ({ rows: [], rowCount: 0 }),
} as any;

function tokenFor(user: { id: number; email: string; isAdmin: boolean }) {
  return jwt.sign({ ...user, isActive: true }, config.jwtSecret, { expiresIn: '1h' });
}

function setupApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Mutating requests get CSRF-checked — feed an Origin that matches
  // the allowlist so we test auth/role logic in isolation.
  app.use((req, _res, next) => {
    req.headers.origin = req.headers.origin ?? 'http://localhost:5173';
    next();
  });
  app.get('/pub',   ...route({ tier: 'public' }),         (_req, res) => { res.json({ ok: true }); });
  app.get('/auth',  ...route({ tier: 'authenticated' }),  (_req, res) => { res.json({ ok: true }); });
  app.get('/admin', ...route({ tier: 'admin' }),          (_req, res) => { res.json({ ok: true }); });
  app.get('/role',  ...route({ tier: 'role', permission: 'roadmap' }), (_req, res) => { res.json({ ok: true }); });
  return app;
}

async function call(app: express.Express, path: string, cookie?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      fetch(`http://127.0.0.1:${addr.port}${path}`, {
        headers: cookie ? { cookie: `auth_token=${cookie}` } : {},
      })
        .then(async r => { server.close(); resolve({ status: r.status, body: await r.json() }); })
        .catch(reject);
    });
  });
}

describe('gateway/accessControl', () => {
  beforeEach(() => {
    initUserPermissions(fakePool);
  });

  describe('tier: public', () => {
    it('accepts unauthenticated requests', async () => {
      const res = await call(setupApp(), '/pub');
      expect(res.status).toBe(200);
    });
  });

  describe('tier: authenticated', () => {
    it('rejects without a token', async () => {
      const res = await call(setupApp(), '/auth');
      expect(res.status).toBe(401);
    });

    it('accepts with a valid token', async () => {
      const token = tokenFor({ id: 1, email: 'u@x.fr', isAdmin: false });
      const res = await call(setupApp(), '/auth', token);
      expect(res.status).toBe(200);
    });

    it('rejects with an invalid token', async () => {
      const res = await call(setupApp(), '/auth', 'garbage-token');
      expect(res.status).toBe(401);
    });
  });

  describe('tier: admin', () => {
    it('rejects without a token', async () => {
      const res = await call(setupApp(), '/admin');
      expect(res.status).toBe(401);
    });

    it('rejects a non-admin user', async () => {
      const token = tokenFor({ id: 2, email: 'u@x.fr', isAdmin: false });
      const res = await call(setupApp(), '/admin', token);
      expect(res.status).toBe(403);
    });

    it('accepts an admin', async () => {
      const token = tokenFor({ id: 3, email: 'a@x.fr', isAdmin: true });
      const res = await call(setupApp(), '/admin', token);
      expect(res.status).toBe(200);
    });
  });

  describe('tier: role', () => {
    it('accepts an admin even without the permission', async () => {
      const token = tokenFor({ id: 4, email: 'a@x.fr', isAdmin: true });
      const res = await call(setupApp(), '/role', token);
      expect(res.status).toBe(200);
    });

    it('accepts a user holding the permission', async () => {
      __setUserPermissionsForTests(5, ['roadmap', 'delivery']);
      const token = tokenFor({ id: 5, email: 'u@x.fr', isAdmin: false });
      const res = await call(setupApp(), '/role', token);
      expect(res.status).toBe(200);
    });

    it('rejects a user missing the permission', async () => {
      __setUserPermissionsForTests(6, ['delivery']);
      const token = tokenFor({ id: 6, email: 'u@x.fr', isAdmin: false });
      const res = await call(setupApp(), '/role', token);
      expect(res.status).toBe(403);
    });
  });

  it('throws at build time when tier=role has no permission set', () => {
    expect(() => route({ tier: 'role' })).toThrow(/permission/);
  });

  it('throws at build time when tier=embed has no resourceType set', () => {
    expect(() => route({ tier: 'embed' })).toThrow(/resourceType/);
  });
});
