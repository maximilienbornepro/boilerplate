-- =============================================================================
-- Module: Conges
-- Tables specifiques au module conges (gestion des conges/absences)
-- =============================================================================

\c app;

-- User preferences for calendar display
CREATE TABLE IF NOT EXISTS conges_user_preferences (
    user_id INTEGER NOT NULL PRIMARY KEY,
    color VARCHAR(7) DEFAULT '#00bcd4',
    sort_order INTEGER DEFAULT 0
);

-- Leave records
CREATE TABLE IF NOT EXISTS conges_leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_period VARCHAR(10) DEFAULT 'full' CHECK (start_period IN ('full', 'morning', 'afternoon')),
    end_period VARCHAR(10) DEFAULT 'full' CHECK (end_period IN ('full', 'morning', 'afternoon')),
    reason TEXT,
    status VARCHAR(20) DEFAULT 'approved',
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_dates CHECK (start_date <= end_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conges_leaves_dates ON conges_leaves(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_conges_leaves_member ON conges_leaves(member_id);
