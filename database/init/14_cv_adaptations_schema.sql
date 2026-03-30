\connect app;

-- CV Adaptations: stores each AI-generated adaptation as an independent entity
-- The original CV (cvs table) is never modified by an adaptation
CREATE TABLE IF NOT EXISTS cv_adaptations (
  id            SERIAL PRIMARY KEY,
  cv_id         INTEGER NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_offer     TEXT NOT NULL,
  adapted_cv    JSONB NOT NULL,       -- full CVData of the adapted CV (editable)
  changes       JSONB NOT NULL,       -- { newMissions, newProject, addedSkills }
  ats_before    JSONB NOT NULL,       -- AtsScore before adaptation
  ats_after     JSONB NOT NULL,       -- AtsScore after adaptation (updated on edit)
  job_analysis  JSONB NOT NULL,       -- JobAnalysis for client-side rescoring
  name          VARCHAR(255),         -- optional user-defined label
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cv_adaptations_cv_id ON cv_adaptations(cv_id);
CREATE INDEX IF NOT EXISTS idx_cv_adaptations_user_id ON cv_adaptations(user_id);
