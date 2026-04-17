-- Historique de tous les appels IA qui utilisent un skill éditable.
-- Permet à l'admin de consulter ce qui a été envoyé au modèle + le résultat.
-- Conserve le prompt complet tel qu'assemblé au runtime (skill courant + contexte).

CREATE TABLE IF NOT EXISTS ai_analysis_logs (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER,
  user_email     VARCHAR(200),
  skill_slug     VARCHAR(100) NOT NULL,
  source_kind    VARCHAR(50),        -- transcript, outlook, gmail, slack, subject, board, ...
  source_title   VARCHAR(500),
  document_id    VARCHAR(50),        -- suivitess document or delivery board id
  input_content  TEXT NOT NULL,      -- raw user content fed to the AI (tronqué 100k)
  full_prompt    TEXT NOT NULL,      -- skill + exec context sent to Claude
  ai_output_raw  TEXT NOT NULL,      -- text returned by the AI (full)
  proposals_json JSONB,              -- parsed proposals if applicable
  proposals_count INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_created_at ON ai_analysis_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_skill_slug ON ai_analysis_logs(skill_slug);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_logs_user_id   ON ai_analysis_logs(user_id);
