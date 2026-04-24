import { describe, it, expect } from 'vitest';
import express from 'express';
import { healthCheck, initHealthCheck } from '../healthCheck.js';

function setupApp() {
  const app = express();
  app.get('/gateway/health', healthCheck);
  return app;
}

async function get(app: express.Express, path: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async r => { server.close(); resolve({ status: r.status, body: await r.json() }); })
        .catch(reject);
    });
  });
}

describe('gateway/healthCheck', () => {
  it('returns 200 with ok status when no pool is wired', async () => {
    // Purposely don't initHealthCheck — the endpoint should still answer.
    initHealthCheck(null as any);
    const res = await get(setupApp(), '/gateway/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptimeS).toBe('number');
    expect(res.body.version).toBeDefined();
  });

  it('runs DB ping and reports latency when pool is wired', async () => {
    const fakePool: any = { query: async () => ({ rows: [{ v: 1 }] }) };
    initHealthCheck(fakePool);
    const res = await get(setupApp(), '/gateway/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.database.status).toBe('ok');
    expect(typeof res.body.checks.database.latencyMs).toBe('number');
  });

  it('returns 503 when DB ping throws', async () => {
    const fakePool: any = { query: async () => { throw new Error('PG down'); } };
    initHealthCheck(fakePool);
    const res = await get(setupApp(), '/gateway/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.database.status).toBe('fail');
    expect(res.body.checks.database.error).toContain('PG down');
  });
});
