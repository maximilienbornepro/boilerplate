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
  /** Lifecycle : `draft` while the modal is still being walked,
   *  `completed` once the user hits "done". The AdaptCVPage uses
   *  this to surface drafts as resumable. */
  status: 'draft' | 'completed';
  /** User-defined Q&A pairs grounded in the adapted CV + the
   *  offer. The frontend pre-fills a single suggestion ("Pourquoi
   *  êtes-vous la bonne personne pour cette mission ?") but the
   *  user can add / rename / delete any question. The AI answer is
   *  generated on demand and editable. */
  questions: AdaptationQuestion[];
  createdAt: string;
  updatedAt: string;
}

/** A Q&A entry on an adaptation. `answer` is empty until the user
 *  triggers AI generation ; `aiLogId` lets the /ai-logs page link
 *  back to the run. The `id` is generated client-side (uuid) so the
 *  frontend can address each entry without a server round-trip. */
export interface AdaptationQuestion {
  id: string;
  question: string;
  answer: string;
  generatedAt?: string;
  aiLogId?: number | null;
}

export interface CVAdaptationListItem {
  id: number;
  cvId: number;
  name: string | null;
  jobOfferPreview: string;   // first 120 chars
  atsAfterOverall: number;
  missionsAdded: number;
  status: 'draft' | 'completed';
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
  // Lifecycle status — `draft` while the user is still walking the
  // tile-by-tile modal, `completed` once they hit "done" (PDF /
  // editor). Lets the AdaptCVPage surface drafts with a "Reprendre"
  // CTA so an accidental modal close doesn't lose the work.
  // Existing rows are stamped `completed` since they predate this.
  await pool.query(
    "ALTER TABLE cv_adaptations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'"
  );
  await pool.query(
    "UPDATE cv_adaptations SET status = 'completed' WHERE status IS NULL OR status = 'draft' AND created_at < (NOW() - INTERVAL '6 hours')"
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_cv_adaptations_status ON cv_adaptations(cv_id, status)'
  );
  // Q&A custom questions per adaptation — the user can add any
  // question (e.g. "Pourquoi êtes-vous la bonne personne pour
  // cette mission ?", "Quel est votre style de management ?") and
  // have the AI answer it grounded in the adapted CV + the offer.
  // Stored as a JSONB array of { id, question, answer, generatedAt,
  // aiLogId }. Default is an empty array — the frontend pre-fills
  // a single suggested question on first render.
  await pool.query(
    "ALTER TABLE cv_adaptations ADD COLUMN IF NOT EXISTS questions JSONB NOT NULL DEFAULT '[]'::jsonb"
  );

  // Tile-by-tile adaptation table — see migration 28. One row per
  // atomic CV element that the AI proposes to adjust to a specific
  // job offer. Cascade-deleted with the parent adaptation.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cv_adaptation_tiles (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      adaptation_id     INTEGER NOT NULL REFERENCES cv_adaptations(id) ON DELETE CASCADE,
      tile_id           TEXT NOT NULL,
      path              TEXT NOT NULL,
      kind              TEXT NOT NULL,
      original_text     TEXT NOT NULL,
      proposed_text     TEXT NOT NULL,
      user_edited_text  TEXT,
      status            TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'skipped', 'edited')),
      regenerate_count  INTEGER NOT NULL DEFAULT 0,
      ai_log_id         INTEGER REFERENCES ai_analysis_logs(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(adaptation_id, tile_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cv_tiles_adaptation ON cv_adaptation_tiles(adaptation_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_cv_tiles_status ON cv_adaptation_tiles(adaptation_id, status)');
  // Skill B is run on a user-selected subset (after skill A
  // extracts every atomic). Tiles are persisted by skill A with
  // proposal_ready=false (proposed_text = the original) ; skill B
  // flips this to true once it has produced a proper adaptation,
  // and writes the human-readable reasoning that drove the change.
  await pool.query('ALTER TABLE cv_adaptation_tiles ADD COLUMN IF NOT EXISTS proposal_ready BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE cv_adaptation_tiles ADD COLUMN IF NOT EXISTS reasoning TEXT');
  // Human-readable label like "Mission #1 — Tink / Cossette" so the
  // routing UI can show the user exactly what they're modifying
  // without making them parse the cryptic JSONPath.
  await pool.query('ALTER TABLE cv_adaptation_tiles ADD COLUMN IF NOT EXISTS label TEXT');
  // Display order. A bulk INSERT gives every row the same NOW()
  // timestamp at microsecond resolution → ORDER BY created_at is
  // non-deterministic and the user saw experience #3 before #5 in
  // the modal. `position` is the array index assigned at insert
  // time ; the routing UI sorts on it. Backfill existing rows on
  // first boot so legacy adaptations also display in order.
  await pool.query('ALTER TABLE cv_adaptation_tiles ADD COLUMN IF NOT EXISTS position INTEGER');
  await pool.query(`
    UPDATE cv_adaptation_tiles t
       SET position = sub.rn - 1
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY adaptation_id ORDER BY created_at, tile_id) AS rn
          FROM cv_adaptation_tiles
      ) sub
     WHERE t.id = sub.id AND t.position IS NULL
  `);
}

// ============================================================
// Tile CRUD — used by tileAdaptationService.ts
// ============================================================

export interface CVAdaptationTile {
  id: string;
  adaptationId: number;
  tileId: string;
  path: string;
  kind: string;
  originalText: string;
  proposedText: string;
  userEditedText: string | null;
  status: 'pending' | 'accepted' | 'skipped' | 'edited';
  regenerateCount: number;
  aiLogId: number | null;
  /** False between skill A creating the row (proposed_text = original_text)
   *  and skill B writing the actual AI proposal. The frontend polls until
   *  every tile is ready. */
  proposalReady: boolean;
  /** Short human-readable explanation of why skill B made the change.
   *  Surfaced in the routing UI so the user understands the AI's
   *  rationale before accepting / rejecting. Null until skill B runs. */
  reasoning: string | null;
  /** Human-readable display label such as "France.TV — Mission #1" so
   *  the routing UI doesn't have to surface the cryptic JSONPath.
   *  Always populated for new tiles ; legacy rows may be null. */
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapTileRow(row: any): CVAdaptationTile {
  return {
    id: row.id,
    adaptationId: row.adaptation_id,
    tileId: row.tile_id,
    path: row.path,
    kind: row.kind,
    originalText: row.original_text,
    proposedText: row.proposed_text,
    userEditedText: row.user_edited_text ?? null,
    status: row.status,
    regenerateCount: row.regenerate_count ?? 0,
    aiLogId: row.ai_log_id ?? null,
    proposalReady: row.proposal_ready ?? false,
    reasoning: row.reasoning ?? null,
    label: row.label ?? null,
    createdAt: row.created_at?.toISOString() || new Date().toISOString(),
    updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
  };
}

/** Bulk-insert all tiles for a fresh adaptation. ON CONFLICT keeps
 *  existing rows untouched — re-running skill A doesn't wipe what
 *  the user already edited. */
export async function insertTilesForAdaptation(
  adaptationId: number,
  tiles: Array<
    Pick<CVAdaptationTile, 'tileId' | 'path' | 'kind' | 'originalText' | 'proposedText' | 'label'>
    & Partial<Pick<CVAdaptationTile, 'proposalReady' | 'reasoning'>>
  >,
): Promise<CVAdaptationTile[]> {
  if (tiles.length === 0) return [];
  // Find the current MAX(position) for this adaptation so a 2nd
  // insertion (e.g. aggressive-mode additions persisted after the
  // initial bulk) appends ordered rows AFTER the existing ones
  // instead of clashing on position 0.
  const offsetRes = await pool.query(
    'SELECT COALESCE(MAX(position), -1) AS max_pos FROM cv_adaptation_tiles WHERE adaptation_id = $1',
    [adaptationId],
  );
  const positionOffset = (offsetRes.rows[0]?.max_pos ?? -1) + 1;

  const values: string[] = [];
  const params: any[] = [];
  let i = 1;
  tiles.forEach((t, idx) => {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(
      adaptationId,
      t.tileId,
      t.path,
      t.kind,
      t.originalText,
      t.proposedText,
      t.label ?? null,
      t.proposalReady ?? false,
      t.reasoning ?? null,
      positionOffset + idx,
    );
  });
  const result = await pool.query(
    `INSERT INTO cv_adaptation_tiles
       (adaptation_id, tile_id, path, kind, original_text, proposed_text, label, proposal_ready, reasoning, position)
     VALUES ${values.join(', ')}
     ON CONFLICT (adaptation_id, tile_id) DO NOTHING
     RETURNING *`,
    params,
  );
  return result.rows.map(mapTileRow);
}

export async function getTilesByAdaptation(
  adaptationId: number,
  userId: number,
): Promise<CVAdaptationTile[]> {
  // Join via adaptation to enforce ownership. Sort on `position`
  // (assigned at insert time = array index) so the modal walks
  // the tiles in the same order as the underlying CV. Bulk
  // inserts share a created_at to the microsecond → can't rely on
  // it here. Fall back to created_at + tile_id for legacy rows
  // that haven't been backfilled yet (NULLS LAST keeps them after
  // the well-ordered ones).
  const result = await pool.query(
    `SELECT t.* FROM cv_adaptation_tiles t
     JOIN cv_adaptations a ON a.id = t.adaptation_id
     WHERE t.adaptation_id = $1 AND a.user_id = $2
     ORDER BY t.position NULLS LAST, t.created_at, t.tile_id`,
    [adaptationId, userId],
  );
  return result.rows.map(mapTileRow);
}

export async function getTileById(
  tileRowId: string,
  userId: number,
): Promise<CVAdaptationTile | null> {
  const result = await pool.query(
    `SELECT t.* FROM cv_adaptation_tiles t
     JOIN cv_adaptations a ON a.id = t.adaptation_id
     WHERE t.id = $1 AND a.user_id = $2`,
    [tileRowId, userId],
  );
  return result.rows[0] ? mapTileRow(result.rows[0]) : null;
}

export async function updateTileStatus(
  tileRowId: string,
  userId: number,
  patch: { status: 'accepted' | 'skipped' | 'edited' | 'pending'; userEditedText?: string | null },
): Promise<CVAdaptationTile | null> {
  // Two-step update so we can enforce ownership through the join.
  const owned = await getTileById(tileRowId, userId);
  if (!owned) return null;
  const result = await pool.query(
    `UPDATE cv_adaptation_tiles
        SET status = $2,
            user_edited_text = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [tileRowId, patch.status, patch.userEditedText ?? null],
  );
  return result.rows[0] ? mapTileRow(result.rows[0]) : null;
}

/** Set the proposed text + reasoning + flip proposal_ready=true on
 *  tiles identified by their `tile_id` (NOT the row UUID — the
 *  stable hash). Used by the background skill-B run after skill A
 *  has already persisted the rows. Auth-checked at the adaptation
 *  level via the join. */
export async function setTileProposal(
  adaptationId: number,
  tileId: string,
  proposedText: string,
  reasoning: string | null,
  aiLogId: number | null,
): Promise<void> {
  await pool.query(
    `UPDATE cv_adaptation_tiles
        SET proposed_text = $3,
            reasoning = $4,
            proposal_ready = TRUE,
            ai_log_id = COALESCE($5, ai_log_id),
            updated_at = NOW()
      WHERE adaptation_id = $1 AND tile_id = $2`,
    [adaptationId, tileId, proposedText, reasoning, aiLogId],
  );
}

/** Replace the proposal text after a successful regenerate. Resets
 *  user_edited_text + status so the user re-validates the new
 *  proposal explicitly. */
export async function updateTileProposal(
  tileRowId: string,
  userId: number,
  proposedText: string,
  reasoning: string | null,
  aiLogId: number | null,
): Promise<CVAdaptationTile | null> {
  const owned = await getTileById(tileRowId, userId);
  if (!owned) return null;
  const result = await pool.query(
    `UPDATE cv_adaptation_tiles
        SET proposed_text = $2,
            reasoning = $3,
            user_edited_text = NULL,
            status = 'pending',
            proposal_ready = TRUE,
            regenerate_count = regenerate_count + 1,
            ai_log_id = COALESCE($4, ai_log_id),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [tileRowId, proposedText, reasoning, aiLogId],
  );
  return result.rows[0] ? mapTileRow(result.rows[0]) : null;
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
    status: (row.status === 'draft' || row.status === 'completed') ? row.status : 'completed',
    questions: Array.isArray(row.questions) ? row.questions : [],
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
    status: (row.status === 'draft' || row.status === 'completed') ? row.status : 'completed',
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
    /** Defaults to `draft` when called from the tile-by-tile flow.
     *  The legacy /adaptations endpoint passes `completed`. */
    status?: 'draft' | 'completed';
  }
): Promise<CVAdaptation> {
  const result = await pool.query(
    `INSERT INTO cv_adaptations
       (cv_id, user_id, job_offer, adapted_cv, changes, ats_before, ats_after, job_analysis, name, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      payload.status ?? 'draft',
    ]
  );
  return mapRow(result.rows[0]);
}

export async function getAdaptationsByCV(
  cvId: number,
  userId: number
): Promise<CVAdaptationListItem[]> {
  const result = await pool.query(
    `SELECT id, cv_id, name, job_offer, ats_after, changes, status, created_at
     FROM cv_adaptations
     WHERE cv_id = $1 AND user_id = $2
     ORDER BY created_at DESC`,
    [cvId, userId]
  );
  return result.rows.map(mapListRow);
}

/** Mark a draft adaptation as completed — called by the modal when
 *  the user reaches the "done" phase. Idempotent, safe to call twice. */
export async function markAdaptationCompleted(
  id: number,
  userId: number,
): Promise<CVAdaptation | null> {
  const result = await pool.query(
    `UPDATE cv_adaptations
        SET status = 'completed', updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [id, userId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

/** Look up an existing recent DRAFT for the same (user, cv, exact
 *  jobOffer) created in the last 10 minutes. Used to dedup the
 *  POST /cvs/:id/tile-adaptations endpoint so React StrictMode
 *  double-mounts and accidental double-clicks don't pile up
 *  identical drafts. Returns null if none. */
export async function getRecentDraftForOffer(
  cvId: number,
  userId: number,
  jobOffer: string,
): Promise<CVAdaptation | null> {
  const result = await pool.query(
    `SELECT *
       FROM cv_adaptations
      WHERE cv_id = $1 AND user_id = $2
        AND status = 'draft'
        AND job_offer = $3
        AND created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 1`,
    [cvId, userId, jobOffer],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
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

/** Replace the full Q&A array on an adaptation. The frontend sends
 *  the entire list on every change (add / rename / delete / answer
 *  edit) — simpler than per-entry CRUD and the array is small. */
export async function updateAdaptationQuestions(
  id: number,
  userId: number,
  questions: AdaptationQuestion[],
): Promise<CVAdaptation | null> {
  const result = await pool.query(
    `UPDATE cv_adaptations
        SET questions = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *`,
    [JSON.stringify(questions), id, userId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
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
