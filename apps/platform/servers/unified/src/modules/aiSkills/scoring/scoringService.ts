// DB layer + orchestration for AI analysis scores.
//   - runAutoScorersForLog : run every registered heuristic + llm-judge that
//     applies to a log, write one row per scorer. Idempotent via the partial
//     unique index `uniq_ai_scores_auto`.
//   - recordHumanScore : record a thumbs-up/down (or free-value 0..1) with
//     optional rationale, tagged as scorer_kind='human'.

import { Pool } from 'pg';
import { config } from '../../../config.js';
import { getAnalysisLog } from '../analysisLogsService.js';
import { getRegisteredScorers } from './scorers.js';

let pool: Pool;

export interface ScoreRow {
  id: number;
  log_id: number;
  score_name: string;
  score_value: string;  // NUMERIC -> string in node-pg
  scorer_kind: 'heuristic' | 'llm-judge' | 'human';
  scorer_id: string | null;
  rationale: string | null;
  annotator_user_id: number | null;
  created_at: string;
}

export async function initScoresPool(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_analysis_scores (
        id                 SERIAL PRIMARY KEY,
        log_id             INTEGER NOT NULL REFERENCES ai_analysis_logs(id) ON DELETE CASCADE,
        score_name         VARCHAR(80) NOT NULL,
        score_value        NUMERIC(6,4) NOT NULL,
        scorer_kind        VARCHAR(20) NOT NULL CHECK (scorer_kind IN ('heuristic','llm-judge','human')),
        scorer_id          VARCHAR(100),
        rationale          TEXT,
        annotator_user_id  INTEGER,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_scores_log  ON ai_analysis_scores(log_id);
      CREATE INDEX IF NOT EXISTS idx_ai_scores_name ON ai_analysis_scores(score_name);
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_scores_auto
        ON ai_analysis_scores(log_id, scorer_id)
        WHERE scorer_kind IN ('heuristic','llm-judge');
    `);
  } finally {
    client.release();
  }
}

/** Upsert-style insert for automated scorers — keyed on (log_id, scorer_id). */
export async function upsertAutoScore(
  logId: number,
  scorerId: string,
  scoreName: string,
  scorerKind: 'heuristic' | 'llm-judge',
  value: number,
  rationale?: string | null,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_analysis_scores
         (log_id, score_name, score_value, scorer_kind, scorer_id, rationale)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (log_id, scorer_id)
       WHERE scorer_kind IN ('heuristic','llm-judge')
       DO UPDATE SET
         score_value = EXCLUDED.score_value,
         rationale   = EXCLUDED.rationale,
         created_at  = NOW()`,
      [logId, scoreName.slice(0, 80), value, scorerKind, scorerId.slice(0, 100), (rationale ?? '').slice(0, 2000) || null],
    );
  } catch (err) {
    console.error('[AiSkills] upsertAutoScore failed:', err);
  }
}

export async function recordHumanScore(
  logId: number,
  userId: number,
  name: string,
  value: number,
  rationale?: string | null,
): Promise<ScoreRow | null> {
  try {
    const { rows } = await pool.query<ScoreRow>(
      `INSERT INTO ai_analysis_scores
         (log_id, score_name, score_value, scorer_kind, annotator_user_id, rationale)
       VALUES ($1, $2, $3, 'human', $4, $5)
       RETURNING *`,
      [logId, name.slice(0, 80), value, userId, (rationale ?? '').slice(0, 2000) || null],
    );
    return rows[0] ?? null;
  } catch (err) {
    console.error('[AiSkills] recordHumanScore failed:', err);
    return null;
  }
}

export async function deleteScore(scoreId: number, userId: number): Promise<boolean> {
  try {
    // Only allow deleting human scores authored by the current user.
    const { rowCount } = await pool.query(
      `DELETE FROM ai_analysis_scores
        WHERE id = $1
          AND scorer_kind = 'human'
          AND annotator_user_id = $2`,
      [scoreId, userId],
    );
    return (rowCount ?? 0) > 0;
  } catch (err) {
    console.error('[AiSkills] deleteScore failed:', err);
    return false;
  }
}

export async function listScoresForLog(logId: number): Promise<ScoreRow[]> {
  const { rows } = await pool.query<ScoreRow>(
    `SELECT * FROM ai_analysis_scores WHERE log_id = $1 ORDER BY created_at DESC`,
    [logId],
  );
  return rows;
}

export interface AggregateOptions {
  skillSlug?: string;
  skillVersionHash?: string;
  sinceDays?: number;
}

export interface AggregateRow {
  score_name: string;
  scorer_kind: 'heuristic' | 'llm-judge' | 'human';
  avg: string;
  count: string;
}

/** Aggregate scores per (score_name, scorer_kind). Filters on skill and
 *  time window. Used by the /ai-logs "quality by skill" card. */
export async function aggregateScores(options: AggregateOptions = {}): Promise<AggregateRow[]> {
  const filters: string[] = [];
  const values: unknown[] = [];
  values.push(options.skillSlug ?? null);
  filters.push('(l.skill_slug = $1 OR $1 IS NULL)');
  values.push(options.skillVersionHash ?? null);
  filters.push('(l.skill_version_hash = $2 OR $2 IS NULL)');
  values.push(options.sinceDays ?? 30);
  filters.push(`l.created_at >= NOW() - ($3::int * INTERVAL '1 day')`);

  const { rows } = await pool.query<AggregateRow>(
    `SELECT s.score_name, s.scorer_kind,
            AVG(s.score_value)::TEXT AS avg,
            COUNT(*)::TEXT            AS count
       FROM ai_analysis_scores s
       JOIN ai_analysis_logs   l ON l.id = s.log_id
      WHERE ${filters.join(' AND ')}
      GROUP BY s.score_name, s.scorer_kind
      ORDER BY s.scorer_kind, s.score_name`,
    values,
  );
  return rows;
}

/** Run every applicable scorer and persist results. Never throws — best-effort. */
export async function runAutoScorersForLog(logId: number): Promise<void> {
  try {
    const log = await getAnalysisLog(logId);
    if (!log) return;
    const scorers = getRegisteredScorers();
    for (const scorer of scorers) {
      if (!scorer.appliesTo(log)) continue;
      try {
        const result = await scorer.score(log);
        const clamped = Math.max(-1, Math.min(1, result.value));
        await upsertAutoScore(logId, scorer.id, scorer.name, scorer.kind, clamped, result.rationale ?? null);
      } catch (err) {
        console.error(`[AiSkills] scorer ${scorer.id} failed on log #${logId}:`, err);
      }
    }
  } catch (err) {
    console.error('[AiSkills] runAutoScorersForLog failed:', err);
  }
}
