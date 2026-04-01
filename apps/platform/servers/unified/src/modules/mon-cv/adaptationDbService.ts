import { Pool } from 'pg';
import { config } from '../../config.js';
import type { CVData } from './types.js';
import type { AtsScore, JobAnalysis } from './adaptService.js';
import { scoreCV } from './adaptService.js';

let pool: Pool;

export interface CVAdaptation {
  id: number;
  cvId: number;
  userId: number;
  jobOffer: string;
  adaptedCv: CVData;
  changes: {
    newMissions: string[];
    newProject?: { title: string; description?: string };
    addedSkills: Record<string, string[]>;
    termReplacements?: Array<{ section: string; cvTerm: string; offerTerm: string; originalText: string; replacedText: string }>;
  };
  atsBefore: AtsScore;
  atsAfter: AtsScore;
  jobAnalysis: JobAnalysis;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CVAdaptationListItem {
  id: number;
  cvId: number;
  name: string | null;
  jobOfferPreview: string;   // first 120 chars
  atsAfterOverall: number;
  missionsAdded: number;
  createdAt: string;
}

export async function initAdaptationPool() {
  if (pool) return;
  pool = new Pool({ connectionString: config.appDatabaseUrl });
  await ensureTable();
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cv_adaptations (
      id            SERIAL PRIMARY KEY,
      cv_id         INTEGER NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_offer     TEXT NOT NULL,
      adapted_cv    JSONB NOT NULL,
      changes       JSONB NOT NULL,
      ats_before    JSONB NOT NULL,
      ats_after     JSONB NOT NULL,
      job_analysis  JSONB NOT NULL,
      name          VARCHAR(255),
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cv_adaptations_cv_id ON cv_adaptations(cv_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cv_adaptations_user_id ON cv_adaptations(user_id)
  `);
}

function mapRow(row: any): CVAdaptation {
  return {
    id: row.id,
    cvId: row.cv_id,
    userId: row.user_id,
    jobOffer: row.job_offer,
    adaptedCv: row.adapted_cv,
    changes: row.changes,
    atsBefore: row.ats_before,
    atsAfter: row.ats_after,
    jobAnalysis: row.job_analysis,
    name: row.name ?? null,
    createdAt: row.created_at?.toISOString() || new Date().toISOString(),
    updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
  };
}

function mapListRow(row: any): CVAdaptationListItem {
  return {
    id: row.id,
    cvId: row.cv_id,
    name: row.name ?? null,
    jobOfferPreview: (row.job_offer as string).slice(0, 120),
    atsAfterOverall: (row.ats_after as AtsScore).overall,
    missionsAdded: ((row.changes as any)?.newMissions ?? []).length,
    createdAt: row.created_at?.toISOString() || new Date().toISOString(),
  };
}

export async function createAdaptation(
  cvId: number,
  userId: number,
  payload: {
    jobOffer: string;
    adaptedCv: CVData;
    changes: CVAdaptation['changes'];
    atsBefore: AtsScore;
    atsAfter: AtsScore;
    jobAnalysis: JobAnalysis;
    name?: string;
  }
): Promise<CVAdaptation> {
  const result = await pool.query(
    `INSERT INTO cv_adaptations
       (cv_id, user_id, job_offer, adapted_cv, changes, ats_before, ats_after, job_analysis, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      cvId,
      userId,
      payload.jobOffer,
      JSON.stringify(payload.adaptedCv),
      JSON.stringify(payload.changes),
      JSON.stringify(payload.atsBefore),
      JSON.stringify(payload.atsAfter),
      JSON.stringify(payload.jobAnalysis),
      payload.name ?? null,
    ]
  );
  return mapRow(result.rows[0]);
}

export async function getAdaptationsByCV(
  cvId: number,
  userId: number
): Promise<CVAdaptationListItem[]> {
  const result = await pool.query(
    `SELECT id, cv_id, name, job_offer, ats_after, changes, created_at
     FROM cv_adaptations
     WHERE cv_id = $1 AND user_id = $2
     ORDER BY created_at DESC`,
    [cvId, userId]
  );
  return result.rows.map(mapListRow);
}

export async function getAdaptation(
  id: number,
  userId: number
): Promise<CVAdaptation | null> {
  const result = await pool.query(
    `SELECT * FROM cv_adaptations WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function updateAdaptation(
  id: number,
  userId: number,
  updates: { adaptedCv?: CVData; name?: string; changes?: CVAdaptation['changes'] }
): Promise<CVAdaptation | null> {
  // Fetch current record to get jobAnalysis for rescoring
  const existing = await getAdaptation(id, userId);
  if (!existing) return null;

  const newAdaptedCv = updates.adaptedCv ?? existing.adaptedCv;
  const newName = updates.name !== undefined ? updates.name : existing.name;
  const newChanges = updates.changes !== undefined ? updates.changes : existing.changes;

  // Recalculate ats_after based on new adapted_cv
  const newAtsAfter = scoreCV(newAdaptedCv, existing.jobAnalysis);

  const result = await pool.query(
    `UPDATE cv_adaptations
     SET adapted_cv = $1, ats_after = $2, name = $3, changes = $4, updated_at = NOW()
     WHERE id = $5 AND user_id = $6
     RETURNING *`,
    [
      JSON.stringify(newAdaptedCv),
      JSON.stringify(newAtsAfter),
      newName,
      JSON.stringify(newChanges),
      id,
      userId,
    ]
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function deleteAdaptation(
  id: number,
  userId: number
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM cv_adaptations WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function countAdaptationsByCV(
  cvId: number,
  userId: number
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) FROM cv_adaptations WHERE cv_id = $1 AND user_id = $2`,
    [cvId, userId]
  );
  return parseInt(result.rows[0].count, 10);
}
