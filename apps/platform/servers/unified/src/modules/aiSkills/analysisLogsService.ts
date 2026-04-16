// Writes one row per AI analysis call. Values are truncated so extreme
// inputs never blow up the DB ; the admin UI displays them as-is.

import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export interface AnalysisLogRow {
  id: number;
  user_id: number | null;
  user_email: string | null;
  skill_slug: string;
  source_kind: string | null;
  source_title: string | null;
  document_id: string | null;
  input_content: string;
  full_prompt: string;
  ai_output_raw: string;
  proposals_json: unknown;
  proposals_count: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

const MAX_INPUT = 100_000;
const MAX_PROMPT = 200_000;
const MAX_OUTPUT = 200_000;

export async function initLogsPool(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_analysis_logs (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER,
        user_email     VARCHAR(200),
        skill_slug     VARCHAR(100) NOT NULL,
        source_kind    VARCHAR(50),
        source_title   VARCHAR(500),
        document_id    VARCHAR(50),
        input_content  TEXT NOT NULL,
        full_prompt    TEXT NOT NULL,
        ai_output_raw  TEXT NOT NULL,
        proposals_json JSONB,
        proposals_count INTEGER NOT NULL DEFAULT 0,
        duration_ms    INTEGER,
        error          TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_created_at ON ai_analysis_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_skill_slug ON ai_analysis_logs(skill_slug);
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_user_id   ON ai_analysis_logs(user_id);
    `);
  } finally {
    client.release();
  }
}

export interface LogAnalysisInput {
  userId?: number | null;
  userEmail?: string | null;
  skillSlug: string;
  sourceKind?: string | null;
  sourceTitle?: string | null;
  documentId?: string | null;
  inputContent: string;
  fullPrompt: string;
  aiOutputRaw: string;
  proposals?: unknown;
  durationMs?: number | null;
  error?: string | null;
}

/** Never throws — logging is best-effort, we don't want a DB glitch to kill
 *  an AI call. Returns the inserted row id (or null if logging failed) so
 *  callers can surface a link to the log in the UI. */
export async function logAnalysis(input: LogAnalysisInput): Promise<number | null> {
  try {
    const proposalsArr = Array.isArray(input.proposals) ? input.proposals : [];
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO ai_analysis_logs
        (user_id, user_email, skill_slug, source_kind, source_title, document_id,
         input_content, full_prompt, ai_output_raw, proposals_json, proposals_count,
         duration_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        input.userId ?? null,
        (input.userEmail ?? '').slice(0, 200) || null,
        input.skillSlug,
        (input.sourceKind ?? '').slice(0, 50) || null,
        (input.sourceTitle ?? '').slice(0, 500) || null,
        (input.documentId ?? '').slice(0, 50) || null,
        (input.inputContent ?? '').slice(0, MAX_INPUT),
        (input.fullPrompt ?? '').slice(0, MAX_PROMPT),
        (input.aiOutputRaw ?? '').slice(0, MAX_OUTPUT),
        JSON.stringify(input.proposals ?? null),
        proposalsArr.length,
        input.durationMs ?? null,
        input.error ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[AiSkills] Failed to write analysis log:', err);
    return null;
  }
}

export async function listAnalysisLogs(options: {
  limit?: number;
  offset?: number;
  skillSlug?: string;
  userId?: number;
} = {}): Promise<Array<Pick<AnalysisLogRow, 'id' | 'user_id' | 'user_email' | 'skill_slug' | 'source_kind' | 'source_title' | 'document_id' | 'proposals_count' | 'duration_ms' | 'error' | 'created_at'>>> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const filters: string[] = [];
  const values: unknown[] = [];
  if (options.skillSlug) { values.push(options.skillSlug); filters.push(`skill_slug = $${values.length}`); }
  if (options.userId) { values.push(options.userId); filters.push(`user_id = $${values.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  values.push(limit); values.push(offset);
  const { rows } = await pool.query(
    `SELECT id, user_id, user_email, skill_slug, source_kind, source_title,
            document_id, proposals_count, duration_ms, error, created_at
       FROM ai_analysis_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return rows;
}

export async function getAnalysisLog(id: number): Promise<AnalysisLogRow | null> {
  const { rows } = await pool.query<AnalysisLogRow>(
    'SELECT * FROM ai_analysis_logs WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}
