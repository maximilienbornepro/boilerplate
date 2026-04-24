\c app;

-- Gateway audit log: one row per security-relevant action (delete,
-- share, permission change, skill reset, admin action, ...).
-- Writes are fire-and-forget from the `audit()` helper in the
-- application-side gateway — never blocks the user-facing response.

CREATE TABLE IF NOT EXISTS gateway_audit_log (
    id            SERIAL PRIMARY KEY,
    request_id    VARCHAR(128),
    user_id       INTEGER,
    action        VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id   VARCHAR(200),
    ip            VARCHAR(64),
    user_agent    TEXT,
    extra         JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gal_created_at ON gateway_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gal_user_id    ON gateway_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_gal_action     ON gateway_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_gal_resource   ON gateway_audit_log(resource_type, resource_id);
