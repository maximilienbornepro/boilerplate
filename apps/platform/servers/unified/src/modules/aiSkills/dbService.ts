// DB layer for the `ai_skills` table. Kept minimal — the registry drives
// which slugs exist, the DB only stores the current content + audit info.

import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export interface SkillRow {
  slug: string;
  name: string;
  description: string;
  content: string;
  is_customized: boolean;
  updated_at: string;
  updated_by_user_id: number | null;
}

export async function initPool(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_skills (
        slug VARCHAR(100) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        is_customized BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by_user_id INTEGER
      );
    `);
  } finally {
    client.release();
  }
}

export async function getSkillBySlug(slug: string): Promise<SkillRow | null> {
  const { rows } = await pool.query<SkillRow>('SELECT * FROM ai_skills WHERE slug = $1', [slug]);
  return rows[0] ?? null;
}

export async function listSkills(): Promise<SkillRow[]> {
  const { rows } = await pool.query<SkillRow>('SELECT * FROM ai_skills ORDER BY slug');
  return rows;
}

/** Insert a row if absent. Returns `true` if inserted, `false` if already there. */
export async function seedSkill(
  slug: string,
  name: string,
  description: string,
  content: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO ai_skills (slug, name, description, content, is_customized)
     VALUES ($1, $2, $3, $4, FALSE)
     ON CONFLICT (slug) DO NOTHING`,
    [slug, name, description, content],
  );
  return rowCount === 1;
}

/** Update metadata (name/description) on every boot — keeps labels in sync
 * with the registry even when content is already customized. */
export async function upsertSkillMetadata(
  slug: string,
  name: string,
  description: string,
): Promise<void> {
  await pool.query(
    `UPDATE ai_skills SET name = $2, description = $3 WHERE slug = $1 AND (name <> $2 OR description <> $3)`,
    [slug, name, description],
  );
}

export async function updateSkillContent(
  slug: string,
  content: string,
  userId: number | null,
): Promise<SkillRow | null> {
  const { rows } = await pool.query<SkillRow>(
    `UPDATE ai_skills
        SET content = $2,
            is_customized = TRUE,
            updated_at = NOW(),
            updated_by_user_id = $3
      WHERE slug = $1
      RETURNING *`,
    [slug, content, userId],
  );
  return rows[0] ?? null;
}

/** Replace content with the shipped default and mark as no longer customized. */
export async function resetSkillToDefault(
  slug: string,
  defaultContent: string,
  userId: number | null,
): Promise<SkillRow | null> {
  const { rows } = await pool.query<SkillRow>(
    `UPDATE ai_skills
        SET content = $2,
            is_customized = FALSE,
            updated_at = NOW(),
            updated_by_user_id = $3
      WHERE slug = $1
      RETURNING *`,
    [slug, defaultContent, userId],
  );
  return rows[0] ?? null;
}
