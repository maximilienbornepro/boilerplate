import { Router } from 'express';
import multer from 'multer';
import { route } from '../../../gateway/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from '../services/dbService.js';
import { initPgvector } from '../services/dbService.js';
import { getEmbeddingDimension } from '../services/embeddingService.js';
import * as indexing from '../services/indexingService.js';
import { fetchSpaces, isConfluenceConfigured } from '../services/confluenceService.js';

// Store files in memory (max 50 MB)
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
    // Also allow by extension when mimetype is generic
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const allowedExts = ['pdf', 'docx', 'doc', 'json', 'txt', 'md', 'csv'];

    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Format non supporté : ${file.mimetype}`));
    }
  },
});

export function createIndexRouter(): Router {
  const router = Router();
  // Indexing accepts 50 MB file uploads via multer — same reasoning as
  // the bot router: disable the gateway body-limit so multer sees the
  // file stream and enforces its own 50 MB cap.
  router.use(...route({ tier: 'authenticated', bodyLimit: false }));

  // GET /index/status — auto-retries pgvector init if it failed at startup
  router.get('/status', asyncHandler(async (_req, res) => {
    if (!db.isPgvectorAvailable()) {
      await initPgvector(getEmbeddingDimension());
    }
    const status = indexing.getIndexingStatus();
    const stats = await db.getChunkStats();
    res.json({ ...status, ...stats });
  }));

  // GET /index/confluence/configured
  router.get('/confluence/configured', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const configured = await isConfluenceConfigured(userId);
    res.json({ configured });
  }));

  // GET /index/confluence/available
  router.get('/confluence/available', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const spaces = await fetchSpaces(userId);
    res.json(spaces);
  }));

  // GET /index/confluence/selected
  router.get('/confluence/selected', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const spaces = await db.getSelectedConfluenceSpaces(userId);
    res.json(spaces);
  }));

  // POST /index/confluence/spaces
  router.post('/confluence/spaces', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const { spaces } = req.body as { spaces: { key: string; name: string }[] };
    await db.saveSelectedConfluenceSpaces(userId, spaces);
    res.json({ ok: true });
  }));

  // POST /index/confluence/trigger
  router.post('/confluence/trigger', asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const selected = await db.getSelectedConfluenceSpaces(userId);
    if (selected.length === 0) {
      res.status(400).json({ error: 'No Confluence spaces selected' });
      return;
    }
    indexing.triggerConfluenceIndexing(userId, selected.map((s) => s.spaceKey));
    res.json({ started: true });
  }));

  // POST /index/upload — multipart/form-data file upload
  router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
    const userId = (req as any).user.id;
    const file = (req as any).file as Express.Multer.File | undefined;

    if (!file) {
      res.status(400).json({ error: 'Aucun fichier reçu' });
      return;
    }

    const result = await indexing.indexDocumentBuffer(
      file.originalname,
      file.buffer,
      userId
    );

    res.status(201).json({ document: result });
  }));

  // GET /index/documents
  router.get('/documents', asyncHandler(async (_req, res) => {
    const docs = await db.getDocuments();
    res.json(docs);
  }));

  // DELETE /index/documents/:id
  router.delete('/documents/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    await db.deleteChunksByDocument(id);
    await db.deleteDocument(id);
    res.json({ ok: true });
  }));

  return router;
}
