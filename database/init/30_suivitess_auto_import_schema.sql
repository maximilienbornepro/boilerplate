-- Auto-import feature for suivitess.
--
-- Two tables :
--
-- 1. suivitess_auto_import_config — per (user, document) configuration
--    of the hourly cron : which sources are enabled, master switch, last
--    run metadata. One row per (user, doc) ; the master kill-switch on
--    the user-level lives in `users` / settings (handled separately).
--
-- 2. suivitess_inbox_proposals — every analysis the cron produces lands
--    here as a row carrying the FinalReviewProposal[] JSONB. The user
--    reviews them via the inbox UI ; accepted rows trigger apply-routing
--    and flip status='accepted'. Rejected rows stay visible in the
--    "Refusées" tab so the user can reconsider later.

-- ── Config (per user × document) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS suivitess_auto_import_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,        -- per-doc toggle
  /** Subset of {'fathom','otter','outlook','gmail','slack'} the user
   *  wants to auto-process for this document. */
  enabled_sources TEXT[] NOT NULL DEFAULT '{}',
  last_run_at TIMESTAMPTZ,
  last_error TEXT,
  /** Count of consecutive failed runs ; used to auto-pause a config
   *  after N errors (3 by default — handled in code). Reset to 0 on
   *  any successful run. */
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_suivitess_autoimport_config_enabled
  ON suivitess_auto_import_config(enabled, last_run_at)
  WHERE enabled = TRUE;

-- ── Per-user master kill-switch ─────────────────────────────────────
-- Module-local user-settings table (avoids touching the gateway's
-- users table from the suivitess module). One row per user that
-- has interacted with the toggle ; absence = default (enabled).

CREATE TABLE IF NOT EXISTS suivitess_user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_import_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Inbox proposals ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS suivitess_inbox_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,                -- 'fathom' | 'otter' | 'outlook' | 'gmail' | 'slack'
  source_id TEXT NOT NULL,                  -- call id / digest id ; matches suivitess_transcript_imports
  source_title TEXT,
  source_date TIMESTAMPTZ,                  -- date of the source itself (call date, mail date, day-digest date)
  /** Raw FinalReviewProposal[] JSONB as produced by analyzeSourceForReviews.
   *  Includes title, situation, status, action, sectionAction, etc. per
   *  subject + the AI's reasoning. The detail view + the bulk-modal
   *  routing UI consume this directly. */
  proposals JSONB NOT NULL,
  ai_log_id INTEGER REFERENCES ai_analysis_logs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_suivitess_inbox_user_status
  ON suivitess_inbox_proposals(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suivitess_inbox_document
  ON suivitess_inbox_proposals(document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suivitess_inbox_source
  ON suivitess_inbox_proposals(source_kind, source_id);
