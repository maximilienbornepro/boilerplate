\c app;

-- Tile-by-tile CV adaptation (replaces the old all-at-once
-- `adaptCVPipeline`).
--
-- One row per atomic CV element that the AI proposes to adjust to a
-- specific job offer. The user walks through each tile, accepts /
-- skips / edits / regenerates. Accepting or editing a tile merges
-- its final text into `cv_adaptations.adapted_cv` (JSONB) at the
-- given `path`.
CREATE TABLE IF NOT EXISTS cv_adaptation_tiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Parent adaptation row. Cascade-delete : when an adaptation is
  -- deleted, all its tiles go with it.
  adaptation_id INTEGER NOT NULL REFERENCES cv_adaptations(id) ON DELETE CASCADE,
  -- Stable hash of `path` — survives index drift inside arrays so
  -- regenerate/apply can target a single item without shifting.
  tile_id TEXT NOT NULL,
  -- JSONPath-ish location inside CVData. Examples : "summary",
  -- "competences[5]", "experiences[2].missions[0]",
  -- "experiences[2].projects[1].description".
  path TEXT NOT NULL,
  -- Discriminator so the UI can render a sensible label/header for
  -- the tile : summary, skill, experience_title, experience_description,
  -- mission, project_title, project_description, language, formation,
  -- award, side_project.
  kind TEXT NOT NULL,
  -- Untouched text from the original CV, displayed read-only in the
  -- "Original" panel of the tile.
  original_text TEXT NOT NULL,
  -- AI proposal from skill B (mon-cv-adapt-atomic-to-offer). Replaced
  -- on regenerate.
  proposed_text TEXT NOT NULL,
  -- User-typed override after they clicked "Modifier". NULL = use the
  -- AI proposal as-is.
  user_edited_text TEXT,
  -- Lifecycle : pending (waiting for user) → accepted | skipped | edited.
  -- A tile is only merged into adapted_cv when status IN
  -- ('accepted', 'edited').
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'skipped', 'edited')),
  regenerate_count INTEGER NOT NULL DEFAULT 0,
  -- ai_analysis_logs row from the most recent skill-B run. NULL until
  -- the first AI proposal lands. Lets the /ai-logs page surface the
  -- raw input/output of each tile generation.
  ai_log_id INTEGER REFERENCES ai_analysis_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(adaptation_id, tile_id)
);

CREATE INDEX IF NOT EXISTS idx_cv_tiles_adaptation
  ON cv_adaptation_tiles(adaptation_id);
CREATE INDEX IF NOT EXISTS idx_cv_tiles_status
  ON cv_adaptation_tiles(adaptation_id, status);
