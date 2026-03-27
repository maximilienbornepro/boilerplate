\c app;

-- Jira OAuth tokens per user
CREATE TABLE IF NOT EXISTS jira_tokens (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    cloud_id TEXT NOT NULL,
    site_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add jira_linked column to users (if not exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS jira_linked BOOLEAN NOT NULL DEFAULT FALSE;
