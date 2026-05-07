-- Live subject marks captured during a recording.
--
-- The user clicks "🎙️ on en parle" on a subject of a suivitess
-- document while a meeting is being recorded (Fathom, etc.). Each
-- click writes a row here. At transcript import time, the pipeline
-- T1 fetches the marks that fall within the call's recorded_at +
-- duration window, converts them to relative second-offsets, and
-- INJECTS them into the extraction prompt as a ground-truth section.
-- This complements the existing free extraction — it does NOT
-- replace it. Pre-mark portions of the transcript stay extracted
-- with the standard rules.
--
-- subject_id NULL = the user clicked "stop marking" / "off-topic now".

CREATE TABLE IF NOT EXISTS suivitess_subject_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES suivitess_subjects(id) ON DELETE SET NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suivitess_marks_user_doc
  ON suivitess_subject_marks(user_id, document_id, clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_suivitess_marks_clicked_at
  ON suivitess_subject_marks(clicked_at DESC);
