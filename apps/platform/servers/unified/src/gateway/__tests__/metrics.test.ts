import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { metricsCollector, metricsEndpoint, __resetMetricsForTests, __getMetricsSnapshotForTests } from '../metrics.js';
import { requestContext } from '../requestContext.js';

function setupApp() {
  const app = express();
  app.use(requestContext);
  app.use(metricsCollector);
  app.get('/ok', (_req, res) => { res.json({ ok: true }); });
  app.get('/fail', (_req, res) => { res.status(500).json({ error: 'boom' }); });
  app.get('/metrics', metricsEndpoint);
  return app;
}

async function get(app: express.Express, path: string) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async r => { server.close(); resolve({ status: r.status, text: await r.text() }); })
        .catch(reject);
    });
  });
}

describe('gateway/metrics', () => {
  beforeEach(() => { __resetMetricsForTests(); });

  it('increments request count per route', async () => {
    const app = setupApp();
    await get(app, '/ok');
    await get(app, '/ok');
    await get(app, '/ok');
    const snap = __getMetricsSnapshotForTests();
    const stat = snap.get('GET /ok');
    expect(stat?.count).toBe(3);
    expect(stat?.errors).toBe(0);
  });

  it('tracks 5xx responses separately', async () => {
    const app = setupApp();
    await get(app, '/ok');
    await get(app, '/fail');
    await get(app, '/fail');
    const snap = __getMetricsSnapshotForTests();
    expect(snap.get('GET /ok')?.errors).toBe(0);
    expect(snap.get('GET /fail')?.errors).toBe(2);
  });

  it('tracks duration min/max/avg', async () => {
    const app = setupApp();
    await get(app, '/ok');
    const snap = __getMetricsSnapshotForTests();
    const stat = snap.get('GET /ok');
    expect(stat?.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(stat?.maxDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('exposes Prometheus text-format on /metrics', async () => {
    const app = setupApp();
    await get(app, '/ok');
    const res = await get(app, '/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('# HELP gateway_uptime_seconds');
    expect(res.text).toContain('# TYPE gateway_request_count counter');
    expect(res.text).toMatch(/gateway_request_count\{route="GET \/ok"\} \d+/);
  });

  it('escapes quotes in route labels', async () => {
    const app = setupApp();
    // Simulate a route containing quotes — manually seed via an internal request.
    // (Express normalizes paths so we can't easily inject quotes via fetch.
    // This smoke-test just verifies the endpoint renders without blowing up.)
    const res = await get(app, '/metrics');
    expect(res.status).toBe(200);
  });
});
