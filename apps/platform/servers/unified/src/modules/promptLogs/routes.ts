// HTTP routes for prompt logs.
//
//   POST   /prompt-logs/api/events            — PUBLIC ingest (no auth).
//                                              The Claude Code hook posts here.
//   GET    /prompt-logs/api/projects           — admin only
//   GET    /prompt-logs/api/projects/:cwd/stats — admin only
//   GET    /prompt-logs/api/sessions?cwd=…     — admin only
//   GET    /prompt-logs/api/sessions/:id       — admin only (full event list)
//
// Why PUBLIC ingest : the Claude Code hook is a local shell command (curl) and
// has no session cookie. We trust localhost + rate-limit implicitly through
// the single-user nature of CC. If this ever needs to accept requests from
// the network, add a shared secret header check here.

import { Router } from 'express';
import { asyncHandler } from '@boilerplate/shared/server';
import { authMiddleware, adminMiddleware } from '../../middleware/index.js';
import {
  insertPromptLog,
  listProjects,
  listSessions,
  listEventsForSession,
  listEventsForProject,
  getProjectStats,
  type InsertPromptLogInput,
  type PromptEventKind,
} from './dbService.js';

function normalizeEvent(body: unknown): InsertPromptLogInput | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  // The Claude Code hook uses snake_case (session_id, cwd, prompt,
  // hook_event_name). We accept both that shape AND a generic shape
  // (session_id, cwd, event_kind, prompt_text, …) so other tools can
  // send events too.
  const session_id = String(raw.session_id ?? raw.sessionId ?? '').trim();
  const cwd = String(raw.cwd ?? raw.project ?? '').trim();
  if (!session_id || !cwd) return null;

  // The CC hook uses hook_event_name ∈ {UserPromptSubmit, Stop, …}. Map to
  // our enum. Everything else is 'manual' (e.g. curl from a script).
  const hookName = String(raw.hook_event_name ?? '').toLowerCase();
  let event_kind: PromptEventKind = 'user_prompt';
  if (hookName === 'userpromptsubmit') event_kind = 'user_prompt';
  else if (hookName === 'stop') event_kind = 'stop';
  else if (raw.event_kind != null) event_kind = String(raw.event_kind) as PromptEventKind;

  return {
    session_id,
    cwd,
    event_kind,
    prompt_text: typeof raw.prompt === 'string' ? raw.prompt
      : typeof raw.prompt_text === 'string' ? raw.prompt_text
      : null,
    response_summary: typeof raw.response_summary === 'string' ? raw.response_summary : null,
    tools_used: raw.tools_used ?? null,
    files_changed: raw.files_changed ?? null,
    tokens: raw.tokens ?? null,
    duration_ms: typeof raw.duration_ms === 'number' ? raw.duration_ms : null,
    git_commit_sha: typeof raw.git_commit_sha === 'string' ? raw.git_commit_sha : null,
    metadata: raw.metadata ?? null,
  };
}

export function createRoutes(): Router {
  const router = Router();

  // ── PUBLIC ingest. Never blocks, never errors client-visibly. ──
  router.post('/events', asyncHandler(async (req, res) => {
    const input = normalizeEvent(req.body);
    if (!input) {
      // Hook sent a shape we can't use — log + acknowledge quietly so curl
      // doesn't retry in a loop.
      console.warn('[PromptLogs] rejected event (missing session_id or cwd):',
        JSON.stringify(req.body).slice(0, 200));
      res.json({ ok: false, reason: 'missing session_id or cwd' });
      return;
    }
    const id = await insertPromptLog(input);
    res.json({ ok: id != null, id });
  }));

  // ── Admin-only reads ──
  const admin = Router();
  admin.use(authMiddleware, adminMiddleware);

  admin.get('/projects', asyncHandler(async (_req, res) => {
    res.json(await listProjects());
  }));

  admin.get('/projects/stats', asyncHandler(async (req, res) => {
    const cwd = String(req.query.cwd ?? '');
    if (!cwd) { res.status(400).json({ error: 'cwd query param required' }); return; }
    res.json(await getProjectStats(cwd));
  }));

  admin.get('/sessions', asyncHandler(async (req, res) => {
    const cwd = String(req.query.cwd ?? '');
    if (!cwd) { res.status(400).json({ error: 'cwd query param required' }); return; }
    const limit = parseInt(String(req.query.limit ?? '50')) || 50;
    res.json(await listSessions(cwd, limit));
  }));

  admin.get('/sessions/:id', asyncHandler(async (req, res) => {
    res.json(await listEventsForSession(String(req.params.id)));
  }));

  admin.get('/events', asyncHandler(async (req, res) => {
    const cwd = String(req.query.cwd ?? '');
    if (!cwd) { res.status(400).json({ error: 'cwd query param required' }); return; }
    const limit = parseInt(String(req.query.limit ?? '200')) || 200;
    const offset = parseInt(String(req.query.offset ?? '0')) || 0;
    res.json(await listEventsForProject(cwd, limit, offset));
  }));

  router.use(admin);
  return router;
}
