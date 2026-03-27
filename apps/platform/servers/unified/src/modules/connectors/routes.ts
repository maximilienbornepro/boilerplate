import { Router } from 'express';
import { config } from '../../config.js';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';

export function createConnectorsRoutes(): Router {
  const router = Router();

  // GET /jira/oauth-available — Public check if OAuth is configured
  router.get('/jira/oauth-available', (_req, res) => {
    const available = !!(config.jira.oauth.clientId && config.jira.oauth.clientSecret);
    res.json({ available });
  });

  router.use(authMiddleware);

  // GET / — List all connectors for current user
  router.get('/', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const connectors = await db.getConnectorsByUser(userId);

    // Return sanitized configs (mask tokens)
    const sanitized = connectors.map(c => ({
      ...c,
      config: db.sanitizeConfig(c.service, c.config),
    }));

    res.json(sanitized);
  }));

  // PUT /:service — Create or update connector config
  router.put('/:service', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { service } = req.params;

    if (!db.SUPPORTED_SERVICES.includes(service as db.ServiceType)) {
      res.status(400).json({ error: `Service non supporte: ${service}` });
      return;
    }

    const { config: connectorConfig } = req.body;
    if (!connectorConfig || typeof connectorConfig !== 'object') {
      res.status(400).json({ error: 'Configuration requise' });
      return;
    }

    // Validate service-specific fields
    if (service === 'jira') {
      const { baseUrl, email, apiToken } = connectorConfig;
      if (!baseUrl || !email || !apiToken) {
        res.status(400).json({ error: 'baseUrl, email et apiToken sont requis pour Jira' });
        return;
      }
    }

    // If updating, merge apiToken if masked
    if (service === 'jira' && connectorConfig.apiToken && connectorConfig.apiToken.includes('****')) {
      const existing = await db.getConnector(userId, service);
      if (existing) {
        connectorConfig.apiToken = (existing.config as any).apiToken;
      }
    }

    const connector = await db.upsertConnector(userId, service, connectorConfig);
    res.json({
      ...connector,
      config: db.sanitizeConfig(connector.service, connector.config),
    });
  }));

  // DELETE /:service — Delete connector
  router.delete('/:service', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { service } = req.params;

    const deleted = await db.deleteConnector(userId, service);
    if (!deleted) {
      res.status(404).json({ error: 'Connecteur non trouve' });
      return;
    }

    res.json({ success: true });
  }));

  // POST /:service/test — Test connection
  router.post('/:service/test', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { service } = req.params;

    const connector = await db.getConnector(userId, service);
    if (!connector) {
      res.status(404).json({ error: 'Connecteur non configure' });
      return;
    }

    if (service === 'jira') {
      const { baseUrl, email, apiToken } = connector.config as {
        baseUrl: string;
        email: string;
        apiToken: string;
      };

      try {
        const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/myself`;
        const authHeader = Buffer.from(`${email}:${apiToken}`).toString('base64');

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          await db.markConnectorTested(userId, service, false);
          res.status(400).json({
            error: `Echec de connexion Jira (${response.status})`,
            details: errorText.substring(0, 200),
          });
          return;
        }

        const data = await response.json();
        await db.markConnectorTested(userId, service, true);

        res.json({
          success: true,
          user: {
            displayName: data.displayName,
            accountId: data.accountId,
          },
        });
      } catch (err) {
        await db.markConnectorTested(userId, service, false);
        res.status(400).json({
          error: 'Impossible de se connecter a Jira',
          details: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    } else {
      res.status(400).json({ error: `Test non disponible pour le service: ${service}` });
    }
  }));

  return router;
}
