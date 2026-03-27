import { Router } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';
import { getJiraContext } from '../jiraAuth.js';

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

  // ============ Jira Proxy ============

  // Check if Jira is connected for current user (OAuth or Basic)
  router.get('/jira/check', asyncHandler(async (req, res) => {
    const ctx = await getJiraContext(req.user!.id);
    res.json({ connected: ctx !== null });
  }));

  // List Jira projects
  router.get('/jira/projects', asyncHandler(async (req, res) => {
    const ctx = await getJiraContext(req.user!.id);
    if (!ctx) {
      res.status(401).json({ error: 'No Jira auth available' });
      return;
    }

    const url = `${ctx.baseUrl}/rest/api/3/project/search?maxResults=50&orderBy=name`;
    const response = await fetch(url, { headers: ctx.headers });
    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: `Jira API error: ${text}` });
      return;
    }

    const data = await response.json() as { values: Array<{ id: string; key: string; name: string; avatarUrls?: Record<string, string> }> };
    const projects = (data.values || []).map(p => ({
      id: p.id,
      key: p.key,
      name: p.name,
      avatarUrl: p.avatarUrls?.['24x24'],
    }));
    res.json(projects);
  }));

  // List sprints for a project (via JQL — no Agile API scope needed)
  router.get('/jira/sprints', asyncHandler(async (req, res) => {
    const { projectKey } = req.query as { projectKey?: string };
    if (!projectKey) {
      res.status(400).json({ error: 'projectKey is required' });
      return;
    }

    const ctx = await getJiraContext(req.user!.id);
    if (!ctx) {
      res.status(401).json({ error: 'No Jira auth available' });
      return;
    }

    // Extract sprints from issues via JQL — works with read:jira-work scope
    const jql = `project = "${projectKey}" AND sprint is not EMPTY ORDER BY updated DESC`;
    const params = new URLSearchParams({
      jql,
      maxResults: '100',
      fields: 'customfield_10020',
    });
    const searchUrl = `${ctx.baseUrl}/rest/api/3/search/jql?${params}`;
    const searchResp = await fetch(searchUrl, { headers: ctx.headers });

    if (!searchResp.ok) {
      const text = await searchResp.text();
      res.status(searchResp.status).json({ error: `Jira API error: ${text}` });
      return;
    }

    type SprintField = { id: number; name: string; state: string; startDate?: string; endDate?: string };
    const searchData = await searchResp.json() as {
      issues: Array<{ fields: { customfield_10020?: SprintField[] } }>;
    };

    // Deduplicate sprints across all issues
    const sprintMap = new Map<number, SprintField>();
    for (const issue of (searchData.issues || [])) {
      for (const sprint of (issue.fields.customfield_10020 || [])) {
        if (!sprintMap.has(sprint.id)) {
          sprintMap.set(sprint.id, sprint);
        }
      }
    }

    const sprints = Array.from(sprintMap.values()).map(s => ({
      id: s.id,
      name: s.name,
      state: s.state as 'active' | 'closed' | 'future',
      startDate: s.startDate,
      endDate: s.endDate,
    }));

    // Active sprints first, then by id descending (most recent)
    sprints.sort((a, b) => {
      if (a.state === 'active' && b.state !== 'active') return -1;
      if (b.state === 'active' && a.state !== 'active') return 1;
      return b.id - a.id;
    });

    res.json(sprints);
  }));

  // List issues for selected sprints
  router.get('/jira/issues', asyncHandler(async (req, res) => {
    const { sprintIds } = req.query as { sprintIds?: string };
    if (!sprintIds) {
      res.status(400).json({ error: 'sprintIds is required' });
      return;
    }

    const ctx = await getJiraContext(req.user!.id);
    if (!ctx) {
      res.status(401).json({ error: 'No Jira auth available' });
      return;
    }

    const ids = sprintIds.split(',').map(id => id.trim()).join(', ');
    const jql = `sprint in (${ids}) ORDER BY created DESC`;
    const params = new URLSearchParams({
      jql,
      maxResults: '100',
      fields: 'summary,status,assignee,customfield_10016,issuetype,customfield_10020',
    });
    const searchUrl = `${ctx.baseUrl}/rest/api/3/search/jql?${params}`;
    const searchResp = await fetch(searchUrl, { headers: ctx.headers });

    if (!searchResp.ok) {
      const text = await searchResp.text();
      res.status(searchResp.status).json({ error: `Jira API error: ${text}` });
      return;
    }

    const searchData = await searchResp.json() as {
      issues: Array<{
        id: string;
        key: string;
        fields: {
          summary: string;
          status: { name: string };
          assignee?: { displayName: string };
          customfield_10016?: number;
          issuetype: { name: string };
          customfield_10020?: Array<{ id: number; name: string; state: string }>;
        };
      }>;
    };

    const issues = (searchData.issues || []).map(issue => {
      const sprint = issue.fields.customfield_10020?.find(s => s.state === 'active') || issue.fields.customfield_10020?.[0];
      return {
        id: issue.id,
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name || 'Unknown',
        assignee: issue.fields.assignee?.displayName,
        storyPoints: issue.fields.customfield_10016 ?? undefined,
        issueType: issue.fields.issuetype?.name || 'Task',
        sprintName: sprint?.name,
      };
    });
    res.json(issues);
  }));

  return router;
}
