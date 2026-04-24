import { describe, it, expect } from 'vitest';
import express from 'express';
import { csrfProtection, isOriginAllowed } from '../csrf.js';

function setupApp() {
  const app = express();
  app.use(express.json());
  app.use(csrfProtection);
  app.get('/read', (_req, res) => { res.json({ ok: true }); });
  app.post('/write', (_req, res) => { res.json({ ok: true }); });
  return app;
}

async function call(
  app: express.Express,
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string> = {}
) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      fetch(`http://127.0.0.1:${addr.port}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: method === 'POST' ? '{}' : undefined,
      })
        .then(r => { server.close(); resolve({ status: r.status }); })
        .catch(reject);
    });
  });
}

describe('gateway/csrf', () => {
  it('lets GET requests through regardless of Origin', async () => {
    const app = setupApp();
    const res = await call(app, 'GET', '/read', { Origin: 'https://evil.com' });
    expect(res.status).toBe(200);
  });

  it('allows POST with same-origin localhost Origin (dev)', async () => {
    const app = setupApp();
    const res = await call(app, 'POST', '/write', { Origin: 'http://localhost:5173' });
    expect(res.status).toBe(200);
  });

  it('allows POST with vitess.tech Origin (prod)', async () => {
    const app = setupApp();
    const res = await call(app, 'POST', '/write', { Origin: 'https://francetv.vitess.tech' });
    expect(res.status).toBe(200);
  });

  it('rejects POST with a foreign Origin', async () => {
    const app = setupApp();
    const res = await call(app, 'POST', '/write', { Origin: 'https://evil.com' });
    expect(res.status).toBe(403);
  });

  it('rejects POST with no Origin and no Referer', async () => {
    const app = setupApp();
    // Node's fetch auto-sets Origin; bypass by using raw http...
    // Actually easier: just verify the rejection path via direct import
    const req: any = {
      method: 'POST',
      headers: {},
      header: (name: string) => undefined,
    };
    const res: any = {
      statusCode: 200,
      status(s: number) { this.statusCode = s; return this; },
      json(body: any) { this.body = body; return this; },
    };
    let called = false;
    csrfProtection(req, res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('exempts Bearer-auth clients from CSRF', async () => {
    const app = setupApp();
    const res = await call(app, 'POST', '/write', {
      Authorization: 'Bearer xyz',
      Origin: 'https://evil.com',
    });
    expect(res.status).toBe(200);
  });

  it('falls back to Referer when Origin is absent', async () => {
    const req: any = {
      method: 'POST',
      headers: {},
      header: (name: string) => name.toLowerCase() === 'referer' ? 'http://localhost:5173/app' : undefined,
    };
    const res: any = {
      statusCode: 200,
      status(s: number) { this.statusCode = s; return this; },
      json(body: any) { this.body = body; return this; },
    };
    let called = false;
    csrfProtection(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('rejects when Referer comes from a foreign origin', async () => {
    const req: any = {
      method: 'DELETE',
      headers: {},
      header: (name: string) => name.toLowerCase() === 'referer' ? 'https://evil.com/attack' : undefined,
    };
    const res: any = {
      statusCode: 200,
      status(s: number) { this.statusCode = s; return this; },
      json() { return this; },
    };
    csrfProtection(req, res, () => {});
    expect(res.statusCode).toBe(403);
  });

  it('isOriginAllowed accepts chrome extension origins', () => {
    expect(isOriginAllowed('chrome-extension://abcdef')).toBe(true);
  });

  it('isOriginAllowed rejects random HTTPS origins', () => {
    expect(isOriginAllowed('https://notvitess.com')).toBe(false);
  });
});
