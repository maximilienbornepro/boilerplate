\c app;

-- Delivery boards (multi-board support)
-- Each board has a type (agile or calendaire) that determines its sprint
-- structure and grid layout. Agile boards have 2-8 weeks of 2-week sprints;
-- calendaire boards cover a single month divided into 4 fixed weeks.
CREATE TABLE IF NOT EXISTS delivery_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    board_type VARCHAR(20) NOT NULL DEFAULT 'agile',
    start_date DATE,
    end_date DATE,
    duration_weeks INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delivery_boards_user ON delivery_boards(user_id);
