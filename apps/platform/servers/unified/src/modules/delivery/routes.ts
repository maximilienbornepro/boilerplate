import { Router, type Request, type Response, type NextFunction } from 'express';
import { authMiddleware } from '../../middleware/index.js';
import { asyncHandler } from '@boilerplate/shared/server';
import * as db from './dbService.js';
import { getJiraContext, getUserJiraToken } from '../jiraAuth.js';
import {
  generateTaskSvg, generateMepMarkerSvg, normalizeStatus,
  COLUMN_WIDTH, COLUMN_GAP, type TaskForFigma,
} from './figmaExport.js';

export function createDeliveryRoutes(): Router {
  const router = Router();

  // ============ Figma Plugin Export (PUBLIC — no auth) ============
  // These routes are consumed by the Figma plugin which runs in an iframe
  // sandbox (origin: null) and cannot carry session cookies. CORS headers
  // are set explicitly to allow any origin.

  const figmaCors = (_req: Request, res: Response, next: NextFunction) => {
    // Override the global cors middleware which sets credentials: true +
    // reflects origin. The Figma plugin runs in origin: null (iframe sandbox)
    // and browsers reject "null" origin with credentials. We use wildcard
    // origin + no credentials for these public routes.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('Access-Control-Allow-Credentials');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    next();
  };

  router.get('/figma/boards', figmaCors, asyncHandler(async (_req, res) => {
    // List ALL boards (no user filter — plugin doesn't authenticate)
    const result = await db.getAllBoardsPublic();
    res.json(result);
  }));

  router.get('/figma/boards/:boardId/export', figmaCors, asyncHandler(async (req, res) => {
    const boardId = req.params.boardId as string;
    const board = await db.getBoardById(boardId);
    if (!board) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    const totalCols = board.boardType === 'calendaire' ? 4 : (board.durationWeeks ?? 6);

    const tasks = await db.getAllTasksForBoard(boardId);
    const positions = await db.getPositionsForBoard(boardId);
    const posMap = new Map(positions.map(p => [p.taskId, p]));

    let hiddenIds = new Set<string>();
    try {
      const state = await db.getIncrementState(boardId);
      hiddenIds = new Set(state.hiddenTaskIds || []);
    } catch { /* no state */ }

    const visibleTasks = tasks.filter(t => !hiddenIds.has(t.id));

    const exportTasks = visibleTasks
      .filter(t => !t.parentTaskId)
      .map(task => {
        const pos = posMap.get(task.id);
        const startCol = pos?.startCol ?? 0;
        const endCol = pos?.endCol ?? (startCol + 1);
        const colSpan = endCol - startCol;

        const keyMatch = task.title.match(/^\[([A-Z][A-Z0-9_]+-\d+)\]/);
        const jiraKey = keyMatch ? keyMatch[1] : task.title.slice(0, 20);
        const titleClean = task.title.replace(/^\[[A-Z][A-Z0-9_]+-\d+\]\s*/, '').trim() || task.title;

        const taskData: TaskForFigma = {
          jiraKey,
          title: titleClean,
          status: normalizeStatus(task.status),
          version: null,
          estimatedDays: task.estimatedDays,
          colSpan,
        };

        const children = visibleTasks
          .filter(c => c.parentTaskId === task.id)
          .map(c => {
            const cKey = c.title.match(/^\[([A-Z][A-Z0-9_]+-\d+)\]/);
            return {
              jiraKey: cKey ? cKey[1] : '',
              title: c.title.replace(/^\[[A-Z][A-Z0-9_]+-\d+\]\s*/, '').trim(),
              status: normalizeStatus(c.status),
            };
          });

        return {
          id: task.id, jiraKey, title: titleClean, status: taskData.status,
          colSpan, children,
          position: { startCol, endCol, row: pos?.row ?? 0 },
          svg: generateTaskSvg(taskData),
        };
      });

    res.json({
      boardId: board.id, boardName: board.name, boardType: board.boardType,
      totalCols, startDate: board.startDate, endDate: board.endDate,
      durationWeeks: board.durationWeeks, tasks: exportTasks, count: exportTasks.length,
    });
  }));

  // OPTIONS preflight for Figma CORS
  router.options('/figma/boards', figmaCors, (_req, res) => res.sendStatus(204));
  router.options('/figma/boards/:boardId/export', figmaCors, (_req, res) => res.sendStatus(204));

  // ============ Authenticated routes below ============
  router.use(authMiddleware);

  // ============ Boards CRUD ============

  router.get('/boards', asyncHandler(async (req, res) => {
    const boards = await db.getAllBoards(req.user!.id);
    res.json(boards);
  }));

  router.get('/boards/:id', asyncHandler(async (req, res) => {
    const board = await db.getBoardById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Board non trouvé' });
    res.json(board);
  }));

  router.post('/boards', asyncHandler(async (req, res) => {
    const { name, description, boardType, startDate, endDate, durationWeeks } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Le nom est obligatoire' });

    const type = (boardType === 'calendaire' ? 'calendaire' : 'agile') as db.BoardType;

    // Validation per type
    if (type === 'agile') {
      const weeks = Number(durationWeeks);
      if (![2, 4, 6, 8].includes(weeks)) {
        return res.status(400).json({ error: 'durationWeeks doit etre 2, 4, 6 ou 8 pour un board agile' });
      }
      if (!startDate) {
        return res.status(400).json({ error: 'startDate est obligatoire' });
      }
      // Compute end date from start + duration. Use Date.UTC to avoid
      // local-timezone shift (France UTC+2 would push the date back 1 day).
      const [sy, sm, sd] = startDate.split('-').map(Number);
      const startUtc = new Date(Date.UTC(sy, sm - 1, sd));
      const endUtc = new Date(startUtc.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
      const computedEnd = `${endUtc.getUTCFullYear()}-${String(endUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(endUtc.getUTCDate()).padStart(2, '0')}`;
      const board = await db.createBoard(
        req.user!.id, name.trim(), description?.trim() || null,
        type, startDate, computedEnd, weeks
      );
      res.status(201).json(board);
    } else {
      // Calendaire: startDate = first of month, endDate = last of month.
      // Parse as pure ISO date strings to avoid local-timezone shift
      // (e.g. France UTC+2 makes "2026-04-01" become "2026-03-31" in UTC).
      if (!startDate) {
        return res.status(400).json({ error: 'startDate est obligatoire' });
      }
      const [y, m] = startDate.split('-').map(Number);
      const firstOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-indexed here, Date.UTC(y, m, 0) = last day of month m
      const lastOfMonth = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const board = await db.createBoard(
        req.user!.id, name.trim(), description?.trim() || null,
        type,
        firstOfMonth,
        lastOfMonth,
        4 // 4 weeks
      );
      res.status(201).json(board);
    }
  }));

  router.put('/boards/:id', asyncHandler(async (req, res) => {
    const board = await db.updateBoard(req.params.id, req.body);
    res.json(board);
  }));

  router.delete('/boards/:id', asyncHandler(async (req, res) => {
    await db.deleteBoard(req.params.id);
    res.json({ ok: true });
  }));

  // ============ Tasks CRUD ============

  // Get ALL tasks for a board (across all sprints) — used by the new
  // board-level view where all sprints are visible simultaneously.
  router.get('/tasks/board/:boardId', asyncHandler(async (req, res) => {
    const tasks = await db.getAllTasksForBoard(req.params.boardId);
    res.json(tasks);
  }));

  // Get all positions for a board (across all sprints)
  router.get('/positions/board/:boardId', asyncHandler(async (req, res) => {
    const positions = await db.getPositionsForBoard(req.params.boardId);
    res.json(positions);
  }));

  // Get all tasks for a single increment/sprint (legacy + Jira status sync)
  router.get('/tasks/:incrementId', asyncHandler(async (req, res) => {
    const tasks = await db.getAllTasks(req.params.incrementId);

    // Sync Jira statuses for jira-sourced tasks
    const jiraTasks = tasks.filter(t => t.source === 'jira');
    if (jiraTasks.length > 0) {
      const ctx = await getJiraContext(req.user!.id);
      if (ctx) {
        const keyMap = new Map<string, db.TaskRow>();
        for (const t of jiraTasks) {
          const match = t.title.match(/^\[([A-Z][A-Z0-9_]+-\d+)\]/);
          if (match) keyMap.set(match[1], t);
        }
        if (keyMap.size > 0) {
          try {
            const keys = Array.from(keyMap.keys());
            const jql = `key in (${keys.join(',')})`;
            const params = new URLSearchParams({ jql, maxResults: String(keys.length), fields: 'status,customfield_10016,assignee' });
            const searchUrl = `${ctx.baseUrl}/rest/api/3/search/jql?${params}`;
            const searchResp = await fetch(searchUrl, { headers: ctx.headers });
            if (searchResp.ok) {
              const data = await searchResp.json() as { issues: Array<{ key: string; fields: { status: { name: string }; customfield_10016?: number; assignee?: { displayName: string } } }> };
              for (const issue of data.issues || []) {
                const task = keyMap.get(issue.key);
                if (!task) continue;
                const newStatus = issue.fields.status?.name;
                const newPoints = issue.fields.customfield_10016 ?? null;
                const newAssignee = issue.fields.assignee?.displayName ?? null;
                if (newStatus && newStatus !== task.status) task.status = newStatus;
                if (newPoints !== null && newPoints !== task.storyPoints) task.storyPoints = newPoints;
                if (newAssignee !== task.assignee) task.assignee = newAssignee;
                db.updateTask(task.id, { status: newStatus || task.status, storyPoints: newPoints ?? undefined, assignee: newAssignee ?? undefined }).catch(() => {});
              }
            }
          } catch (err) {
            console.warn('[Delivery] Jira status sync failed:', (err as Error).message);
          }
        }
      }
    }

    res.json(tasks);
  }));

  // Create a new task
  router.post('/tasks', asyncHandler(async (req, res) => {
    const { title, type, status, storyPoints, estimatedDays, assignee, priority, incrementId, sprintName, source, description } = req.body;

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
      source: source || 'manual',
      description: description || null,
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

  // Nest a task inside a container (manual task)
  router.post('/tasks/:id/nest', asyncHandler(async (req, res) => {
    const { parentId } = req.body;
    if (!parentId) {
      res.status(400).json({ error: 'parentId is required' });
      return;
    }
    const task = await db.nestTask(req.params.id, parentId);
    if (!task) {
      res.status(400).json({ error: 'Cannot nest: parent must be manual, child must not have children' });
      return;
    }
    res.json(task);
  }));

  // Unnest a task from its container
  router.post('/tasks/:id/unnest', asyncHandler(async (req, res) => {
    const task = await db.unnestTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  }));

  // Get children of a container task
  router.get('/tasks/:id/children', asyncHandler(async (req, res) => {
    const children = await db.getChildTasks(req.params.id);
    res.json(children);
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

  // Check if Jira is connected + return siteUrl for browse links
  router.get('/jira/check', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ctx = await getJiraContext(userId);
    if (!ctx) { res.json({ connected: false, siteUrl: null }); return; }
    let siteUrl: string | null = null;
    if (ctx.isOAuth) {
      const token = await getUserJiraToken(userId);
      siteUrl = token?.site_url ?? null;
    } else {
      siteUrl = ctx.baseUrl;
    }
    res.json({ connected: true, siteUrl });
  }));

  // List Jira projects (paginated — fetches all pages)
  router.get('/jira/projects', asyncHandler(async (req, res) => {
    const ctx = await getJiraContext(req.user!.id);
    if (!ctx) {
      res.status(401).json({ error: 'No Jira auth available' });
      return;
    }

    const allProjects: Array<{ id: string; key: string; name: string; avatarUrl?: string }> = [];
    let startAt = 0;
    const maxResults = 50;

    while (true) {
      const url = `${ctx.baseUrl}/rest/api/3/project/search?maxResults=${maxResults}&startAt=${startAt}&orderBy=name`;
      const response = await fetch(url, { headers: ctx.headers });
      if (!response.ok) {
        const text = await response.text();
        res.status(response.status).json({ error: `Jira API error: ${text}` });
        return;
      }

      const data = await response.json() as { values: Array<{ id: string; key: string; name: string; avatarUrls?: Record<string, string> }>; total: number; isLast?: boolean };
      for (const p of data.values || []) {
        allProjects.push({ id: p.id, key: p.key, name: p.name, avatarUrl: p.avatarUrls?.['24x24'] });
      }

      if (data.isLast || (data.values || []).length < maxResults) break;
      startAt += maxResults;
    }

    res.json(allProjects);
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
