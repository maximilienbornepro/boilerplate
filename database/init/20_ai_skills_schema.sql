-- AI Skills storage — editable from the admin UI, seeded from .md files on first boot.
-- The `slug` is the stable id referenced from code. The markdown file on disk
-- acts as the shipped default ; `content` here is what actually goes into the
-- AI prompt. Admins can override via the admin page ; "reset" re-copies the
-- file content back into this row.

CREATE TABLE IF NOT EXISTS ai_skills (
  slug VARCHAR(100) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  is_customized BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ai_skills_updated_at ON ai_skills(updated_at DESC);
