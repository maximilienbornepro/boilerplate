-- Platform settings: feature flags and cross-module configuration
-- Managed by admins, readable by all authenticated users

CREATE TABLE IF NOT EXISTS platform_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT         NOT NULL DEFAULT 'false',
  description TEXT,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed: Roadmap <-> SuiviTess integration disabled by default
INSERT INTO platform_settings (key, value, description)
VALUES ('integration_roadmap_suivitess', 'false', 'Liaison Tâches Roadmap ↔ Sujets SuiviTess')
ON CONFLICT (key) DO NOTHING;

-- Link table: roadmap tasks <-> suivitess subjects
CREATE TABLE IF NOT EXISTS roadmap_task_subjects (
  task_id    UUID NOT NULL,
  subject_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_rts_task    ON roadmap_task_subjects(task_id);
CREATE INDEX IF NOT EXISTS idx_rts_subject ON roadmap_task_subjects(subject_id);
