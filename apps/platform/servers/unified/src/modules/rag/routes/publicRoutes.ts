import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from '../services/dbService.js';
import { streamRagResponse, generateSuggestedQuestions } from '../services/ragService.js';

// Public RAG chat is a zero-auth endpoint that streams LLM tokens —
// a leaked bot UUID could be used to burn through the admin's API
// credits indefinitely. We cap it at 30 chats / 15 min per IP. The
// GET /suggestions endpoint is cheaper but still triggers an LLM
// call, so it gets its own smaller budget too.
const publicChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes — réessaie dans quelques minutes.' },
});
const publicSuggestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes — réessaie dans quelques minutes.' },
});

export function createPublicRouter(): Router {
  const router = Router();

  // GET /public/:uuid — infos publiques du RAG (sans auth)
  router.get('/:uuid', asyncHandler(async (req, res) => {
    const bot = await db.getRagBotByUuid(req.params.uuid);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    res.json({ uuid: bot.uuid, name: bot.name, description: bot.description });
  }));

  // GET /public/:uuid/suggestions — questions suggérées (sans auth)
  router.get('/:uuid/suggestions', publicSuggestLimiter, asyncHandler(async (req, res) => {
    const bot = await db.getRagBotByUuid(req.params.uuid);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    const questions = await generateSuggestedQuestions(bot.id);
    res.json({ questions });
  }));

  // POST /public/:uuid/chat — chat public SSE (sans auth, sans historique persistant)
  router.post('/:uuid/chat', publicChatLimiter, async (req, res) => {
    const bot = await db.getRagBotByUuid(req.params.uuid);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }

    const { content, history = [] } = req.body as {
      content: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
    };

    if (!content?.trim()) {
      res.status(400).json({ error: 'Message content required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    await streamRagResponse(res, content, history, bot.id);
    res.end();
  });

  return router;
}
