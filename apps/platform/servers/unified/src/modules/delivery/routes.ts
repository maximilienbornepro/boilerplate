import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';

export function createDeliveryRoutes(): Router {
  const router = Router();
  router.use(authMiddleware);

  // ============ Tasks CRUD ============

  // Get all tasks for an increment
  router.get('/tasks/:incrementId', asyncHandler(async (req, res) => {
    const tasks = await db.getAllTasks(req.params.incrementId);
    res.json(tasks);
  }));

  // Create a new task
  router.post('/tasks', asyncHandler(async (req, res) => {
    const { title, type, status, storyPoints, estimatedDays, assignee, priority, incrementId, sprintName } = req.body;

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const task = await db.createTask({
      title,
      type,
      status,
      storyPoints,
      estimatedDays,
      assignee,
      priority,
      incrementId,
      sprintName,
    });
    res.status(201).json(task);
  }));

  // Update a task
  router.put('/tasks/:id', asyncHandler(async (req, res) => {
    const task = await db.updateTask(req.params.id, req.body);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  }));

  // Delete a task
  router.delete('/tasks/:id', asyncHandler(async (req, res) => {
    const deleted = await db.deleteTask(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ success: true });
  }));

  // ============ Positions ============

  // Get all positions for an increment
  router.get('/positions/:incrementId', asyncHandler(async (req, res) => {
    const positions = await db.getTaskPositions(req.params.incrementId);
    res.json(positions);
  }));

  // Save or update a task position
  router.post('/positions', asyncHandler(async (req, res) => {
    const { taskId, incrementId, startCol, endCol, row } = req.body;

    if (!taskId || !incrementId) {
      res.status(400).json({ error: 'taskId and incrementId are required' });
      return;
    }

    await db.saveTaskPosition({
      taskId,
      incrementId,
      startCol: startCol ?? 0,
      endCol: endCol ?? 1,
      row: row ?? 0,
    });

    res.json({ success: true });
  }));

  // Delete a task position
  router.delete('/positions/:incrementId/:taskId', asyncHandler(async (req, res) => {
    await db.deleteTaskPosition(req.params.incrementId, req.params.taskId);
    res.json({ success: true });
  }));

  // ============ Increment State ============

  // Get increment state
  router.get('/increment-state/:incrementId', asyncHandler(async (req, res) => {
    const state = await db.getIncrementState(req.params.incrementId);
    res.json(state);
  }));

  // Toggle freeze
  router.put('/increment-state/:incrementId/freeze', asyncHandler(async (req, res) => {
    const state = await db.toggleIncrementFreeze(req.params.incrementId);
    res.json(state);
  }));

  // Hide a task
  router.post('/increment-state/:incrementId/hide', asyncHandler(async (req, res) => {
    const { taskId } = req.body;
    const hiddenTasks = await db.hideTaskInIncrement(req.params.incrementId, taskId);
    res.json({ hiddenTasks });
  }));

  // Restore tasks
  router.post('/increment-state/:incrementId/restore', asyncHandler(async (req, res) => {
    const { taskIds } = req.body;
    const hiddenTasks = await db.restoreTasksInIncrement(req.params.incrementId, taskIds);
    res.json({ hiddenTasks });
  }));

  // ============ Snapshots ============

  // Get snapshots for an increment
  router.get('/snapshots/:incrementId', asyncHandler(async (req, res) => {
    const snapshots = await db.getSnapshots(req.params.incrementId);
    res.json(snapshots);
  }));

  // Get snapshot detail
  router.get('/snapshots/detail/:id', asyncHandler(async (req, res) => {
    const snapshot = await db.getSnapshotById(parseInt(req.params.id));
    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }
    res.json(snapshot);
  }));

  // Create a snapshot
  router.post('/snapshots/:incrementId', asyncHandler(async (req, res) => {
    const snapshot = await db.createSnapshot(req.params.incrementId);
    res.json(snapshot);
  }));

  // Restore a snapshot
  router.post('/snapshots/restore/:id', asyncHandler(async (req, res) => {
    await db.restoreFromSnapshot(parseInt(req.params.id));
    res.json({ success: true });
  }));

  // Ensure daily snapshot
  router.post('/snapshots/:incrementId/ensure', asyncHandler(async (req, res) => {
    const created = await db.ensureDailySnapshot(req.params.incrementId);
    res.json({ created, date: new Date().toISOString().split('T')[0] });
  }));

  return router;
}
