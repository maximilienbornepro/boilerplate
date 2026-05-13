\c app;

-- Cross-document duplicate-detection runs.
--
-- Each row records one application of the "Détecter les doublons" flow :
-- the user accepted N groups, each linking K subjects under a chosen
-- canonical parent through `suivitess_subject_cross_links`. The list of
-- created `linkIds` is captured in `applied_groups` so the user can undo
-- the whole run from the toast (or from a future history panel).
--
-- `reverted_at` is stamped on revert so we can never double-revert.
CREATE TABLE IF NOT EXISTS suivitess_duplicate_detection_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ai_log_id      INTEGER REFERENCES ai_analysis_logs(id) ON DELETE SET NULL,
  applied_groups JSONB NOT NULL,
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reverted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_suivitess_dup_runs_user
  ON suivitess_duplicate_detection_runs(user_id, applied_at DESC);
