import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';

export async function initDb() {
  await db.initPool();
}

export function createCongesRoutes(): Router {
  const router = Router();

  router.use(authMiddleware);

  // GET /members
  router.get('/members', asyncHandler(async (_req, res) => {
    const members = await db.getCongesUsers();
    res.json(members);
  }));

  // PUT /members/:id
  router.put('/members/:id', asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: 'ID utilisateur invalide' });
      return;
    }
    const { color, sortOrder } = req.body;
    await db.updateUserPreferences(userId, { color, sortOrder });
    res.json({ success: true });
  }));

  // GET /leaves?startDate=&endDate=
  router.get('/leaves', asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      res.status(400).json({ error: 'Les parametres startDate et endDate sont requis' });
      return;
    }
    const leaves = await db.getLeavesByPeriod(startDate as string, endDate as string);
    res.json(leaves);
  }));

  // POST /leaves
  router.post('/leaves', asyncHandler(async (req, res) => {
    const { memberId, startDate, endDate, startPeriod, endPeriod, reason } = req.body;
    const user = (req as any).user;

    if (!memberId || !startDate || !endDate) {
      res.status(400).json({ error: 'memberId, startDate et endDate sont requis' });
      return;
    }

    if (!user.isAdmin && memberId !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez creer des conges que pour vous-meme' });
      return;
    }

    const leave = await db.createLeave(memberId, startDate, endDate, {
      startPeriod,
      endPeriod,
      reason,
      createdBy: user.id,
    });
    res.status(201).json(leave);
  }));

  // PUT /leaves/:id
  router.put('/leaves/:id', asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const existing = await db.getLeaveById(req.params.id);

    if (!existing) {
      res.status(404).json({ error: 'Conge non trouve' });
      return;
    }
    if (!user.isAdmin && existing.memberId !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres conges' });
      return;
    }

    const { startDate, endDate, startPeriod, endPeriod, reason } = req.body;
    const leave = await db.updateLeave(req.params.id, { startDate, endDate, startPeriod, endPeriod, reason });
    if (!leave) {
      res.status(404).json({ error: 'Conge non trouve' });
      return;
    }
    res.json(leave);
  }));

  // DELETE /leaves/:id
  router.delete('/leaves/:id', asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const existing = await db.getLeaveById(req.params.id);

    if (!existing) {
      res.status(404).json({ error: 'Conge non trouve' });
      return;
    }
    if (!user.isAdmin && existing.memberId !== user.id) {
      res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres conges' });
      return;
    }

    await db.deleteLeave(req.params.id);
    res.json({ success: true });
  }));

  return router;
}
