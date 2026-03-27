-- Connect to app database
\c app;

-- CVs table with JSONB for flexible data storage
CREATE TABLE IF NOT EXISTS cvs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT 'Mon CV',
    cv_data JSONB NOT NULL DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CV logos cache table
CREATE TABLE IF NOT EXISTS cv_logos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    image_data TEXT NOT NULL,
    mime_type VARCHAR(50) NOT NULL DEFAULT 'image/png',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cvs_user_id ON cvs(user_id);
CREATE INDEX IF NOT EXISTS idx_cvs_user_default ON cvs(user_id, is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_cv_logos_user_id ON cv_logos(user_id);
CREATE INDEX IF NOT EXISTS idx_cv_logos_company ON cv_logos(user_id, company_name);

-- Trigger to ensure only one default CV per user
CREATE OR REPLACE FUNCTION ensure_single_default_cv()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default = true THEN
        UPDATE cvs SET is_default = false
        WHERE user_id = NEW.user_id AND id != NEW.id AND is_default = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ensure_single_default_cv ON cvs;
CREATE TRIGGER trg_ensure_single_default_cv
    BEFORE INSERT OR UPDATE OF is_default ON cvs
    FOR EACH ROW
    WHEN (NEW.is_default = true)
    EXECUTE FUNCTION ensure_single_default_cv();
