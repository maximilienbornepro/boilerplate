import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { requireFeature, isFeatureEnabled, initFeatureFlags, __setFeatureFlagForTests } from '../featureFlags.js';

const fakePool: any = {
  query: async () => ({ rows: [{ key: 'module_x_enabled', value: 'true' }] }),
};

function setupApp() {
  const app = express();
  app.get('/x', requireFeature('module_x_enabled'), (_req, res) => { res.json({ ok: true }); });
  app.get('/y', requireFeature('module_y_enabled'), (_req, res) => { res.json({ ok: true }); });
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

describe('gateway/featureFlags', () => {
  beforeEach(() => {
    initFeatureFlags(fakePool);
  });

  it('fails open: missing key is considered enabled', async () => {
    __setFeatureFlagForTests('module_x_enabled', true);
    // 'module_y_enabled' was never set — default is enabled.
    const res = await get(setupApp(), '/y');
    expect(res.status).toBe(200);
  });

  it('responds 503 when a flag is explicitly disabled', async () => {
    __setFeatureFlagForTests('module_x_enabled', false);
    const res = await get(setupApp(), '/x');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/desactivee/);
  });

  it('isFeatureEnabled returns the cached value', async () => {
    __setFeatureFlagForTests('foo', false);
    expect(await isFeatureEnabled('foo')).toBe(false);
    __setFeatureFlagForTests('foo', true);
    expect(await isFeatureEnabled('foo')).toBe(true);
  });

  it('isFeatureEnabled defaults true for unknown keys', async () => {
    expect(await isFeatureEnabled('never_set_key')).toBe(true);
  });
});
