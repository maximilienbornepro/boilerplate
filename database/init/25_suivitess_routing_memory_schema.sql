-- SuiviTess : learning memory of past routing decisions.
--
-- Each row is ONE validated (review + section + subject-action) decision
-- that the user confirmed during an import. At every future import, we
-- retrieve the top-K most semantically similar past decisions via
-- pgvector cosine distance and inject them as few-shot examples in the
-- place-in-reviews prompt. Over time, the AI mirrors the user's
-- routing habits without any fine-tuning.
--
-- Purely additive — no existing table is touched. Feature degrades
-- gracefully if the embedding provider is unreachable : store fails,
-- retrieval returns empty, pipeline runs exactly as before.

\c app;

CREATE TABLE IF NOT EXISTS suivitess_routing_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- What the AI saw at extract time (what drove the decision).
  subject_title TEXT NOT NULL,
  subject_situation_excerpt TEXT,
  raw_quotes_joined TEXT,             -- concat of rawQuotes, used for embedding + debug
  entities TEXT[] DEFAULT '{}',
  participants TEXT[] DEFAULT '{}',

  -- Final decision after user validation.
  target_document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
  target_document_title TEXT NOT NULL, -- denormalized : keep history even if the review is renamed
  target_section_id UUID,              -- nullable : section may have been deleted since
  target_section_name TEXT NOT NULL,
  target_subject_action VARCHAR(30) NOT NULL, -- 'new-subject' | 'update-existing-subject'

  -- Observability : did the user override what the AI initially proposed ?
  ai_proposed_document_id VARCHAR(50),
  ai_proposed_document_title TEXT,
  user_overrode_ai BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hot-path index : retrieve user's recent decisions first.
CREATE INDEX IF NOT EXISTS idx_routing_memory_user_created
  ON suivitess_routing_memory (user_id, created_at DESC);

-- The `embedding halfvec(<dim>)` column is added at boot time by
-- `routingMemoryService.initRoutingMemory()` once the embedding dimension
-- is known — same dynamic pattern as rag_chunks (see rag/services/dbService.ts).

-- Forget policy : auto-delete decisions older than 12 months. We keep a
-- window long enough for seasonal patterns (yearly releases, quarterly
-- copils) but not so long that stale routing habits linger forever.
-- Implemented via a cron-style trigger on INSERT that opportunistically
-- cleans up (cheap, doesn't need a separate scheduler process).
CREATE OR REPLACE FUNCTION routing_memory_expire_old()
  RETURNS TRIGGER AS $$
BEGIN
  -- 1-in-100 chance per INSERT so we don't thrash on every write.
  IF random() < 0.01 THEN
    DELETE FROM suivitess_routing_memory
    WHERE created_at < NOW() - INTERVAL '12 months';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_routing_memory_expire ON suivitess_routing_memory;
CREATE TRIGGER trg_routing_memory_expire
  BEFORE INSERT ON suivitess_routing_memory
  FOR EACH ROW EXECUTE FUNCTION routing_memory_expire_old();
