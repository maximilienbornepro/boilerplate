import { describe, it, expect } from 'vitest';
import express from 'express';
import { requestContext } from '../requestContext.js';

function setupApp() {
  const app = express();
  app.use(requestContext);
  app.get('/', (req, res) => { res.json({ id: req.requestId, startedAt: req.startedAt }); });
  return app;
}

async function callApp(app: express.Express, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      fetch(`http://127.0.0.1:${addr.port}/`, { headers })
        .then(async r => {
          const headersObj: Record<string, string> = {};
          r.headers.forEach((v, k) => { headersObj[k] = v; });
          const out = { status: r.status, body: await r.json(), headers: headersObj };
          server.close();
          resolve(out);
        })
        .catch(reject);
    });
  });
}

describe('gateway/requestContext', () => {
  it('generates a UUID when no header is provided', async () => {
    const app = setupApp();
    const res = await callApp(app);
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).toBe(res.body.id);
  });

  it('picks up a well-formed X-Request-ID from upstream', async () => {
    const app = setupApp();
    const res = await callApp(app, { 'X-Request-ID': 'abc123-upstream-id' });
    expect(res.body.id).toBe('abc123-upstream-id');
    expect(res.headers['x-request-id']).toBe('abc123-upstream-id');
  });

  it('rejects malformed X-Request-ID and falls back to UUID', async () => {
    const app = setupApp();
    const res = await callApp(app, { 'X-Request-ID': 'bad id with spaces' });
    expect(res.body.id).not.toBe('bad id with spaces');
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects X-Request-ID with newline injection attempt', async () => {
    const app = setupApp();
    // Headers with raw \n are filtered by node anyway, so test the regex
    // rejection via a more realistic attack surface (special chars).
    const res = await callApp(app, { 'X-Request-ID': 'a"b\\c;d' });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects X-Request-ID that is too short', async () => {
    const app = setupApp();
    const res = await callApp(app, { 'X-Request-ID': 'abc' });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets req.startedAt to current time', async () => {
    const app = setupApp();
    const before = Date.now();
    const res = await callApp(app);
    const after = Date.now();
    expect(res.body.startedAt).toBeGreaterThanOrEqual(before);
    expect(res.body.startedAt).toBeLessThanOrEqual(after);
  });
});
