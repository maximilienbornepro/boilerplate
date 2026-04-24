import { Router } from 'express';
import multer from 'multer';
import { route } from '../../../gateway/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from '../services/dbService.js';
import { initPgvector } from '../services/dbService.js';
import { getEmbeddingDimension } from '../services/embeddingService.js';
import * as indexing from '../services/indexingService.js';
import { fetchSpaces, isConfluenceConfigured } from '../services/confluenceService.js';
import { streamRagResponse, generateSuggestedQuestions } from '../services/ragService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/json',
      'text/plain',
      'text/markdown',
      'text/csv',
    ];
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const allowedExts = ['pdf', 'docx', 'doc', 'json', 'txt', 'md', 'csv'];
    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Format non supporté : ${file.mimetype}`));
    }
  },
});

export function createBotRouter(): Router {
  const router = Router();
  // Bot indexing accepts 50 MB file uploads via multer. Multer enforces
  // its own 50 MB cap, and the global express.json 25 MB cap only
  // applies to JSON bodies (multer bypasses it). Disable the gateway
  // body-limit check so multer sees the file stream.
  router.use(...route({ tier: 'authenticated', bodyLimit: false }));

  // GET /bots — liste des RAG de l'utilisateur
  router.get('/', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const bots = await db.getRagBots(userId);
    res.json(bots);
  }));

  // POST /bots — créer un RAG
  router.post('/', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const { name, description } = req.body as { name: string; description?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Le nom est obligatoire' });
      return;
    }
    const bot = await db.createRagBot(userId, name.trim(), description?.trim());
    res.status(201).json(bot);
  }));

  // PUT /bots/:id — modifier un RAG
  router.put('/:id', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const { name, description } = req.body as { name?: string; description?: string };
    const bot = await db.updateRagBot(id, userId, { name, description });
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    res.json(bot);
  }));

  // DELETE /bots/:id — supprimer un RAG
  router.delete('/:id', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const ok = await db.deleteRagBot(id, userId);
    if (!ok) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    res.json({ ok: true });
  }));

  // GET /bots/:id/status
  router.get('/:id/status', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const bot = await db.getRagBot(id, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    if (!db.isPgvectorAvailable()) {
      await initPgvector(getEmbeddingDimension());
    }
    const status = indexing.getIndexingStatus();
    const stats = await db.getBotChunkStats(id);
    res.json({ ...status, ...stats });
  }));

  // GET /bots/:id/documents
  router.get('/:id/documents', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const bot = await db.getRagBot(id, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    const docs = await db.getDocuments(id);
    res.json(docs);
  }));

  // POST /bots/:id/upload
  router.post('/:id/upload', upload.single('file'), asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const ragId = parseInt(req.params.id, 10);
    if (isNaN(ragId)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const bot = await db.getRagBot(ragId, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) { res.status(400).json({ error: 'Aucun fichier reçu' }); return; }
    const result = await indexing.indexDocumentBuffer(file.originalname, file.buffer, userId, ragId);
    res.status(201).json({ document: result });
  }));

  // DELETE /bots/:id/documents/:docId
  router.delete('/:id/documents/:docId', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const ragId = parseInt(req.params.id, 10);
    const docId = parseInt(req.params.docId, 10);
    if (isNaN(ragId) || isNaN(docId)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const bot = await db.getRagBot(ragId, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    await db.deleteChunksByDocument(docId);
    await db.deleteDocument(docId);
    res.json({ ok: true });
  }));

  // GET /bots/:id/suggestions — LLM-generated questions based on indexed content
  router.get('/:id/suggestions', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const bot = await db.getRagBot(id, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    const questions = await generateSuggestedQuestions(id);
    res.json({ questions });
  }));

  // GET /bots/:id/confluence/configured
  router.get('/:id/confluence/configured', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const configured = await isConfluenceConfigured(userId);
    res.json({ configured });
  }));

  // GET /bots/:id/confluence/available
  router.get('/:id/confluence/available', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const spaces = await fetchSpaces(userId);
    res.json(spaces);
  }));

  // GET /bots/:id/confluence/spaces
  router.get('/:id/confluence/spaces', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const ragId = parseInt(req.params.id, 10);
    if (isNaN(ragId)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const bot = await db.getRagBot(ragId, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    const spaces = await db.getBotConfluenceSpaces(ragId);
    res.json(spaces);
  }));

  // POST /bots/:id/confluence/spaces
  router.post('/:id/confluence/spaces', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const ragId = parseInt(req.params.id, 10);
    if (isNaN(ragId)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const bot = await db.getRagBot(ragId, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    const { spaces } = req.body as { spaces: { key: string; name: string }[] };
    await db.saveBotConfluenceSpaces(ragId, spaces);
    res.json({ ok: true });
  }));

  // POST /bots/:id/confluence/trigger
  router.post('/:id/confluence/trigger', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const ragId = parseInt(req.params.id, 10);
    if (isNaN(ragId)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const bot = await db.getRagBot(ragId, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }
    const selected = await db.getBotConfluenceSpaces(ragId);
    if (selected.length === 0) {
      res.status(400).json({ error: 'No Confluence spaces selected' });
      return;
    }
    indexing.triggerConfluenceIndexing(userId, selected.map((s) => s.spaceKey), ragId);
    res.json({ started: true });
  }));

  // GET /bots/:id/conversations
  router.get('/:id/conversations', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const conversations = await db.getConversations(userId);
    res.json(conversations);
  }));

  // POST /bots/:id/conversations
  router.post('/:id/conversations', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const { title } = req.body;
    const conversation = await db.createConversation(userId, title ?? null);
    res.status(201).json(conversation);
  }));

  // DELETE /bots/:id/conversations/:convId
  router.delete('/:id/conversations/:convId', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    await db.deleteConversation(Number(req.params.convId), userId);
    res.status(204).end();
  }));

  // GET /bots/:id/conversations/:convId/messages
  router.get('/:id/conversations/:convId/messages', asyncHandler(async (req, res) => {
    const messages = await db.getMessages(Number(req.params.convId));
    res.json(messages);
  }));

  // POST /bots/:id/chat (SSE streaming, scoped to bot)
  router.post('/:id/chat', async (req, res) => {
    const userId = (req as any).user.id;
    const ragId = parseInt(req.params.id, 10);
    const { content, conversationId } = req.body as { content: string; conversationId?: number };

    if (!content?.trim()) {
      res.status(400).json({ error: 'Message content required' });
      return;
    }

    const bot = await db.getRagBot(ragId, userId);
    if (!bot) { res.status(404).json({ error: 'RAG non trouvé' }); return; }

    let convId = conversationId;
    if (!convId) {
      const conv = await db.createConversation(userId, content.slice(0, 60));
      convId = conv.id;
    }

    await db.saveMessage(convId, 'user', content);
    const history = await db.getMessages(convId);
    const recentHistory = history.slice(-10).map((m) => ({ role: m.role, content: m.content }));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send conversationId so frontend can track it
    res.write(`data: ${JSON.stringify({ type: 'conversationId', id: convId })}\n\n`);

    const { fullText, sources } = await streamRagResponse(res, content, recentHistory.slice(0, -1), ragId);

    if (fullText) {
      await db.saveMessage(convId, 'assistant', fullText, sources);
    }
    await db.touchConversation(convId);
    res.end();
  });

  return router;
}
