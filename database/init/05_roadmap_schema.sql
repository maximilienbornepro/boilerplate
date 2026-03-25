-- =============================================================================
-- Module: Roadmap
-- Tables specifiques au module roadmap (planification Gantt)
-- =============================================================================

\c app;

-- Plannings table
CREATE TABLE IF NOT EXISTS roadmap_plannings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table (with hierarchy via parent_id)
CREATE TABLE IF NOT EXISTS roadmap_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planning_id UUID NOT NULL REFERENCES roadmap_plannings(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    color VARCHAR(7) DEFAULT '#00bcd4',
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dependencies table (task-to-task links)
CREATE TABLE IF NOT EXISTS roadmap_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_task_id UUID NOT NULL REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
    to_task_id UUID NOT NULL REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
    type VARCHAR(20) DEFAULT 'finish-to-start',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_task_id, to_task_id)
);

-- Markers table (milestones, deadlines)
CREATE TABLE IF NOT EXISTS roadmap_markers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planning_id UUID NOT NULL REFERENCES roadmap_plannings(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    marker_date DATE NOT NULL,
    color VARCHAR(7) DEFAULT '#f59e0b',
    type VARCHAR(20) DEFAULT 'milestone',
    task_id UUID REFERENCES roadmap_tasks(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_planning ON roadmap_tasks(planning_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_parent ON roadmap_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_deps_from ON roadmap_dependencies(from_task_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_deps_to ON roadmap_dependencies(to_task_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_markers_planning ON roadmap_markers(planning_id);
