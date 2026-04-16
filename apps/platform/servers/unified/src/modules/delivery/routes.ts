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

        const keyMatch = task.title.match(/^\[?([A-Z][A-Z0-9_]+-\d+)\]?/);
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
            const cKey = c.title.match(/^\[?([A-Z][A-Z0-9_]+-\d+)\]?/);
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
    const boards = await db.getAllBoards(req.user!.id, req.user!.isAdmin);
    res.json(boards);
  }));

  router.get('/boards/:id', asyncHandler(async (req, res) => {
    const board = await db.getBoardById(req.params.id);
    if (!board) return res.status(404).json({ error: 'Board non trouvé' });
    res.json(board);
  }));

  router.post('/boards', asyncHandler(async (req, res) => {
    const { name, description, boardType, startDate, endDate, durationWeeks, visibility } = req.body;
    const vis = visibility === 'public' ? 'public' : 'private';
    if (!name?.trim()) return res.status(400).json({ error: 'Le nom est obligatoire' });

    // Credit check
    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try { await deductCredits(req.user!.id, req.user!.isAdmin, 'delivery', 'create_board'); }
    catch (e) { if (e instanceof InsufficientCreditsError) { res.status(402).json({ error: 'INSUFFICIENT_CREDITS', message: 'Crédits insuffisants', required: e.required, available: e.available }); return; } throw e; }

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
      try {
        const { ensureOwnership } = await import('../shared/resourceSharing.js');
        await ensureOwnership('delivery', String(board.id), req.user!.id, vis);
      } catch { /* ignore */ }
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
      try {
        const { ensureOwnership } = await import('../shared/resourceSharing.js');
        await ensureOwnership('delivery', String(board.id), req.user!.id, vis);
      } catch { /* ignore */ }
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

  // Get ALL tasks for a board (across all sprints) + sync Jira metadata.
  router.get('/tasks/board/:boardId', asyncHandler(async (req, res) => {
    const tasks = await db.getAllTasksForBoard(req.params.boardId);

    // Sync Jira statuses, estimates, versions for jira-sourced tasks
    const jiraTasks = tasks.filter(t => t.source === 'jira');
    if (jiraTasks.length > 0) {
      const ctx = await getJiraContext(req.user!.id);
      if (ctx) {
        const keyMap = new Map<string, db.TaskRow>();
        for (const t of jiraTasks) {
          const match = t.title.match(/^\[?([A-Z][A-Z0-9_]+-\d+)\]?/);
          if (match) keyMap.set(match[1], t);
        }
        if (keyMap.size > 0) {
          try {
            const keys = Array.from(keyMap.keys());
            // Batch in chunks of 50 (JQL length limit)
            for (let i = 0; i < keys.length; i += 50) {
              const batch = keys.slice(i, i + 50);
              const jql = `key in (${batch.join(',')})`;
              const params = new URLSearchParams({ jql, maxResults: '50', fields: 'status,customfield_10016,assignee,timetracking,fixVersions,summary' });
              const searchUrl = `${ctx.baseUrl}/rest/api/3/search/jql?${params}`;
              const searchResp = await fetch(searchUrl, { headers: ctx.headers });
              if (searchResp.ok) {
                const data = await searchResp.json() as { issues: Array<{ key: string; fields: {
                  status: { name: string };
                  summary?: string;
                  customfield_10016?: number;
                  assignee?: { displayName: string };
                  timetracking?: { originalEstimateSeconds?: number };
                  fixVersions?: Array<{ name: string }>;
                } }> };
                for (const issue of data.issues || []) {
                  const task = keyMap.get(issue.key);
                  if (!task) continue;
                  const f = issue.fields;
                  if (f.status?.name) task.status = f.status.name;
                  if (f.customfield_10016 !== undefined) task.storyPoints = f.customfield_10016;
                  if (f.assignee?.displayName) task.assignee = f.assignee.displayName;
                  if (f.timetracking?.originalEstimateSeconds) {
                    task.estimatedDays = Math.round((f.timetracking.originalEstimateSeconds / (8 * 60 * 60)) * 10) / 10;
                  }
                  if (f.fixVersions?.[0]?.name) task.description = f.fixVersions[0].name;
                  // Update title with real summary if still "(imported)"
                  if (f.summary && task.title.includes('(imported)')) {
                    task.title = `[${issue.key}] ${f.summary}`;
                  }
                  db.updateTask(task.id, {
                    status: task.status, storyPoints: task.storyPoints ?? undefined,
                    assignee: task.assignee ?? undefined, estimatedDays: task.estimatedDays ?? undefined,
                    description: task.description ?? undefined, title: task.title,
                  }).catch(() => {});
                }
              }
            }
          } catch (err) {
            console.warn('[Delivery] Jira board sync failed:', (err as Error).message);
          }
        }
      }
    }

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
          const match = t.title.match(/^\[?([A-Z][A-Z0-9_]+-\d+)\]?/);
          if (match) keyMap.set(match[1], t);
        }
        if (keyMap.size > 0) {
          try {
            const keys = Array.from(keyMap.keys());
            const jql = `key in (${keys.join(',')})`;
            const params = new URLSearchParams({ jql, maxResults: String(keys.length), fields: 'status,customfield_10016,assignee,timetracking,fixVersions' });
            const searchUrl = `${ctx.baseUrl}/rest/api/3/search/jql?${params}`;
            const searchResp = await fetch(searchUrl, { headers: ctx.headers });
            if (searchResp.ok) {
              const data = await searchResp.json() as { issues: Array<{ key: string; fields: {
                status: { name: string };
                customfield_10016?: number;
                assignee?: { displayName: string };
                timetracking?: { originalEstimateSeconds?: number };
                fixVersions?: Array<{ name: string }>;
              } }> };
              for (const issue of data.issues || []) {
                const task = keyMap.get(issue.key);
                if (!task) continue;
                const newStatus = issue.fields.status?.name;
                const newPoints = issue.fields.customfield_10016 ?? null;
                const newAssignee = issue.fields.assignee?.displayName ?? null;
                // Estimated days from timetracking (8h workday)
                const estimateSeconds = issue.fields.timetracking?.originalEstimateSeconds;
                const newEstimatedDays = estimateSeconds ? Math.round((estimateSeconds / (8 * 60 * 60)) * 10) / 10 : null;
                // Fix version
                const newDescription = issue.fields.fixVersions?.[0]?.name || task.description;
                if (newStatus && newStatus !== task.status) task.status = newStatus;
                if (newPoints !== null && newPoints !== task.storyPoints) task.storyPoints = newPoints;
                if (newAssignee !== task.assignee) task.assignee = newAssignee;
                if (newEstimatedDays !== null) task.estimatedDays = newEstimatedDays;
                if (newDescription) task.description = newDescription;
                db.updateTask(task.id, {
                  status: newStatus || task.status,
                  storyPoints: newPoints ?? undefined,
                  assignee: newAssignee ?? undefined,
                  estimatedDays: newEstimatedDays ?? undefined,
                  description: newDescription ?? undefined,
                }).catch(() => {});
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

  // List fix versions (releases) for one or more projects, filtered by date range
  router.get('/jira/versions', asyncHandler(async (req, res) => {
    const { projectKeys, startDate, endDate } = req.query as {
      projectKeys?: string;   // comma-separated: "TVSMART,TVFIRE"
      startDate?: string;     // ISO YYYY-MM-DD
      endDate?: string;
    };
    if (!projectKeys) {
      res.status(400).json({ error: 'projectKeys is required' });
      return;
    }

    const ctx = await getJiraContext(req.user!.id);
    if (!ctx) {
      res.status(401).json({ error: 'No Jira auth available' });
      return;
    }

    const keys = projectKeys.split(',').map(k => k.trim()).filter(Boolean);
    const releases: Array<{
      id: string;
      version: string;
      date: string;
      projectKey: string;
    }> = [];

    for (const projectKey of keys) {
      try {
        const url = `${ctx.baseUrl}/rest/api/3/project/${projectKey}/versions`;
        const response = await fetch(url, { headers: ctx.headers });
        if (!response.ok) continue;

        const versions = await response.json() as Array<{
          id: string;
          name: string;
          releaseDate?: string;
          released?: boolean;
        }>;

        for (const v of versions) {
          if (!v.releaseDate) continue;
          // Filter by date range if provided
          if (startDate && v.releaseDate < startDate) continue;
          if (endDate && v.releaseDate > endDate) continue;

          releases.push({
            id: v.id,
            version: v.name,
            date: v.releaseDate,
            projectKey,
          });
        }
      } catch {
        // Skip project on error
      }
    }

    // Sort by date
    releases.sort((a, b) => a.date.localeCompare(b.date));

    res.json(releases);
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

  // ============ AI Sanity Check ============
  // Looks at the current board + live Jira state and returns
  // repositioning recommendations (never deletes, only moves).

  router.post('/boards/:boardId/ai-sanity-check', asyncHandler(async (req, res) => {
    const { boardId } = req.params;

    const board = await db.getBoardById(boardId);
    if (!board) { res.status(404).json({ error: 'Board non trouvé' }); return; }

    const tasks = await db.getAllTasksForBoard(boardId);
    // Any non-manual source is treated as an external ticket that the
    // sanity check can analyze (jira, clickup, linear, asana, …).
    const externalTasks = tasks.filter(t => t.source && t.source !== 'manual');

    if (externalTasks.length === 0) {
      res.status(400).json({
        error: 'Aucun ticket externe sur ce board, la vérification IA n\'a rien à analyser.',
      });
      return;
    }

    // Deduct credits BEFORE calling the AI
    const { deductCredits, InsufficientCreditsError } = await import('../connectors/creditService.js');
    try {
      await deductCredits(req.user!.id, req.user!.isAdmin, 'delivery', 'sanity_check');
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        res.status(402).json({
          error: 'INSUFFICIENT_CREDITS',
          message: 'Crédits insuffisants',
          required: e.required,
          available: e.available,
        });
        return;
      }
      throw e;
    }

    const {
      parseExternalKey, computeTodayCol, analyzeSanityCheck, categorizeVersions, categoryOf,
    } = await import('./deliveryAISanityService.js');

    // external key → board task id, only for Jira-sourced tasks (the only
    // provider for which we currently fetch live data). Other sources still
    // go through the analysis using their DB metadata.
    const jiraKeyToTaskId = new Map<string, string>();
    for (const t of externalTasks) {
      if (t.source !== 'jira') continue;
      const key = parseExternalKey(t.title);
      if (key) jiraKeyToTaskId.set(key, t.id);
    }

    // Fetch live Jira state — includes fix versions with release date
    const liveJiraByKey = new Map<string, {
      status?: string;
      storyPoints?: number;
      assignee?: string;
      estimateDays?: number;
      description?: string;
      fixVersion?: string | null;
      fixVersionDate?: string | null;
    }>();
    const rawVersions: Array<{ name: string; releaseDate: string | null }> = [];

    const ctx = await getJiraContext(req.user!.id);
    if (ctx && jiraKeyToTaskId.size > 0) {
      const keys = Array.from(jiraKeyToTaskId.keys());
      for (let i = 0; i < keys.length; i += 50) {
        const batch = keys.slice(i, i + 50);
        const jql = `key in (${batch.join(',')})`;
        const params = new URLSearchParams({
          jql,
          maxResults: '50',
          fields: 'status,customfield_10016,assignee,timetracking,summary,description,fixVersions',
        });
        try {
          const searchResp = await fetch(`${ctx.baseUrl}/rest/api/3/search/jql?${params}`, {
            headers: ctx.headers,
          });
          if (!searchResp.ok) continue;
          const data = await searchResp.json() as { issues?: Array<{
            key: string;
            fields: {
              status?: { name: string };
              customfield_10016?: number;
              assignee?: { displayName: string };
              timetracking?: { originalEstimateSeconds?: number };
              summary?: string;
              description?: unknown;
              fixVersions?: Array<{ name: string; releaseDate?: string }>;
            };
          }> };
          for (const issue of data.issues || []) {
            const f = issue.fields;
            const firstVersion = f.fixVersions?.[0];
            if (firstVersion) {
              rawVersions.push({
                name: firstVersion.name,
                releaseDate: firstVersion.releaseDate ?? null,
              });
            }
            liveJiraByKey.set(issue.key, {
              status: f.status?.name,
              storyPoints: f.customfield_10016,
              assignee: f.assignee?.displayName,
              estimateDays: f.timetracking?.originalEstimateSeconds
                ? Math.round((f.timetracking.originalEstimateSeconds / (8 * 60 * 60)) * 10) / 10
                : undefined,
              description: typeof f.description === 'string' ? f.description : (f.description ? 'yes' : undefined),
              fixVersion: firstVersion?.name ?? null,
              fixVersionDate: firstVersion?.releaseDate ?? null,
            });
          }
        } catch {
          /* ignore — best effort */
        }
      }
    }

    // ---------------- Missing tickets detection ----------------
    // For each unique project key on the board, fetch the ACTIVE sprint issues
    // and compare against the board's Jira keys to identify tickets present
    // in the sprint but absent from the delivery board.
    const boardJiraKeys = new Set(
      Array.from(jiraKeyToTaskId.keys()),
    );
    const uniqueProjectKeys = new Set<string>();
    for (const key of boardJiraKeys) uniqueProjectKeys.add(key.split('-')[0]);

    const missingFromBoard: Array<{
      externalKey: string;
      source: string;
      summary: string;
      status: string;
      storyPoints: number | null;
      estimatedDays: number | null;
      hasEstimation: boolean;
      hasDescription: boolean;
      assignee: string | null;
      releaseTag: string | null;
      iterationName: string | null;
    }> = [];

    if (ctx && uniqueProjectKeys.size > 0) {
      for (const projectKey of uniqueProjectKeys) {
        try {
          // Find the active sprint(s) for this project
          const sprintsJql = `project = "${projectKey}" AND sprint in openSprints()`;
          const sprintsParams = new URLSearchParams({
            jql: sprintsJql,
            maxResults: '100',
            fields: 'summary,status,assignee,customfield_10016,customfield_10020,timetracking,description,fixVersions',
          });
          const resp = await fetch(`${ctx.baseUrl}/rest/api/3/search/jql?${sprintsParams}`, {
            headers: ctx.headers,
          });
          if (!resp.ok) continue;
          const data = await resp.json() as { issues?: Array<{
            key: string;
            fields: {
              summary?: string;
              status?: { name: string };
              assignee?: { displayName: string };
              customfield_10016?: number;
              customfield_10020?: Array<{ name: string; state: string }>;
              timetracking?: { originalEstimateSeconds?: number };
              description?: unknown;
              fixVersions?: Array<{ name: string; releaseDate?: string }>;
            };
          }> };
          for (const issue of data.issues || []) {
            if (boardJiraKeys.has(issue.key)) continue; // already on the board
            const f = issue.fields;
            const activeSprint = f.customfield_10020?.find(s => s.state === 'active');
            const estDays = f.timetracking?.originalEstimateSeconds
              ? Math.round((f.timetracking.originalEstimateSeconds / (8 * 60 * 60)) * 10) / 10
              : null;
            const hasDesc = typeof f.description === 'string'
              ? f.description.trim().length > 0
              : !!f.description;
            const firstVersion = f.fixVersions?.[0];
            if (firstVersion) {
              rawVersions.push({ name: firstVersion.name, releaseDate: firstVersion.releaseDate ?? null });
            }
            missingFromBoard.push({
              externalKey: issue.key,
              source: 'jira',
              summary: f.summary || issue.key,
              status: f.status?.name || 'To Do',
              storyPoints: f.customfield_10016 ?? null,
              estimatedDays: estDays,
              hasEstimation: f.customfield_10016 !== undefined || estDays !== null,
              hasDescription: hasDesc,
              assignee: f.assignee?.displayName || null,
              releaseTag: firstVersion?.name ?? null,
              iterationName: activeSprint?.name ?? null,
            });
          }
        } catch {
          /* best effort */
        }
      }
    }

    // De-duplicate versions by name and classify them (past / next / later / none)
    const uniqueVersions = Array.from(
      new Map(rawVersions.map(v => [v.name, v])).values(),
    );
    const classifiedVersions = categorizeVersions(uniqueVersions);

    // Enrich missing tickets with their version category, now that versions are classified
    const missingEnriched = missingFromBoard.map(m => ({
      ...m,
      versionCategory: categoryOf(m.releaseTag, classifiedVersions),
    }));
    const MAX_MISSING = 30;
    const missingCapped = missingEnriched.slice(0, MAX_MISSING);

    // Build the snapshot
    const positions = await db.getPositionsForBoard(boardId);
    const positionByTaskId = new Map(positions.map(p => [p.taskId, p]));

    const totalCols = board.boardType === 'agile' ? (board.durationWeeks ?? 6) : 4;
    const todayCol = computeTodayCol(board.startDate, board.endDate, totalCols);

    const snapshotTasks = externalTasks.map(t => {
      const externalKey = parseExternalKey(t.title);
      const pos = positionByTaskId.get(t.id);
      // Live data is only fetched for Jira right now. Other sources fall
      // back to the DB metadata — the analysis still works.
      const live = t.source === 'jira' && externalKey ? liveJiraByKey.get(externalKey) : undefined;
      const releaseTag = live?.fixVersion
        || (t.description && /^v?\d/.test(t.description) ? t.description : null);
      return {
        id: t.id,
        title: t.title,
        externalKey,
        source: t.source,
        boardStatus: t.status,
        externalStatus: live?.status ?? null,
        storyPoints: t.storyPoints ?? live?.storyPoints ?? null,
        estimatedDays: t.estimatedDays ?? live?.estimateDays ?? null,
        hasEstimation: !!(t.estimatedDays || t.storyPoints || live?.storyPoints || live?.estimateDays),
        hasDescription: !!(t.description && t.description.trim().length > 0) || !!live?.description,
        hasAssignee: !!(t.assignee || live?.assignee),
        releaseTag,
        versionCategory: categoryOf(releaseTag, classifiedVersions),
        position: pos
          ? { startCol: pos.startCol, endCol: pos.endCol, row: pos.row }
          : { startCol: 0, endCol: 1, row: 0 },
      };
    });

    const MAX_TASKS = 50;
    const capped = snapshotTasks.slice(0, MAX_TASKS);

    const result = await analyzeSanityCheck(req.user!.id, {
      boardId,
      boardName: board.name,
      totalCols,
      todayCol,
      tasks: capped,
      versions: classifiedVersions,
      missingFromBoard: missingCapped,
    });

    res.json(result);
  }));

  // Apply a list of recommended moves + optional additions. Transactional —
  // all or nothing. Moves update existing positions ; additions first create
  // a new Jira-sourced task with the given metadata, then set its position.
  router.post('/boards/:boardId/ai-sanity-check/apply', asyncHandler(async (req, res) => {
    const { boardId } = req.params;
    const { moves, additions } = req.body as {
      moves?: Array<{ taskId: string; startCol: number; endCol: number; row: number }>;
      additions?: Array<{
        /** external ticket reference (Jira key, ClickUp id, …). Accept legacy `jiraKey` too. */
        externalKey?: string;
        jiraKey?: string;
        /** Source tool name. Defaults to 'jira' for backwards compat. */
        source?: string;
        summary: string;
        status?: string;
        storyPoints?: number | null;
        estimatedDays?: number | null;
        assignee?: string | null;
        iterationName?: string | null;
        sprintName?: string | null;
        version?: string | null;
        startCol: number;
        endCol: number;
        row: number;
      }>;
    };
    const safeMoves = Array.isArray(moves) ? moves : [];
    const safeAdditions = Array.isArray(additions) ? additions : [];

    if (safeMoves.length === 0 && safeAdditions.length === 0) {
      res.status(400).json({ error: 'Aucun changement à appliquer' });
      return;
    }

    // Auto-save a snapshot BEFORE applying the AI moves so the user can
    // revert from the "Historique > Snapshots" menu.
    try {
      await db.createSnapshot(boardId, 'Avant rangement IA');
    } catch {
      // Non-blocking — don't fail the whole apply if snapshot creation fails
      console.warn('[Delivery] Failed to create pre-AI snapshot for board', boardId);
    }

    const tasks = await db.getAllTasksForBoard(boardId);
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const positions = await db.getPositionsForBoard(boardId);
    const positionByTaskId = new Map(positions.map(p => [p.taskId, p]));

    // Any move referencing a task not on this board is rejected.
    const invalid = safeMoves.find(m => !taskById.has(m.taskId));
    if (invalid) {
      res.status(400).json({ error: `Tâche ${invalid.taskId} absente du board` });
      return;
    }

    // Map board-level status strings to TaskStatus
    const mapJiraStatus = (jiraStatus?: string): string => {
      const s = (jiraStatus || '').toLowerCase();
      if (s.includes('progress') || s.includes('en cours')) return 'in_progress';
      if (s.includes('block')) return 'blocked';
      if (s.includes('done') || s.includes('termin')) return 'done';
      return 'todo';
    };

    // 1) Create tasks for additions so we have their new ids
    const createdAdditions: Array<{ taskId: string; startCol: number; endCol: number; row: number }> = [];
    for (const add of safeAdditions) {
      const ref = add.externalKey || add.jiraKey;
      if (!ref) continue;
      const source = add.source || 'jira';
      const iterationName = add.iterationName || add.sprintName || undefined;
      // Guard against duplicates: if a task with the same external ref
      // already exists on the board (any source), skip creation and just
      // reposition instead.
      const existing = tasks.find(t => t.source !== 'manual' && t.title.startsWith(`[${ref}]`));
      if (existing) {
        createdAdditions.push({
          taskId: existing.id,
          startCol: Math.max(0, Math.floor(add.startCol)),
          endCol: Math.max(1, Math.floor(add.endCol)),
          row: Math.max(0, Math.floor(add.row)),
        });
        continue;
      }

      const created = await db.createTask({
        title: `[${ref}] ${add.summary || ref}`,
        type: 'feature',
        status: mapJiraStatus(add.status),
        storyPoints: add.storyPoints ?? undefined,
        estimatedDays: add.estimatedDays ?? undefined,
        assignee: add.assignee ?? undefined,
        priority: 'medium',
        incrementId: boardId,
        sprintName: iterationName,
        source,
        description: add.version ?? null,
      });
      createdAdditions.push({
        taskId: created.id,
        startCol: Math.max(0, Math.floor(add.startCol)),
        endCol: Math.max(1, Math.floor(add.endCol)),
        row: Math.max(0, Math.floor(add.row)),
      });
    }

    // 2) Build the position upsert list (moves + created additions)
    const toUpsert: Array<db.TaskPosition> = [];

    for (const m of safeMoves) {
      const existing = positionByTaskId.get(m.taskId);
      const incrementId =
        existing?.incrementId
        || taskById.get(m.taskId)?.incrementId
        || boardId;
      toUpsert.push({
        taskId: m.taskId,
        incrementId,
        startCol: Math.max(0, Math.floor(m.startCol)),
        endCol: Math.max(1, Math.floor(m.endCol)),
        row: Math.max(0, Math.floor(m.row)),
        rowSpan: existing?.rowSpan ?? 1,
      });
    }

    for (const a of createdAdditions) {
      toUpsert.push({
        taskId: a.taskId,
        incrementId: boardId,
        startCol: a.startCol,
        endCol: a.endCol,
        row: a.row,
        rowSpan: 1,
      });
    }

    await db.bulkUpsertPositions(toUpsert);

    res.json({
      applied: toUpsert.length,
      movesApplied: safeMoves.length,
      additionsApplied: createdAdditions.length,
    });
  }));

  return router;
}
