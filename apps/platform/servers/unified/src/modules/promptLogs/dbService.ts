// Persistence layer for Claude Code prompt logs. Events come in from the
// `UserPromptSubmit` and `Stop` hooks configured in ~/.claude/settings.json.
// We store them flat in one table and aggregate on read.

import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export type PromptEventKind = 'user_prompt' | 'stop' | 'tool_use' | 'manual';

export interface PromptLogRow {
  id: number;
  session_id: string;
  event_kind: PromptEventKind;
  cwd: string;
  prompt_text: string | null;
  response_summary: string | null;
  tools_used: unknown;
  files_changed: unknown;
  tokens: unknown;
  duration_ms: number | null;
  git_commit_sha: string | null;
  metadata: unknown;
  created_at: string;
}

const MAX_TEXT = 100_000;
const MAX_SUMMARY = 10_000;

export async function initPromptLogsPool(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS prompt_logs (
        id               SERIAL PRIMARY KEY,
        session_id       TEXT NOT NULL,
        event_kind       TEXT NOT NULL DEFAULT 'user_prompt',
        cwd              TEXT NOT NULL,
        prompt_text      TEXT,
        response_summary TEXT,
        tools_used       JSONB,
        files_changed    JSONB,
        tokens           JSONB,
        duration_ms      INTEGER,
        git_commit_sha   TEXT,
        metadata         JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_logs_cwd_created
        ON prompt_logs(cwd, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prompt_logs_session_created
        ON prompt_logs(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_prompt_logs_kind_created
        ON prompt_logs(event_kind, created_at DESC);
    `);
  } finally {
    client.release();
  }
}

// ── Insert ────────────────────────────────────────────────────────────

export interface InsertPromptLogInput {
  session_id: string;
  cwd: string;
  event_kind?: PromptEventKind;
  prompt_text?: string | null;
  response_summary?: string | null;
  tools_used?: unknown;
  files_changed?: unknown;
  tokens?: unknown;
  duration_ms?: number | null;
  git_commit_sha?: string | null;
  metadata?: unknown;
}

/** Best-effort — returns the row id, or null on failure. Never throws. */
export async function insertPromptLog(input: InsertPromptLogInput): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO prompt_logs
         (session_id, event_kind, cwd, prompt_text, response_summary,
          tools_used, files_changed, tokens, duration_ms, git_commit_sha, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        input.session_id.slice(0, 200),
        input.event_kind ?? 'user_prompt',
        input.cwd.slice(0, 500),
        (input.prompt_text ?? null) && String(input.prompt_text).slice(0, MAX_TEXT),
        (input.response_summary ?? null) && String(input.response_summary).slice(0, MAX_SUMMARY),
        input.tools_used == null ? null : JSON.stringify(input.tools_used),
        input.files_changed == null ? null : JSON.stringify(input.files_changed),
        input.tokens == null ? null : JSON.stringify(input.tokens),
        input.duration_ms ?? null,
        input.git_commit_sha ?? null,
        input.metadata == null ? null : JSON.stringify(input.metadata),
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[PromptLogs] insertPromptLog failed:', err);
    return null;
  }
}

// ── Read ──────────────────────────────────────────────────────────────

export interface ProjectSummary {
  cwd: string;
  prompt_count: number;
  session_count: number;
  first_seen: string;
  last_seen: string;
}

/** One row per distinct cwd — used for the left-side sidebar. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const { rows } = await pool.query<ProjectSummary>(
    `SELECT cwd,
            COUNT(*) FILTER (WHERE event_kind = 'user_prompt')::int AS prompt_count,
            COUNT(DISTINCT session_id)::int AS session_count,
            MIN(created_at) AS first_seen,
            MAX(created_at) AS last_seen
       FROM prompt_logs
      GROUP BY cwd
      ORDER BY last_seen DESC`,
  );
  return rows;
}

export interface SessionSummary {
  session_id: string;
  cwd: string;
  prompt_count: number;
  first_prompt: string | null;   // used as "title" of the session
  started_at: string;
  last_activity_at: string;
}

/** All sessions for one project — used to group the timeline. */
export async function listSessions(cwd: string, limit = 50): Promise<SessionSummary[]> {
  const { rows } = await pool.query<SessionSummary>(
    `WITH agg AS (
       SELECT session_id,
              cwd,
              COUNT(*) FILTER (WHERE event_kind = 'user_prompt')::int AS prompt_count,
              MIN(created_at) AS started_at,
              MAX(created_at) AS last_activity_at
         FROM prompt_logs
        WHERE cwd = $1
        GROUP BY session_id, cwd
     )
     SELECT a.*, (
       SELECT prompt_text FROM prompt_logs
        WHERE session_id = a.session_id AND event_kind = 'user_prompt'
        ORDER BY created_at ASC LIMIT 1
     ) AS first_prompt
       FROM agg a
      ORDER BY last_activity_at DESC
      LIMIT $2`,
    [cwd, limit],
  );
  return rows;
}

/** Full event list for a given session — chronological order. */
export async function listEventsForSession(session_id: string): Promise<PromptLogRow[]> {
  const { rows } = await pool.query<PromptLogRow>(
    `SELECT * FROM prompt_logs
      WHERE session_id = $1
      ORDER BY created_at ASC`,
    [session_id],
  );
  return rows;
}

/** Flat feed of events for a project (all sessions), newest first. */
export async function listEventsForProject(cwd: string, limit = 200, offset = 0): Promise<PromptLogRow[]> {
  const { rows } = await pool.query<PromptLogRow>(
    `SELECT * FROM prompt_logs
      WHERE cwd = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [cwd, Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)],
  );
  return rows;
}

// ── Stats ─────────────────────────────────────────────────────────────

export interface ProjectStats {
  total_prompts: number;
  total_sessions: number;
  avg_prompts_per_session: number;
  first_seen: string | null;
  last_seen: string | null;
}

export async function getProjectStats(cwd: string): Promise<ProjectStats> {
  const { rows } = await pool.query<{
    total_prompts: number;
    total_sessions: number;
    first_seen: string | null;
    last_seen: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_kind = 'user_prompt')::int AS total_prompts,
       COUNT(DISTINCT session_id)::int                         AS total_sessions,
       MIN(created_at) AS first_seen,
       MAX(created_at) AS last_seen
     FROM prompt_logs
     WHERE cwd = $1`,
    [cwd],
  );
  const r = rows[0] ?? { total_prompts: 0, total_sessions: 0, first_seen: null, last_seen: null };
  const avg = r.total_sessions > 0 ? r.total_prompts / r.total_sessions : 0;
  return { ...r, avg_prompts_per_session: Math.round(avg * 100) / 100 };
}
