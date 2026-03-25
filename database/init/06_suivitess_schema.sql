-- SuiViTess module schema
\c app;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Documents table
CREATE TABLE IF NOT EXISTS suivitess_documents (
  id VARCHAR(50) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sections table
CREATE TABLE IF NOT EXISTS suivitess_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subjects table
CREATE TABLE IF NOT EXISTS suivitess_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES suivitess_sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  situation TEXT,
  status VARCHAR(50) DEFAULT '🔴 à faire',
  responsibility TEXT,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Snapshots table (JSON format)
CREATE TABLE IF NOT EXISTS suivitess_snapshots (
  id SERIAL PRIMARY KEY,
  document_id VARCHAR(50) NOT NULL REFERENCES suivitess_documents(id) ON DELETE CASCADE,
  snapshot_data JSONB NOT NULL,
  type VARCHAR(20) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_suivitess_sections_document ON suivitess_sections(document_id);
CREATE INDEX IF NOT EXISTS idx_suivitess_subjects_section ON suivitess_subjects(section_id);
CREATE INDEX IF NOT EXISTS idx_suivitess_snapshots_document ON suivitess_snapshots(document_id);
