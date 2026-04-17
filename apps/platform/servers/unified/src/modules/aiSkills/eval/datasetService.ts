// CRUD for ai_eval_datasets + ai_eval_dataset_items. Datasets are scoped to a
// single skill slug ; items can either be copied from an existing ai_analysis_logs
// row or typed in ad-hoc. `expected_output` is the admin-annotated ground
// truth (nullable — not every dataset needs expected outputs).

import { Pool } from 'pg';
import { config } from '../../../config.js';

let pool: Pool;

export interface DatasetRow {
  id: number;
  name: string;
  skill_slug: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
  item_count?: number;
}

export interface DatasetItemRow {
  id: number;
  dataset_id: number;
  source_log_id: number | null;
  input_content: string;
  expected_output: unknown;
  expected_notes: string | null;
  position: number;
  created_at: string;
}

export async function initEvalPool(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_eval_datasets (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(200) NOT NULL,
        skill_slug   VARCHAR(100) NOT NULL,
        description  TEXT,
        created_by   INTEGER,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ai_eval_dataset_items (
        id               SERIAL PRIMARY KEY,
        dataset_id       INTEGER NOT NULL REFERENCES ai_eval_datasets(id) ON DELETE CASCADE,
        source_log_id    INTEGER,
        input_content    TEXT NOT NULL,
        expected_output  JSONB,
        expected_notes   TEXT,
        position         INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_eval_items_dataset ON ai_eval_dataset_items(dataset_id, position);
      CREATE TABLE IF NOT EXISTS ai_eval_experiments (
        id                  SERIAL PRIMARY KEY,
        dataset_id          INTEGER NOT NULL REFERENCES ai_eval_datasets(id) ON DELETE CASCADE,
        name                VARCHAR(200) NOT NULL,
        skill_version_hash  CHAR(64) NOT NULL,
        model               VARCHAR(100),
        status              VARCHAR(20) NOT NULL DEFAULT 'pending',
        started_at          TIMESTAMPTZ,
        finished_at         TIMESTAMPTZ,
        error               TEXT,
        created_by          INTEGER,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_eval_experiments_dataset ON ai_eval_experiments(dataset_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ai_eval_experiment_runs (
        id            SERIAL PRIMARY KEY,
        experiment_id INTEGER NOT NULL REFERENCES ai_eval_experiments(id) ON DELETE CASCADE,
        item_id       INTEGER NOT NULL REFERENCES ai_eval_dataset_items(id) ON DELETE CASCADE,
        log_id        INTEGER NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_eval_runs_exp ON ai_eval_experiment_runs(experiment_id);
    `);
  } finally {
    client.release();
  }
}

export function getEvalPool(): Pool { return pool; }

// ── Datasets CRUD ──

export async function createDataset(
  name: string,
  skillSlug: string,
  description: string | null,
  userId: number | null,
): Promise<DatasetRow> {
  const { rows } = await pool.query<DatasetRow>(
    `INSERT INTO ai_eval_datasets (name, skill_slug, description, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name.slice(0, 200), skillSlug, description, userId],
  );
  return rows[0];
}

export async function listDatasets(skillSlug?: string): Promise<DatasetRow[]> {
  const filter = skillSlug ? 'WHERE d.skill_slug = $1' : '';
  const values = skillSlug ? [skillSlug] : [];
  const { rows } = await pool.query<DatasetRow>(
    `SELECT d.*, COUNT(i.id)::int AS item_count
       FROM ai_eval_datasets d
       LEFT JOIN ai_eval_dataset_items i ON i.dataset_id = d.id
       ${filter}
      GROUP BY d.id
      ORDER BY d.created_at DESC`,
    values,
  );
  return rows;
}

export async function getDataset(id: number): Promise<DatasetRow | null> {
  const { rows } = await pool.query<DatasetRow>(
    `SELECT * FROM ai_eval_datasets WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteDataset(id: number): Promise<void> {
  await pool.query(`DELETE FROM ai_eval_datasets WHERE id = $1`, [id]);
}

// ── Items CRUD ──

export async function listItems(datasetId: number): Promise<DatasetItemRow[]> {
  const { rows } = await pool.query<DatasetItemRow>(
    `SELECT * FROM ai_eval_dataset_items
      WHERE dataset_id = $1
      ORDER BY position ASC, id ASC`,
    [datasetId],
  );
  return rows;
}

export async function addItemFromLog(
  datasetId: number,
  logId: number,
  expectedOutput: unknown,
  notes: string | null,
): Promise<DatasetItemRow | null> {
  const { rows: logRows } = await pool.query<{ input_content: string }>(
    `SELECT input_content FROM ai_analysis_logs WHERE id = $1`, [logId],
  );
  const log = logRows[0];
  if (!log) return null;

  const { rows: posRows } = await pool.query<{ max: number | null }>(
    `SELECT COALESCE(MAX(position), -1) AS max FROM ai_eval_dataset_items WHERE dataset_id = $1`,
    [datasetId],
  );
  const nextPos = (posRows[0]?.max ?? -1) + 1;

  const { rows } = await pool.query<DatasetItemRow>(
    `INSERT INTO ai_eval_dataset_items
       (dataset_id, source_log_id, input_content, expected_output, expected_notes, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [datasetId, logId, log.input_content, JSON.stringify(expectedOutput ?? null), notes, nextPos],
  );
  return rows[0];
}

export async function addItemAdHoc(
  datasetId: number,
  inputContent: string,
  expectedOutput: unknown,
  notes: string | null,
): Promise<DatasetItemRow> {
  const { rows: posRows } = await pool.query<{ max: number | null }>(
    `SELECT COALESCE(MAX(position), -1) AS max FROM ai_eval_dataset_items WHERE dataset_id = $1`,
    [datasetId],
  );
  const nextPos = (posRows[0]?.max ?? -1) + 1;

  const { rows } = await pool.query<DatasetItemRow>(
    `INSERT INTO ai_eval_dataset_items
       (dataset_id, source_log_id, input_content, expected_output, expected_notes, position)
     VALUES ($1, NULL, $2, $3, $4, $5)
     RETURNING *`,
    [datasetId, inputContent, JSON.stringify(expectedOutput ?? null), notes, nextPos],
  );
  return rows[0];
}

export async function updateItem(
  itemId: number,
  updates: { expected_output?: unknown; expected_notes?: string | null; input_content?: string },
): Promise<DatasetItemRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.input_content !== undefined) {
    values.push(updates.input_content);
    sets.push(`input_content = $${values.length}`);
  }
  if (updates.expected_output !== undefined) {
    values.push(JSON.stringify(updates.expected_output));
    sets.push(`expected_output = $${values.length}`);
  }
  if (updates.expected_notes !== undefined) {
    values.push(updates.expected_notes);
    sets.push(`expected_notes = $${values.length}`);
  }
  if (sets.length === 0) return null;
  values.push(itemId);
  const { rows } = await pool.query<DatasetItemRow>(
    `UPDATE ai_eval_dataset_items SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function removeItem(itemId: number): Promise<void> {
  await pool.query(`DELETE FROM ai_eval_dataset_items WHERE id = $1`, [itemId]);
}
