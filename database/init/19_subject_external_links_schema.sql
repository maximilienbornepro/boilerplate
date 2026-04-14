\c app;

-- Links subjects to external resources (Jira tickets, Notion pages, Roadmap tasks)
CREATE TABLE IF NOT EXISTS subject_external_links (
    id SERIAL PRIMARY KEY,
    subject_id UUID NOT NULL REFERENCES suivitess_subjects(id) ON DELETE CASCADE,
    service VARCHAR(20) NOT NULL,
    external_id VARCHAR(200) NOT NULL,
    external_url TEXT NOT NULL,
    external_title TEXT,
    external_status TEXT,
    metadata JSONB,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(subject_id, service, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sel_subject ON subject_external_links(subject_id);
CREATE INDEX IF NOT EXISTS idx_sel_service ON subject_external_links(service, external_id);
