import { describe, it, expect } from 'vitest';
import express from 'express';
import { bodyLimit, getBodyLimit } from '../bodyLimits.js';

function setupApp(tier: any) {
  const app = express();
  app.use(bodyLimit(tier));
  app.use(express.json({ limit: '25mb' }));
  app.post('/', (_req, res) => { res.json({ ok: true }); });
  return app;
}

async function post(app: express.Express, body: string) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      fetch(`http://127.0.0.1:${addr.port}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
        body,
      })
        .then(r => { server.close(); resolve({ status: r.status }); })
        .catch(reject);
    });
  });
}

describe('gateway/bodyLimits', () => {
  it('rejects oversized public payloads (413)', async () => {
    const app = setupApp('public');
    // 10 KB max for public tier — send 20 KB.
    const body = JSON.stringify({ data: 'x'.repeat(20_000) });
    const res = await post(app, body);
    expect(res.status).toBe(413);
  });

  it('accepts under-limit public payloads', async () => {
    const app = setupApp('public');
    const body = JSON.stringify({ data: 'x'.repeat(100) });
    const res = await post(app, body);
    expect(res.status).toBe(200);
  });

  it('allows larger payloads on admin tier', async () => {
    const app = setupApp('admin');
    const body = JSON.stringify({ data: 'x'.repeat(200_000) });
    const res = await post(app, body);
    expect(res.status).toBe(200);
  });

  it('tier ceilings respect the documented hierarchy', () => {
    expect(getBodyLimit('public')).toBeLessThan(getBodyLimit('authenticated'));
    expect(getBodyLimit('authenticated')).toBeLessThan(getBodyLimit('admin'));
    expect(getBodyLimit('embed')).toBe(getBodyLimit('public'));
  });
});
