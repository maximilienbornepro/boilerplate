#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# sync-prod-data.sh — Import production data into local boilerplate DB
# ═══════════════════════════════════════════════════════════════════════
#
# Usage:
#   ./scripts/sync-prod-data.sh              # Import seed data from database/seed/
#   ./scripts/sync-prod-data.sh --from-prod  # Dump fresh data from francetv.vitess.tech + import
#
# Prerequisites:
#   - Local boilerplate running (docker compose up)
#   - For --from-prod: SSH access to studio.vitess.tech
#
# Source: francetv.vitess.tech (delivery-process server)
#   - DB suivitess → suivitess_documents/sections/subjects/snapshots
#   - DB roadmap   → roadmap_plannings/tasks/dependencies/markers
#   - DB delivery  → converted from (project_id, pi_id) to individual agile boards
#
# ═══════════════════════════════════════════════════════════════════════

set -e

LOCAL_DB="boilerplate-db"
LOCAL_USER="postgres"
LOCAL_DBNAME="app"
SEED_DIR="$(dirname "$0")/../database/seed"
REMOTE="root@studio.vitess.tech"
REMOTE_CONTAINER="delivery-postgres"
REMOTE_USER="postgres"

FROM_PROD=false
if [ "$1" = "--from-prod" ]; then
  FROM_PROD=true
fi

echo "═══════════════════════════════════════════════"
echo "  Sync production data → local boilerplate"
if [ "$FROM_PROD" = true ]; then
  echo "  Mode: FRESH DUMP from francetv.vitess.tech"
else
  echo "  Mode: SEED from database/seed/"
fi
echo "═══════════════════════════════════════════════"

# ─── Optionally dump fresh data from prod ────────────
if [ "$FROM_PROD" = true ]; then
  echo ""
  echo "▸ Dumping fresh data from production..."

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d suivitess -c \"
    COPY (SELECT id, title, created_at, updated_at FROM documents) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/suivitess_documents.csv"

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d suivitess -c \"
    COPY (SELECT id, document_id, name, position, created_at, updated_at FROM sections ORDER BY document_id, position) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/suivitess_sections.csv"

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d suivitess -c \"
    COPY (SELECT id, section_id, title, situation, status, responsibility, position, created_at, updated_at FROM subjects ORDER BY section_id, position) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/suivitess_subjects.csv"

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d suivitess -c \"
    COPY (SELECT id, document_id, created_at, type, snapshot_data FROM document_snapshots ORDER BY id) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/suivitess_snapshots.csv"

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d roadmap -c \"
    COPY (SELECT id, name, description, start_date, end_date, created_at, updated_at FROM roadmap_plannings ORDER BY start_date) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/roadmap_plannings.csv"

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d roadmap -c \"
    COPY (SELECT id, planning_id, parent_id, name, description, start_date, end_date, color, progress, sort_order, created_at, updated_at FROM roadmap_tasks ORDER BY planning_id, sort_order) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/roadmap_tasks.csv"

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d roadmap -c \"
    COPY (SELECT id, from_task_id, to_task_id, type, created_at FROM roadmap_dependencies) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/roadmap_deps.csv"

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d roadmap -c \"
    COPY (SELECT id, planning_id, name, marker_date, color, created_at, updated_at, task_id FROM roadmap_markers) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/roadmap_markers.csv"

  ssh $REMOTE "docker exec $REMOTE_CONTAINER psql -U $REMOTE_USER -d delivery -c \"
    COPY (SELECT task_id, project_id, pi_id, start_col, end_col, row_index FROM task_positions ORDER BY project_id, pi_id, row_index) TO STDOUT WITH CSV HEADER
  \"" > "$SEED_DIR/delivery_positions.csv"

  echo "  Regenerating delivery_import.sql..."
  python3 << 'PYEOF'
import csv, uuid
positions = []
with open('database/seed/delivery_positions.csv') as f:
    for row in csv.DictReader(f):
        positions.append(row)
groups = {}
for pos in positions:
    key = (pos['project_id'], pos['pi_id'])
    groups.setdefault(key, []).append(pos)
pi_dates = {
    'pi1': ('2026-01-19', '2026-03-01'), 'pi2': ('2026-03-02', '2026-04-12'),
    'pi3': ('2026-04-13', '2026-05-24'), 'pi4': ('2026-05-25', '2026-07-05'),
    'pi5': ('2026-07-06', '2026-08-16'), 'pi6': ('2026-08-17', '2026-09-27'),
    'pi7': ('2026-09-28', '2026-11-08'), 'pi8': ('2026-11-09', '2026-12-20'),
}
lines = []
for (proj, pi), gp in sorted(groups.items()):
    bid = str(uuid.uuid4())
    sd, ed = pi_dates.get(pi, ('2026-01-19', '2026-03-01'))
    lines.append(f"INSERT INTO delivery_boards (id, user_id, name, board_type, start_date, end_date, duration_weeks) VALUES ('{bid}', 1, '{proj} - {pi.upper()}', 'agile', '{sd}', '{ed}', 6);")
    sid = f"{bid}_s1"
    for p in gp:
        tid = str(uuid.uuid4())
        jk = p['task_id'].replace("'", "''")
        lines.append(f"INSERT INTO delivery_tasks (id, title, type, status, increment_id, source) VALUES ('{tid}', '[{jk}]', 'feature', 'todo', '{sid}', 'jira');")
        lines.append(f"INSERT INTO delivery_positions (task_id, increment_id, start_col, end_col, row, row_span) VALUES ('{tid}', '{sid}', {p['start_col']}, {p['end_col']}, {p['row_index']}, 1);")
with open('database/seed/delivery_import.sql', 'w') as f:
    f.write('\n'.join(lines))
print(f"  Generated {len(groups)} boards, {len(positions)} tasks")
PYEOF

  echo "  ✓ Fresh dump complete"
fi

# ─── 1. SUIVITESS ────────────────────────────────────
echo ""
echo "▸ [1/3] Importing Suivitess..."

docker exec $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "
  DELETE FROM suivitess_snapshots;
  DELETE FROM suivitess_subjects;
  DELETE FROM suivitess_sections;
  DELETE FROM suivitess_documents;
" > /dev/null

cat "$SEED_DIR/suivitess_documents.csv" | docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "\COPY suivitess_documents(id, title, created_at, updated_at) FROM STDIN WITH CSV HEADER"
cat "$SEED_DIR/suivitess_sections.csv" | docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "\COPY suivitess_sections(id, document_id, name, position, created_at, updated_at) FROM STDIN WITH CSV HEADER"
cat "$SEED_DIR/suivitess_subjects.csv" | docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "\COPY suivitess_subjects(id, section_id, title, situation, status, responsibility, position, created_at, updated_at) FROM STDIN WITH CSV HEADER"
cat "$SEED_DIR/suivitess_snapshots.csv" | docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "\COPY suivitess_snapshots(id, document_id, created_at, type, snapshot_data) FROM STDIN WITH CSV HEADER"
echo "  ✓ Suivitess done"

# ─── 2. ROADMAP ──────────────────────────────────────
echo ""
echo "▸ [2/3] Importing Roadmap..."

docker exec $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "
  DELETE FROM roadmap_task_subjects;
  DELETE FROM roadmap_planning_delivery_boards;
  DELETE FROM roadmap_dependencies;
  DELETE FROM roadmap_markers;
  DELETE FROM roadmap_tasks;
  DELETE FROM roadmap_plannings;
" > /dev/null

cat "$SEED_DIR/roadmap_plannings.csv" | docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "\COPY roadmap_plannings(id, name, description, start_date, end_date, created_at, updated_at) FROM STDIN WITH CSV HEADER"
cat "$SEED_DIR/roadmap_tasks.csv" | docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "\COPY roadmap_tasks(id, planning_id, parent_id, name, description, start_date, end_date, color, progress, sort_order, created_at, updated_at) FROM STDIN WITH CSV HEADER"
cat "$SEED_DIR/roadmap_deps.csv" | docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "\COPY roadmap_dependencies(id, from_task_id, to_task_id, type, created_at) FROM STDIN WITH CSV HEADER"
cat "$SEED_DIR/roadmap_markers.csv" | docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "\COPY roadmap_markers(id, planning_id, name, marker_date, color, created_at, updated_at, task_id) FROM STDIN WITH CSV HEADER"
echo "  ✓ Roadmap done"

# ─── 3. DELIVERY ─────────────────────────────────────
echo ""
echo "▸ [3/3] Importing Delivery..."

docker exec $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "
  DELETE FROM delivery_positions;
  DELETE FROM delivery_tasks;
  DELETE FROM delivery_increment_state;
  DELETE FROM delivery_snapshots;
  DELETE FROM delivery_boards;
" > /dev/null

docker exec -i $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME < "$SEED_DIR/delivery_import.sql" > /dev/null
echo "  ✓ Delivery done"

# ─── VERIFY ──────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  Verification"
echo "═══════════════════════════════════════════════"

docker exec $LOCAL_DB psql -U $LOCAL_USER -d $LOCAL_DBNAME -c "
  SELECT 'suivitess_documents' as table_name, count(*) FROM suivitess_documents
  UNION ALL SELECT 'suivitess_sections', count(*) FROM suivitess_sections
  UNION ALL SELECT 'suivitess_subjects', count(*) FROM suivitess_subjects
  UNION ALL SELECT 'roadmap_plannings', count(*) FROM roadmap_plannings
  UNION ALL SELECT 'roadmap_tasks', count(*) FROM roadmap_tasks
  UNION ALL SELECT 'delivery_boards', count(*) FROM delivery_boards
  UNION ALL SELECT 'delivery_tasks', count(*) FROM delivery_tasks
  ORDER BY 1
"

echo ""
echo "✅ Import complete!"
