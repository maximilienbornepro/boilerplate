import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';
import { searchSubjects as searchSuivitessSubjects } from '../suivitess/dbService.js';
import { deriveOverlayTasks, type DerivedDeliveryTask } from './deliveryOverlay.js';
import { getAnthropicClient } from '../connectors/aiProvider.js';

export async function initDb() {
  await db.initPool();
  await db.ensureTaskSubjectsTable();
  await db.ensurePlanningDeliveryBoardsTable();

  // Migration: add owner_id to plannings (rétro-compat: nullable, backfill to admin)
  try {
    await db.rawQuery('ALTER TABLE roadmap_plannings ADD COLUMN IF NOT EXISTS owner_id INTEGER');
    await db.rawQuery('UPDATE roadmap_plannings SET owner_id = 1 WHERE owner_id IS NULL');
  } catch { /* already done */ }

  // Backfill resource_sharing entries for existing plannings
  try {
    const { ensureOwnership } = await import('../shared/resourceSharing.js');
    const plannings = await db.getAllPlannings();
    for (const p of plannings) {
      await ensureOwnership('roadmap', p.id, 1, 'public'); // Existing plannings default to public
    }
  } catch { /* sharing table may not exist yet */ }
}

export function createRoadmapRoutes(): Router {
  const router = Router();

  // ==================== PUBLIC EMBED ROUTES ====================

  router.get('/embed/:id', asyncHandler(async (req, res) => {
    const planning = await db.getPlanningById(req.params.id);
    if (!planning) { res.status(404).json({ error: 'Planning non trouve' }); return; }
    res.json(planning);
  }));

  router.get('/embed/:id/tasks', asyncHandler(async (req, res) => {
    const tasks = await db.getTasksByPlanning(req.params.id);
    res.json(tasks);
  }));

  router.get('/embed/:id/dependencies', asyncHandler(async (req, res) => {
    const deps = await db.getDependenciesByPlanning(req.params.id);
    res.json(deps);
  }));

  router.get('/embed/:id/markers', asyncHandler(async (req, res) => {
    const markers = await db.getMarkersByPlanning(req.params.id);
    res.json(markers);
  }));

  // ==================== PROTECTED ROUTES ====================

  router.use(authMiddleware);

  // --- Plannings ---

  router.get('/plannings', asyncHandler(async (req, res) => {
    const plannings = await db.getAllPlannings(req.user!.id, req.user!.isAdmin);
    res.json(plannings);
  }));

  router.post('/plannings', asyncHandler(async (req, res) => {
    const { name, description, startDate, endDate, visibility } = req.body;
    if (!name || !startDate || !endDate) {
      res.status(400).json({ error: 'name, startDate et endDate sont requis' });
      return;
    }
    const vis = visibility === 'public' ? 'public' : 'private';
    const planning = await db.createPlanning(name, startDate, endDate, description);
    // Create sharing entry (owned by current user)
    try {
      const { ensureOwnership } = await import('../shared/resourceSharing.js');
      await ensureOwnership('roadmap', planning.id, req.user!.id, vis);
    } catch { /* ignore if sharing table not ready */ }
    res.status(201).json(planning);
  }));

  router.get('/plannings/:id', asyncHandler(async (req, res) => {
    const planning = await db.getPlanningById(req.params.id);
    if (!planning) { res.status(404).json({ error: 'Planning non trouve' }); return; }
    res.json(planning);
  }));

  router.put('/plannings/:id', asyncHandler(async (req, res) => {
    const { name, description, startDate, endDate } = req.body;
    const planning = await db.updatePlanning(req.params.id, { name, description, startDate, endDate });
    if (!planning) { res.status(404).json({ error: 'Planning non trouve' }); return; }
    res.json(planning);
  }));

  router.delete('/plannings/:id', asyncHandler(async (req, res) => {
    const success = await db.deletePlanning(req.params.id);
    if (!success) { res.status(404).json({ error: 'Planning non trouve' }); return; }
    res.json({ success: true });
  }));

  // --- Planning sub-resources ---

  router.get('/plannings/:id/tasks', asyncHandler(async (req, res) => {
    const tasks = await db.getTasksByPlanning(req.params.id);
    res.json(tasks);
  }));

  router.get('/plannings/:id/dependencies', asyncHandler(async (req, res) => {
    const deps = await db.getDependenciesByPlanning(req.params.id);
    res.json(deps);
  }));

  router.get('/plannings/:id/markers', asyncHandler(async (req, res) => {
    const markers = await db.getMarkersByPlanning(req.params.id);
    res.json(markers);
  }));

  // --- Tasks ---

  router.get('/tasks/:id', asyncHandler(async (req, res) => {
    const task = await db.getTaskById(req.params.id);
    if (!task) { res.status(404).json({ error: 'Tache non trouvee' }); return; }
    res.json(task);
  }));

  router.post('/tasks', asyncHandler(async (req, res) => {
    const { planningId, name, startDate, endDate, parentId, description, color, progress, sortOrder } = req.body;
    if (!planningId || !name || !startDate || !endDate) {
      res.status(400).json({ error: 'planningId, name, startDate et endDate sont requis' });
      return;
    }
    const task = await db.createTask(planningId, name, startDate, endDate, { parentId, description, color, progress, sortOrder });
    res.status(201).json(task);
  }));

  router.put('/tasks/:id', asyncHandler(async (req, res) => {
    const { name, description, startDate, endDate, color, progress, sortOrder, parentId } = req.body;
    const task = await db.updateTask(req.params.id, { name, description, startDate, endDate, color, progress, sortOrder, parentId });
    if (!task) { res.status(404).json({ error: 'Tache non trouvee' }); return; }
    res.json(task);
  }));

  router.delete('/tasks/:id', asyncHandler(async (req, res) => {
    const success = await db.deleteTask(req.params.id);
    if (!success) { res.status(404).json({ error: 'Tache non trouvee' }); return; }
    res.json({ success: true });
  }));

  // --- Task-Subject links (Roadmap ↔ SuiviTess integration) ---

  router.get('/tasks/:taskId/subjects', asyncHandler(async (req, res) => {
    const subjects = await db.getLinkedSubjects(req.params.taskId);
    res.json(subjects);
  }));

  router.post('/tasks/:taskId/subjects', asyncHandler(async (req, res) => {
    const { subjectId } = req.body;
    if (!subjectId) {
      res.status(400).json({ error: 'subjectId is required' });
      return;
    }
    await db.linkSubject(req.params.taskId, subjectId);
    res.status(201).json({ ok: true });
  }));

  router.delete('/tasks/:taskId/subjects/:subjectId', asyncHandler(async (req, res) => {
    await db.unlinkSubject(req.params.taskId, req.params.subjectId);
    res.json({ ok: true });
  }));

  // --- AI Subject Suggestions ---

  router.post('/tasks/:taskId/suggest-subjects', asyncHandler(async (req, res) => {
    const taskId = req.params.taskId;
    const task = await db.getTaskById(taskId);
    if (!task) { res.status(404).json({ error: 'Tache non trouvee' }); return; }

    // Get parent task name for context
    let parentName = '';
    if (task.parentId) {
      const parent = await db.getTaskById(task.parentId);
      if (parent) parentName = parent.name;
    }

    // Get all subjects and already linked ones
    const allSubjects = await searchSuivitessSubjects('');
    const linked = await db.getLinkedSubjects(taskId);
    const linkedIds = new Set(linked.map(s => s.id));
    const available = allSubjects.filter(s => !linkedIds.has(s.id));

    if (available.length === 0) {
      res.json([]);
      return;
    }

    const { client, model } = await getAnthropicClient(req.user!.id);
    const subjectList = available.map(s => `[${s.id}] ${s.title} (${s.document_title} › ${s.section_name})`).join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Tu es un assistant qui aide à lier des sujets de suivi à des tâches de roadmap.

Tâche roadmap : "${task.name}"
${parentName ? `Projet parent : "${parentName}"` : ''}

Sujets suivitess disponibles :
${subjectList}

Retourne les IDs des 5 sujets les plus pertinents pour cette tâche, classés par pertinence.
Base-toi sur le nom de la tâche et son parent pour deviner le contexte.
Retourne UNIQUEMENT un tableau JSON d'IDs : ["id1", "id2", ...]
Si aucun sujet n'est pertinent, retourne [].`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) { res.json([]); return; }

    try {
      const ids: string[] = JSON.parse(jsonMatch[0]);
      const subjectMap = new Map(available.map(s => [s.id, s]));
      const suggestions = ids.filter(id => subjectMap.has(id)).map(id => subjectMap.get(id)!);
      res.json(suggestions);
    } catch {
      res.json([]);
    }
  }));

  // --- Dependencies ---

  router.post('/dependencies', asyncHandler(async (req, res) => {
    const { fromTaskId, toTaskId, type } = req.body;
    if (!fromTaskId || !toTaskId) {
      res.status(400).json({ error: 'fromTaskId et toTaskId sont requis' });
      return;
    }
    const dep = await db.createDependency(fromTaskId, toTaskId, type);
    res.status(201).json(dep);
  }));

  router.delete('/dependencies/:id', asyncHandler(async (req, res) => {
    const success = await db.deleteDependency(req.params.id);
    if (!success) { res.status(404).json({ error: 'Dependance non trouvee' }); return; }
    res.json({ success: true });
  }));

  // --- Markers ---

  router.post('/markers', asyncHandler(async (req, res) => {
    const { planningId, name, markerDate, color, type } = req.body;
    if (!planningId || !name || !markerDate) {
      res.status(400).json({ error: 'planningId, name et markerDate sont requis' });
      return;
    }
    const marker = await db.createMarker(planningId, name, markerDate, color, type);
    res.status(201).json(marker);
  }));

  router.put('/markers/:id', asyncHandler(async (req, res) => {
    const { name, markerDate, color, type, taskId } = req.body;
    // Defensive: a marker's task_id column is a UUID FK on roadmap_tasks.
    // Synthetic ids used by virtual overlays (delivery, ...) are NOT valid
    // UUIDs and must never be persisted here. Treat them as "no snap".
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeTaskId =
      taskId === null || taskId === undefined
        ? taskId
        : typeof taskId === 'string' && UUID_RE.test(taskId)
          ? taskId
          : null;
    const marker = await db.updateMarker(req.params.id, { name, markerDate, color, type, taskId: safeTaskId });
    if (!marker) { res.status(404).json({ error: 'Marqueur non trouve' }); return; }
    res.json(marker);
  }));

  router.delete('/markers/:id', asyncHandler(async (req, res) => {
    const success = await db.deleteMarker(req.params.id);
    if (!success) { res.status(404).json({ error: 'Marqueur non trouve' }); return; }
    res.json({ success: true });
  }));

  // ==================== DELIVERY BOARD LINKS ====================

  // List all delivery boards (used to populate the planning form selector)
  router.get('/delivery-boards', asyncHandler(async (_req, res) => {
    const boards = await db.getAllDeliveryBoards();
    res.json(boards);
  }));

  // List boards linked to a planning
  router.get('/plannings/:id/delivery-boards', asyncHandler(async (req, res) => {
    const boards = await db.getLinkedBoards(req.params.id);
    res.json(boards);
  }));

  // Link a board to a planning
  router.post('/plannings/:id/delivery-boards', asyncHandler(async (req, res) => {
    const { boardId } = req.body;
    if (!boardId) {
      res.status(400).json({ error: 'boardId est requis' });
      return;
    }
    await db.linkBoard(req.params.id, boardId);
    res.json({ success: true });
  }));

  // Unlink a board from a planning
  router.delete('/plannings/:id/delivery-boards/:boardId', asyncHandler(async (req, res) => {
    await db.unlinkBoard(req.params.id, req.params.boardId);
    res.json({ success: true });
  }));

  /**
   * Build the delivery overlay for a planning.
   * For each linked board: fetch raw tasks (+ positions) and derive dates
   * via the pure `deriveOverlayTasks` function (deterministic calendar —
   * no planning range needed, no Jira call). Returns a flat array of
   * overlay tasks the frontend can render as a virtual "Delivery" row.
   */
  router.get('/plannings/:id/delivery-overlay', asyncHandler(async (req, res) => {
    const planning = await db.getPlanningById(req.params.id);
    if (!planning) {
      res.status(404).json({ error: 'Planning non trouve' });
      return;
    }

    const linkedBoards = await db.getLinkedBoards(req.params.id);
    if (linkedBoards.length === 0) {
      res.json([]);
      return;
    }

    const overlay: Array<DerivedDeliveryTask & { boardId: string; boardName: string }> = [];

    for (const board of linkedBoards) {
      const { boardName, boardConfig, tasks } = await db.getRawDeliveryTasksForBoard(board.id);
      if (tasks.length === 0 || !boardConfig) continue;

      const derived = deriveOverlayTasks({ rawTasks: tasks, boardConfig });

      for (const task of derived) {
        overlay.push({ ...task, boardId: board.id, boardName });
      }
    }

    res.json(overlay);
  }));

  return router;
}
