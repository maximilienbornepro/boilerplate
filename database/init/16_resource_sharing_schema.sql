\c app;

-- Generic resource sharing tables (ownership + visibility + per-user shares).
-- Used by roadmap plannings, delivery boards, and suivitess documents.

CREATE TABLE IF NOT EXISTS resource_sharing (
    id SERIAL PRIMARY KEY,
    resource_type VARCHAR(20) NOT NULL,     -- 'roadmap' | 'delivery' | 'suivitess'
    resource_id VARCHAR(100) NOT NULL,      -- UUID or slug of the resource
    owner_id INTEGER NOT NULL,
    visibility VARCHAR(10) NOT NULL DEFAULT 'private',  -- 'private' | 'public'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS resource_shares (
    id SERIAL PRIMARY KEY,
    resource_type VARCHAR(20) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    shared_with_user_id INTEGER NOT NULL,
    shared_by_user_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(resource_type, resource_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_rs_type_id ON resource_sharing(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_rs_owner ON resource_sharing(owner_id);
CREATE INDEX IF NOT EXISTS idx_rsh_type_id ON resource_shares(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_rsh_user ON resource_shares(shared_with_user_id);
