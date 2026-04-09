\c app;

-- Junction table: link a roadmap planning to one or more delivery boards.
-- Used to render delivery tasks as a read-only overlay row on the roadmap Gantt.
-- Dates for overlay tasks are derived at query time (pure function, no Jira calls).
CREATE TABLE IF NOT EXISTS roadmap_planning_delivery_boards (
    planning_id UUID NOT NULL REFERENCES roadmap_plannings(id) ON DELETE CASCADE,
    board_id    UUID NOT NULL REFERENCES delivery_boards(id)   ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (planning_id, board_id)
);

CREATE INDEX IF NOT EXISTS idx_rpdb_planning ON roadmap_planning_delivery_boards(planning_id);
CREATE INDEX IF NOT EXISTS idx_rpdb_board    ON roadmap_planning_delivery_boards(board_id);
