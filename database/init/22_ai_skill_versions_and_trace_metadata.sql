-- Phase 1 — Observability upgrade for ai_analysis_logs
--
-- Adds versioning for skills (each edit captured as an immutable row in
-- ai_skill_versions) so every log can point at the exact prompt content
-- used, and enriches ai_analysis_logs with token counts, cost, model and
-- parent_log_id (for replays / experiment runs).

-- ── 1) Versioned history of skills ──
CREATE TABLE IF NOT EXISTS ai_skill_versions (
  id                 SERIAL PRIMARY KEY,
  skill_slug         VARCHAR(100) NOT NULL REFERENCES ai_skills(slug),
  content_hash       CHAR(64) NOT NULL,            -- SHA-256 hex of `content`
  content            TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id INTEGER,
  UNIQUE(skill_slug, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_skill_versions_slug_created
  ON ai_skill_versions(skill_slug, created_at DESC);

-- ── 2) Observability columns on ai_analysis_logs ──
-- Legacy rows keep NULL in these columns and are rendered accordingly in the UI.
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
