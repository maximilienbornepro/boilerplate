\c app;

-- Cross-document subject links.
--
-- A "linked subject" is the SAME subject row appearing in another
-- section (potentially in another document). The subject lives in
-- ONE canonical section (suivitess_subjects.section_id) ; rows in
-- this table are pointers from a target section back to that
-- canonical id. Editing the subject anywhere updates the canonical
-- row, so every linked occurrence sees the change immediately.
--
-- A subject can be linked to many target sections (1-to-N).
-- Deleting the canonical subject cascades and removes every link.
-- Removing a single link only deletes the row here — the canonical
-- subject and every other link survive.
CREATE TABLE IF NOT EXISTS suivitess_subject_cross_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Canonical subject — the source of truth. Edits flow through it.
  origin_subject_id UUID NOT NULL REFERENCES suivitess_subjects(id) ON DELETE CASCADE,
  -- Section where the subject appears as a "linked from elsewhere"
  -- card. Cascade-delete : when a target section is removed, its
  -- inbound links die with it.
  target_section_id UUID NOT NULL REFERENCES suivitess_sections(id) ON DELETE CASCADE,
  -- Position inside the target section's ordered subject list. Mixed
  -- with native subjects' position when rendering.
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- A subject can only appear once per target section (no duplicate
  -- pointers). Linking a subject back to its OWN section is also
  -- rejected at the application layer (no in-place dup).
  UNIQUE(origin_subject_id, target_section_id)
);

CREATE INDEX IF NOT EXISTS idx_suivitess_subj_links_origin
  ON suivitess_subject_cross_links(origin_subject_id);
CREATE INDEX IF NOT EXISTS idx_suivitess_subj_links_target
  ON suivitess_subject_cross_links(target_section_id);
