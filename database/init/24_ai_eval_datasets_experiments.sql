-- Phase 3 — Datasets + Experiments (golden set, regression measurement).
--
--   ai_eval_datasets        : named collection of inputs for a given skill.
--   ai_eval_dataset_items   : one (input, expected_output?) per row ; may
--                             originate from an existing log (source_log_id).
--   ai_eval_experiments     : one run of a skill version on a full dataset.
--   ai_eval_experiment_runs : join table — one row per (experiment, item)
--                             pointing at the ai_analysis_logs row created
--                             during the run.

CREATE TABLE IF NOT EXISTS ai_eval_datasets (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  skill_slug   VARCHAR(100) NOT NULL REFERENCES ai_skills(slug),
  description  TEXT,
  created_by   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_eval_dataset_items (
  id               SERIAL PRIMARY KEY,
  dataset_id       INTEGER NOT NULL REFERENCES ai_eval_datasets(id) ON DELETE CASCADE,
  source_log_id    INTEGER REFERENCES ai_analysis_logs(id),
  input_content    TEXT NOT NULL,
  expected_output  JSONB,
  expected_notes   TEXT,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_eval_items_dataset ON ai_eval_dataset_items(dataset_id, position);

CREATE TABLE IF NOT EXISTS ai_eval_experiments (
  id                  SERIAL PRIMARY KEY,
  dataset_id          INTEGER NOT NULL REFERENCES ai_eval_datasets(id) ON DELETE CASCADE,
  name                VARCHAR(200) NOT NULL,
  skill_version_hash  CHAR(64) NOT NULL,
  model               VARCHAR(100),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | running | done | error
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  error               TEXT,
  created_by          INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_eval_experiments_dataset ON ai_eval_experiments(dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_eval_experiment_runs (
  id            SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES ai_eval_experiments(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES ai_eval_dataset_items(id) ON DELETE CASCADE,
  log_id        INTEGER NOT NULL REFERENCES ai_analysis_logs(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_eval_runs_exp ON ai_eval_experiment_runs(experiment_id);
