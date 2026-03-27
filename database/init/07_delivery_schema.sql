\c app;

-- Local tasks
CREATE TABLE IF NOT EXISTS delivery_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    type VARCHAR(20) DEFAULT 'feature',
    status VARCHAR(20) DEFAULT 'todo',
    story_points DECIMAL(5,1),
    estimated_days DECIMAL(5,1),
    assignee VARCHAR(255),
    priority VARCHAR(20) DEFAULT 'medium',
    increment_id VARCHAR(50),
    sprint_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task positions on the board grid
CREATE TABLE IF NOT EXISTS delivery_positions (
    id SERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES delivery_tasks(id) ON DELETE CASCADE,
    increment_id VARCHAR(50) NOT NULL,
    start_col INTEGER NOT NULL DEFAULT 0,
    end_col INTEGER NOT NULL DEFAULT 1,
    row INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, increment_id)
);

-- Confidence scores per increment
CREATE TABLE IF NOT EXISTS delivery_confidence (
    id SERIAL PRIMARY KEY,
    increment_id VARCHAR(50) NOT NULL,
    score DECIMAL(3,1) DEFAULT 3.0,
    score_overridden BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(increment_id)
);

CREATE TABLE IF NOT EXISTS delivery_confidence_questions (
    id SERIAL PRIMARY KEY,
    increment_id VARCHAR(50) NOT NULL,
    label TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_confidence_improvements (
    id SERIAL PRIMARY KEY,
    increment_id VARCHAR(50) NOT NULL,
    label TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Increment state (freeze, hidden tasks)
CREATE TABLE IF NOT EXISTS delivery_increment_state (
    id SERIAL PRIMARY KEY,
    increment_id VARCHAR(50) NOT NULL UNIQUE,
    is_frozen BOOLEAN DEFAULT FALSE,
    hidden_task_ids UUID[] DEFAULT '{}',
    frozen_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Snapshots
CREATE TABLE IF NOT EXISTS delivery_snapshots (
    id SERIAL PRIMARY KEY,
    increment_id VARCHAR(50) NOT NULL,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delivery_tasks_increment ON delivery_tasks(increment_id);
CREATE INDEX IF NOT EXISTS idx_delivery_positions_increment ON delivery_positions(increment_id);
CREATE INDEX IF NOT EXISTS idx_delivery_snapshots_increment ON delivery_snapshots(increment_id);
