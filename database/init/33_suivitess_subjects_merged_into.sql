-- Migration 33 — hide-and-link mode for cross-doc duplicate detection.
--
-- When the user accepts a duplicate group and picks a canonical "parent",
-- the other subjects in the group are :
--   1. Surfaced in the parent's place via the existing
--      `suivitess_subject_cross_links` mechanism (cross-doc link from
--      parent → duplicate's section).
--   2. **Hidden** from the rendering of their canonical document by
--      setting `merged_into_subject_id` to the parent's id. The row
--      stays in DB (so the merge can be reverted) but the renderer
--      drops it from the document view — the user sees a single
--      "lié depuis …" card surfacing the parent instead of two
--      duplicates side-by-side.
--
-- Reverting a duplicate detection run :
--   1. Delete the cross-links.
--   2. Clear `merged_into_subject_id` back to NULL on every formerly
--      merged subject.

ALTER TABLE suivitess_subjects
  ADD COLUMN IF NOT EXISTS merged_into_subject_id UUID
    REFERENCES suivitess_subjects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suivitess_subjects_merged_into
  ON suivitess_subjects(merged_into_subject_id)
  WHERE merged_into_subject_id IS NOT NULL;
