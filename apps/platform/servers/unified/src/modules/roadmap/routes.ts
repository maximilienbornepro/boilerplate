import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';
import { searchSubjects as searchSuivitessSubjects } from '../suivitess/dbService.js';

export async function initDb() {
  await db.initPool();
  await db.ensureTaskSubjectsTable();
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

  router.get('/plannings', asyncHandler(async (_req, res) => {
    const plannings = await db.getAllPlannings();
    res.json(plannings);
  }));

  router.post('/plannings', asyncHandler(async (req, res) => {
    const { name, description, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) {
      res.status(400).json({ error: 'name, startDate et endDate sont requis' });
      return;
    }
    const planning = await db.createPlanning(name, startDate, endDate, description);
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' }); return; }

    const client = new Anthropic({ apiKey });
    const subjectList = available.map(s => `[${s.id}] ${s.title} (${s.document_title} › ${s.section_name})`).join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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
    const marker = await db.updateMarker(req.params.id, { name, markerDate, color, type, taskId });
    if (!marker) { res.status(404).json({ error: 'Marqueur non trouve' }); return; }
    res.json(marker);
  }));

  router.delete('/markers/:id', asyncHandler(async (req, res) => {
    const success = await db.deleteMarker(req.params.id);
    if (!success) { res.status(404).json({ error: 'Marqueur non trouve' }); return; }
    res.json({ success: true });
  }));

  return router;
}
