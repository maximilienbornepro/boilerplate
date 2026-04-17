// Versioned history of skill content. Each edit (admin save or reset to
// default) produces a new row in ai_skill_versions, uniquely identified by
// (slug, sha256(content)). Every ai_analysis_logs row is tagged with this
// hash so we know exactly which prompt the AI saw.

import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { config } from '../../config.js';

let pool: Pool;

export interface SkillVersionRow {
  id: number;
  skill_slug: string;
  content_hash: string;
  content: string;
  created_at: string;
  created_by_user_id: number | null;
}

export async function initVersionsPool(): Promise<void> {
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  // Table is created via migration 22 ; we also run it here defensively so
  // the module still works on databases that haven't been through `init/`.
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_skill_versions (
        id                 SERIAL PRIMARY KEY,
        skill_slug         VARCHAR(100) NOT NULL,
        content_hash       CHAR(64) NOT NULL,
        content            TEXT NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by_user_id INTEGER,
        UNIQUE(skill_slug, content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_skill_versions_slug_created
        ON ai_skill_versions(skill_slug, created_at DESC);
    `);
  } finally {
    client.release();
  }
}

/** Deterministic SHA-256 of a skill content string. Hex, 64 chars. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Shortened form for display — first 7 chars, git-like. */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/** Upsert-idempotent : returns the existing row if (slug, hash) is known,
 *  otherwise inserts a new one. Safe to call on every save/replay. */
export async function ensureSkillVersion(
  slug: string,
  content: string,
  userId: number | null = null,
): Promise<{ hash: string; versionId: number }> {
  const hash = hashContent(content);
  try {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO ai_skill_versions (skill_slug, content_hash, content, created_by_user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (skill_slug, content_hash) DO UPDATE SET skill_slug = EXCLUDED.skill_slug
       RETURNING id`,
      [slug, hash, content, userId],
    );
    return { hash, versionId: rows[0].id };
  } catch (err) {
    // Best-effort : if versioning fails we still return the hash so the
    // caller can log it ; the lack of the row is not fatal.
    console.error('[AiSkills] ensureSkillVersion failed:', err);
    return { hash, versionId: -1 };
  }
}

export async function listVersions(slug: string): Promise<SkillVersionRow[]> {
  const { rows } = await pool.query<SkillVersionRow>(
    `SELECT id, skill_slug, content_hash, content, created_at, created_by_user_id
       FROM ai_skill_versions
      WHERE skill_slug = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [slug],
  );
  return rows;
}

export async function getVersionByHash(
  slug: string,
  hash: string,
): Promise<SkillVersionRow | null> {
  const { rows } = await pool.query<SkillVersionRow>(
    `SELECT id, skill_slug, content_hash, content, created_at, created_by_user_id
       FROM ai_skill_versions
      WHERE skill_slug = $1 AND content_hash = $2`,
    [slug, hash],
  );
  return rows[0] ?? null;
}
