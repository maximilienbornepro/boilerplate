// Writes one row per AI analysis call. Values are truncated so extreme
// inputs never blow up the DB ; the admin UI displays them as-is.

import { Pool } from 'pg';
import { config } from '../../config.js';
import { computeCostUsd } from './pricing.js';

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
  // Phase 1 — enriched trace metadata (nullable for legacy rows)
  skill_version_hash: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;        // PG NUMERIC -> string in node-pg
  parent_log_id: number | null;
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
    // Phase 1 — additive migration (idempotent). Legacy rows keep NULLs.
    await client.query(`
      ALTER TABLE ai_analysis_logs
        ADD COLUMN IF NOT EXISTS skill_version_hash CHAR(64),
        ADD COLUMN IF NOT EXISTS provider           VARCHAR(20),
        ADD COLUMN IF NOT EXISTS model              VARCHAR(100),
        ADD COLUMN IF NOT EXISTS input_tokens       INTEGER,
        ADD COLUMN IF NOT EXISTS output_tokens      INTEGER,
        ADD COLUMN IF NOT EXISTS cost_usd           NUMERIC(10,6),
        ADD COLUMN IF NOT EXISTS parent_log_id      INTEGER REFERENCES ai_analysis_logs(id);
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_skill_version
        ON ai_analysis_logs(skill_slug, skill_version_hash);
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_parent
        ON ai_analysis_logs(parent_log_id);
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
  // Phase 1 — enriched trace metadata
  skillVersionHash?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** If not provided, computed from (model, inputTokens, outputTokens) via
   *  PRICING_USD_PER_1M. Explicit override wins. */
  costUsd?: number | null;
  parentLogId?: number | null;
}

/** Never throws — logging is best-effort, we don't want a DB glitch to kill
 *  an AI call. Returns the inserted row id (or null if logging failed) so
 *  callers can surface a link to the log in the UI. */
export async function logAnalysis(input: LogAnalysisInput): Promise<number | null> {
  try {
    const proposalsArr = Array.isArray(input.proposals) ? input.proposals : [];
    const cost = input.costUsd != null
      ? input.costUsd
      : computeCostUsd(input.model, input.inputTokens, input.outputTokens);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO ai_analysis_logs
        (user_id, user_email, skill_slug, source_kind, source_title, document_id,
         input_content, full_prompt, ai_output_raw, proposals_json, proposals_count,
         duration_ms, error,
         skill_version_hash, provider, model, input_tokens, output_tokens, cost_usd, parent_log_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20)
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
        (input.skillVersionHash ?? '').slice(0, 64) || null,
        (input.provider ?? '').slice(0, 20) || null,
        (input.model ?? '').slice(0, 100) || null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        cost > 0 ? cost : null,
        input.parentLogId ?? null,
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
} = {}): Promise<Array<Pick<AnalysisLogRow, 'id' | 'user_id' | 'user_email' | 'skill_slug' | 'source_kind' | 'source_title' | 'document_id' | 'proposals_count' | 'duration_ms' | 'error' | 'created_at' | 'model' | 'input_tokens' | 'output_tokens' | 'cost_usd' | 'skill_version_hash' | 'parent_log_id'>>> {
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
            document_id, proposals_count, duration_ms, error, created_at,
            model, input_tokens, output_tokens, cost_usd, skill_version_hash, parent_log_id
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

export interface RecentInputRow {
  id: number;
  skill_slug: string;
  source_kind: string | null;
  source_title: string | null;
  input_preview: string;
  input_length: number;
  created_at: string;
}

/** Groups of source_kind values handled as a single logical source in the
 *  playground picker. When the caller asks for `source=transcript`, we also
 *  match rows whose source_kind is `fathom` or `otter` (the provider name
 *  some call-sites stored verbatim). */
const SOURCE_KIND_GROUPS: Record<string, string[]> = {
  transcript: ['transcript', 'fathom', 'otter'],
  slack: ['slack'],
  outlook: ['outlook'],
  gmail: ['gmail'],
  subject: ['subject'],
  board: ['board'],
};

/** Returns distinct, recent log inputs usable as seeds in the playground /
 *  dataset. Grouped by source_title (we keep the most recent occurrence per
 *  title) so we don't flood the picker with duplicates from repeated runs. */
export async function listRecentInputs(options: {
  skillSlug?: string;
  limit?: number;
  sourceKind?: string;
} = {}): Promise<RecentInputRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 200);
  const filters: string[] = ['LENGTH(input_content) > 0'];
  const values: unknown[] = [];
  if (options.skillSlug) {
    values.push(options.skillSlug);
    filters.push(`skill_slug = $${values.length}`);
  }
  if (options.sourceKind) {
    // Expand to the full set of matching source_kind values when the caller
    // asked for a group (e.g. "transcript" → transcript/fathom/otter).
    const group = SOURCE_KIND_GROUPS[options.sourceKind] ?? [options.sourceKind];
    values.push(group);
    filters.push(`source_kind = ANY($${values.length})`);
  }
  values.push(limit);

  // DISTINCT ON lets us pick the most recent row per (source_title, skill).
  const { rows } = await pool.query<RecentInputRow>(
    `SELECT DISTINCT ON (skill_slug, COALESCE(source_title, CAST(id AS TEXT)))
            id, skill_slug, source_kind, source_title,
            SUBSTRING(input_content FROM 1 FOR 300) AS input_preview,
            LENGTH(input_content) AS input_length,
            created_at
       FROM ai_analysis_logs
      WHERE ${filters.join(' AND ')}
      ORDER BY skill_slug,
               COALESCE(source_title, CAST(id AS TEXT)),
               created_at DESC
      LIMIT $${values.length}`,
    values,
  );
  // Re-sort by created_at desc for display.
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return rows;
}

/** Post-hoc update of the proposals stored on a log row. Used by callers
 *  that parse the AI output after `runSkill` returns. Best-effort, never
 *  throws. */
export async function attachProposalsToLog(
  logId: number,
  proposals: unknown,
): Promise<void> {
  try {
    const count = Array.isArray(proposals) ? proposals.length : 0;
    await pool.query(
      `UPDATE ai_analysis_logs
          SET proposals_json = $2, proposals_count = $3
        WHERE id = $1`,
      [logId, JSON.stringify(proposals ?? null), count],
    );
  } catch (err) {
    console.error('[AiSkills] attachProposalsToLog failed:', err);
  }
}

/** Post-hoc error annotation. Used by the pipeline when the AI call itself
 *  succeeded (no throw) but the output was unusable (parse failure, empty
 *  array, truncation). Without this the log row just looks "fine" even
 *  though the downstream work got zero results. */
export async function updateLogError(
  logId: number,
  error: string,
): Promise<void> {
  try {
    await pool.query(
      `UPDATE ai_analysis_logs SET error = $2 WHERE id = $1`,
      [logId, error.slice(0, 2000)],
    );
  } catch (err) {
    console.error('[AiSkills] updateLogError failed:', err);
  }
}
