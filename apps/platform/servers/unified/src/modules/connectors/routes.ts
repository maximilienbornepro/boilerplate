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

  // GET /outlook/oauth-available
  router.get('/outlook/oauth-available', (_req, res) => {
    const available = !!(config.outlook.oauth.clientId && config.outlook.oauth.clientSecret);
    res.json({ available });
  });

  // GET /gmail/oauth-available
  router.get('/gmail/oauth-available', (_req, res) => {
    const available = !!(config.gmail.oauth.clientId && config.gmail.oauth.clientSecret);
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
    } else if (service === 'anthropic') {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({ apiKey: connector.config.apiKey as string });
        const response = await client.messages.create({
          model: (connector.config.model as string) || 'claude-sonnet-4-6',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Dis "ok"' }],
        });
        await db.markConnectorTested(userId, service, true);
        res.json({ success: true, model: response.model });
      } catch (err) {
        await db.markConnectorTested(userId, service, false);
        res.status(400).json({
          error: 'Echec de connexion Anthropic',
          details: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    } else if (service === 'openai') {
      try {
        const OpenAI = (await import('openai')).default;
        const client = new OpenAI({ apiKey: connector.config.apiKey as string });
        const response = await client.chat.completions.create({
          model: (connector.config.model as string) || 'gpt-4o',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say ok' }],
        });
        await db.markConnectorTested(userId, service, true);
        res.json({ success: true, model: response.model });
      } catch (err) {
        await db.markConnectorTested(userId, service, false);
        res.status(400).json({
          error: 'Echec de connexion OpenAI',
          details: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    } else if (service === 'mistral') {
      try {
        const OpenAI = (await import('openai')).default;
        const client = new OpenAI({
          apiKey: connector.config.apiKey as string,
          baseURL: (connector.config.baseUrl as string) || 'https://api.mistral.ai/v1',
        });
        const response = await client.chat.completions.create({
          model: (connector.config.model as string) || 'mistral-large-latest',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Dis ok' }],
        });
        await db.markConnectorTested(userId, service, true);
        res.json({ success: true, model: response.model });
      } catch (err) {
        await db.markConnectorTested(userId, service, false);
        res.status(400).json({
          error: 'Echec de connexion Mistral',
          details: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    } else if (service === 'scaleway') {
      try {
        const OpenAI = (await import('openai')).default;
        const client = new OpenAI({
          apiKey: connector.config.apiKey as string,
          baseURL: connector.config.baseUrl as string,
        });
        const response = await client.chat.completions.create({
          model: (connector.config.chatModel as string) || 'qwen3-32b',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say ok' }],
        });
        await db.markConnectorTested(userId, service, true);
        res.json({ success: true, model: response.model });
      } catch (err) {
        await db.markConnectorTested(userId, service, false);
        res.status(400).json({
          error: 'Echec de connexion Scaleway',
          details: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    } else if (service === 'fathom') {
      try {
        const { listFathomCalls } = await import('../suivitess/fathomService.js');
        const calls = await listFathomCalls(userId, 7);
        await db.markConnectorTested(userId, service, true);
        res.json({ success: true, message: `${calls.length} appels recents trouves` });
      } catch (err) {
        await db.markConnectorTested(userId, service, false);
        res.status(400).json({
          error: 'Echec de connexion Fathom',
          details: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    } else if (service === 'otter') {
      try {
        const { listOtterCalls } = await import('../suivitess/otterService.js');
        const calls = await listOtterCalls(userId, 7);
        await db.markConnectorTested(userId, service, true);
        res.json({ success: true, message: `${calls.length} conversations recentes trouvees` });
      } catch (err) {
        await db.markConnectorTested(userId, service, false);
        res.status(400).json({
          error: 'Echec de connexion Otter',
          details: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    } else if (service === 'notion') {
      try {
        const { listNotionDatabases } = await import('../suivitess/notionService.js');
        const dbs = await listNotionDatabases(userId);
        await db.markConnectorTested(userId, service, true);
        res.json({ success: true, message: `${dbs.length} database${dbs.length > 1 ? 's' : ''} accessible${dbs.length > 1 ? 's' : ''}` });
      } catch (err) {
        await db.markConnectorTested(userId, service, false);
        res.status(400).json({
          error: 'Echec de connexion Notion',
          details: err instanceof Error ? err.message : 'Erreur inconnue',
        });
      }
    } else {
      res.status(400).json({ error: `Test non disponible pour le service: ${service}` });
    }
  }));

  // GET /ai-usage — AI consumption summary per provider (last 30 days)
  router.get('/ai-usage', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const days = parseInt(req.query.days as string) || 30;
    const usage = await db.getAIUsageByPeriod(userId, days);
    res.json(usage);
  }));

  // ==================== CREDITS ====================

  // GET /credits — current user's credit balance + recent transactions
  router.get('/credits', asyncHandler(async (req, res) => {
    const { getBalance, getRecentTransactions, isCreditSystemEnabled, getCreditCosts } = await import('./creditService.js');
    const userId = req.user!.id;
    const enabled = await isCreditSystemEnabled();
    const balance = await getBalance(userId);
    const transactions = await getRecentTransactions(userId, 20);
    res.json({ enabled, ...balance, transactions });
  }));

  // GET /credits/costs — full cost table
  router.get('/credits/costs', asyncHandler(async (_req, res) => {
    const { getCreditCosts } = await import('./creditService.js');
    res.json(getCreditCosts());
  }));

  return router;
}
