import { Router } from 'express';
import { route } from '../../../gateway/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from '../services/dbService.js';
import { streamRagResponse } from '../services/ragService.js';

export function createChatRouter(): Router {
  const router = Router();
  // RAG chat messages can be long (user pasted context), so raise
  // the tier body cap to 5 MB. Multer isn't used here — no file upload.
  router.use(...route({ tier: 'authenticated', bodyLimit: 5 * 1024 * 1024 }));

  // GET /conversations
  router.get('/conversations', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const conversations = await db.getConversations(userId);
    res.json(conversations);
  }));

  // POST /conversations
  router.post('/conversations', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const { title } = req.body;
    const conversation = await db.createConversation(userId, title ?? null);
    res.status(201).json(conversation);
  }));

  // DELETE /conversations/:id
  router.delete('/conversations/:id', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    await db.deleteConversation(Number(req.params.id), userId);
    res.status(204).end();
  }));

  // GET /conversations/:id/messages
  router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
    const messages = await db.getMessages(Number(req.params.id));
    res.json(messages);
  }));

  // POST /conversations/:id/messages (SSE streaming)
  router.post('/conversations/:id/messages', async (req, res) => {
    const userId = (req as any).user.id;
    const conversationId = Number(req.params.id);
    const { content } = req.body;

    if (!content?.trim()) {
      res.status(400).json({ error: 'Message content required' });
      return;
    }

    // Save user message
    await db.saveMessage(conversationId, 'user', content);

    // Get conversation history (last 10 messages for context)
    const history = await db.getMessages(conversationId);
    const recentHistory = history.slice(-10).map((m) => ({ role: m.role, content: m.content }));

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Stream RAG response
    const { fullText, sources } = await streamRagResponse(res, content, recentHistory.slice(0, -1));

    // Save assistant message
    if (fullText) {
      await db.saveMessage(conversationId, 'assistant', fullText, sources);
    }

    // Update conversation title from first message if not set
    const conv = await db.getConversations(userId);
    const thisConv = conv.find((c) => c.id === conversationId);
    if (thisConv && !thisConv.title) {
      const title = content.slice(0, 60);
      await db.touchConversation(conversationId);
    }

    await db.touchConversation(conversationId);
    res.end();
  });

  return router;
}
