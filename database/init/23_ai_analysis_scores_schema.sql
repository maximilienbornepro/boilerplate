-- Phase 2 — Scoring layer for AI analysis logs.
--
-- Each log can receive N scores :
--   - `heuristic`  : cheap deterministic checks (json_valid, latency, …).
--   - `llm-judge`  : scored by another Claude call (faithfulness, relevance…).
--   - `human`      : thumbs-up / down + free-text annotation.
--
-- For automated scorers the partial unique index below guarantees each
-- (log, scorer_id) pair writes exactly one row — safe to re-run.

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

-- Idempotent : one auto-score per (log, scorer_id). Humans can submit
-- multiple rows (e.g. change their mind) — not covered by this unique.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_scores_auto
  ON ai_analysis_scores(log_id, scorer_id)
  WHERE scorer_kind IN ('heuristic','llm-judge');
