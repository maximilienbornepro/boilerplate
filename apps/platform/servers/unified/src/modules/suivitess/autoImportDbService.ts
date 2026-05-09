// DB helpers for the auto-import feature.
//
// Two surfaces :
//   - `suivitess_auto_import_config` : per-(user, document) toggles
//     consumed by `autoImportScheduler`.
//   - `suivitess_inbox_proposals`    : every analysis the cron
//     produces (or rejected/accepted history). Powers the inbox UI.

import { pool } from './dbService.js';

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type AutoImportSource = 'fathom' | 'otter' | 'outlook' | 'gmail' | 'slack';

export type InboxProposalStatus = 'pending' | 'accepted' | 'rejected';

export interface InboxProposal {
  id: string;
  userId: number;
  documentId: string;
  sourceKind: AutoImportSource;
  sourceId: string;
  sourceTitle: string | null;
  sourceDate: string | null;
  /** Raw FinalReviewProposal[] JSONB — same shape as
   *  analyzeSourceForReviews returns. The detail view + the bulk
   *  modal routing UI consume it directly. */
  proposals: unknown[];
  aiLogId: number | null;
  status: InboxProposalStatus;
  createdAt: string;
  reviewedAt: string | null;
  /** Denormalised for the inbox list — saves a JOIN. */
  documentTitle?: string;
}

// ────────────────────────────────────────────────────────────────────
// Mappers
// ────────────────────────────────────────────────────────────────────

function mapInboxRow(r: any): InboxProposal {
  return {
    id: r.id,
    userId: r.user_id,
    documentId: r.document_id,
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    sourceTitle: r.source_title ?? null,
    sourceDate: r.source_date instanceof Date ? r.source_date.toISOString() : (r.source_date ?? null),
    proposals: Array.isArray(r.proposals) ? r.proposals : [],
    aiLogId: r.ai_log_id ?? null,
    status: r.status,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    reviewedAt: r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : (r.reviewed_at ?? null),
    documentTitle: r.document_title ?? undefined,
  };
}

// ────────────────────────────────────────────────────────────────────
// User-level settings (master kill-switch + which sources to pull)
// ────────────────────────────────────────────────────────────────────

export interface UserAutoImportSettings {
  /** True when the user has explicitly DISABLED auto-import globally.
   *  Default false (no row = auto-import allowed). */
  masterDisabled: boolean;
  /** Which integrations the cron is allowed to fetch from for THIS
   *  user. Empty array = no source = nothing to do (fast no-op). */
  sources: AutoImportSource[];
  lastRunAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
}

const ALL_SOURCES: AutoImportSource[] = ['fathom', 'otter', 'outlook', 'gmail', 'slack'];

export async function getUserSettings(userId: number): Promise<UserAutoImportSettings> {
  const r = await pool.query(
    `SELECT auto_import_disabled, auto_import_sources, last_run_at, last_error, consecutive_errors
       FROM suivitess_user_settings WHERE user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) {
    return { masterDisabled: false, sources: [], lastRunAt: null, lastError: null, consecutiveErrors: 0 };
  }
  return {
    masterDisabled: row.auto_import_disabled === true,
    sources: Array.isArray(row.auto_import_sources)
      ? (row.auto_import_sources as string[]).filter(s => (ALL_SOURCES as string[]).includes(s)) as AutoImportSource[]
      : [],
    lastRunAt: row.last_run_at instanceof Date ? row.last_run_at.toISOString() : (row.last_run_at ?? null),
    lastError: row.last_error ?? null,
    consecutiveErrors: row.consecutive_errors ?? 0,
  };
}

/** Upsert the user-level settings row. Pass `undefined` for any
 *  field you don't want to change. */
export async function upsertUserSettings(
  userId: number,
  patch: { masterDisabled?: boolean; sources?: AutoImportSource[] },
): Promise<UserAutoImportSettings> {
  const existing = await getUserSettings(userId);
  const masterDisabled = patch.masterDisabled ?? existing.masterDisabled;
  const sources = patch.sources ?? existing.sources;
  await pool.query(
    `INSERT INTO suivitess_user_settings
       (user_id, auto_import_disabled, auto_import_sources, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET auto_import_disabled = EXCLUDED.auto_import_disabled,
           auto_import_sources = EXCLUDED.auto_import_sources,
           updated_at = NOW()`,
    [userId, masterDisabled, sources],
  );
  return getUserSettings(userId);
}

/** Mark a successful or failed run at the user level. Same auto-pause
 *  logic as before : 3 consecutive failures flip masterDisabled to
 *  true so a broken integration doesn't burn tokens. */
export async function recordUserRunResult(
  userId: number,
  success: boolean,
  errorMessage: string | null = null,
): Promise<void> {
  if (success) {
    await pool.query(
      `INSERT INTO suivitess_user_settings (user_id, last_run_at, consecutive_errors, updated_at)
       VALUES ($1, NOW(), 0, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET last_run_at = NOW(),
             last_error = NULL,
             consecutive_errors = 0,
             updated_at = NOW()`,
      [userId],
    );
  } else {
    await pool.query(
      `INSERT INTO suivitess_user_settings (user_id, last_run_at, last_error, consecutive_errors, updated_at)
       VALUES ($1, NOW(), $2, 1, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET last_run_at = NOW(),
             last_error = $2,
             consecutive_errors = suivitess_user_settings.consecutive_errors + 1,
             auto_import_disabled = (suivitess_user_settings.consecutive_errors + 1 >= 3),
             updated_at = NOW()`,
      [userId, errorMessage ?? 'unknown'],
    );
  }
}

/** Legacy alias used by existing route handlers — checks the
 *  master kill-switch only. Returns true when user opted out. */
export async function isMasterKillSwitchOn(userId: number): Promise<boolean> {
  const s = await getUserSettings(userId);
  return s.masterDisabled;
}

/** Legacy alias for the routes that flip just the master toggle. */
export async function setMasterKillSwitch(
  userId: number,
  disabled: boolean,
): Promise<void> {
  await upsertUserSettings(userId, { masterDisabled: disabled });
}

// ────────────────────────────────────────────────────────────────────
// Per-doc opt-in (which docs the AI is allowed to ROUTE TO)
// ────────────────────────────────────────────────────────────────────

/** List documents the user has opted in as auto-import targets.
 *  Source-of-truth for the cross-doc analyzer's `reviews` parameter
 *  — only opted-in docs are surfaced to the AI as candidates. */
export async function listEnabledTargetDocumentIds(userId: number): Promise<string[]> {
  const r = await pool.query(
    `SELECT document_id
       FROM suivitess_auto_import_config
      WHERE user_id = $1 AND enabled = TRUE`,
    [userId],
  );
  return r.rows.map(row => row.document_id as string);
}

/** Set/unset a single doc's opt-in status. */
export async function setDocumentEnabled(
  userId: number,
  documentId: string,
  enabled: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO suivitess_auto_import_config (user_id, document_id, enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, document_id) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           updated_at = NOW()`,
    [userId, documentId, enabled],
  );
}

/** Quick check used by the per-doc header toggle UI. */
export async function isDocumentEnabled(
  userId: number,
  documentId: string,
): Promise<boolean> {
  const r = await pool.query(
    `SELECT enabled FROM suivitess_auto_import_config
      WHERE user_id = $1 AND document_id = $2`,
    [userId, documentId],
  );
  return r.rows[0]?.enabled === true;
}

// ────────────────────────────────────────────────────────────────────
// Inbox CRUD
// ────────────────────────────────────────────────────────────────────

/** Insert a fresh proposal coming out of the cron analysis. */
export async function insertInboxProposal(input: {
  userId: number;
  documentId: string;
  sourceKind: AutoImportSource;
  sourceId: string;
  sourceTitle: string | null;
  sourceDate: string | null;
  proposals: unknown[];
  aiLogId: number | null;
}): Promise<InboxProposal> {
  const r = await pool.query(
    `INSERT INTO suivitess_inbox_proposals
       (user_id, document_id, source_kind, source_id, source_title,
        source_date, proposals, ai_log_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     RETURNING *`,
    [
      input.userId, input.documentId, input.sourceKind, input.sourceId,
      input.sourceTitle, input.sourceDate, JSON.stringify(input.proposals),
      input.aiLogId,
    ],
  );
  return mapInboxRow(r.rows[0]);
}

/** List inbox proposals for a user. Optional filters mirror the UI
 *  tab + filters surface (status / source / document / date range). */
export async function listInboxProposals(opts: {
  userId: number;
  status?: InboxProposalStatus | 'all';
  sourceKind?: AutoImportSource;
  documentId?: string;
  /** Inclusive — defaults to "no filter". */
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
}): Promise<InboxProposal[]> {
  const where: string[] = ['p.user_id = $1'];
  const params: any[] = [opts.userId];
  let i = 2;

  if (opts.status && opts.status !== 'all') {
    where.push(`p.status = $${i++}`);
    params.push(opts.status);
  }
  if (opts.sourceKind) {
    where.push(`p.source_kind = $${i++}`);
    params.push(opts.sourceKind);
  }
  if (opts.documentId) {
    where.push(`p.document_id = $${i++}`);
    params.push(opts.documentId);
  }
  if (opts.fromDate) {
    where.push(`p.created_at >= $${i++}`);
    params.push(opts.fromDate.toISOString());
  }
  if (opts.toDate) {
    where.push(`p.created_at <= $${i++}`);
    params.push(opts.toDate.toISOString());
  }

  const limit = Math.min(opts.limit ?? 1000, 5000);
  const r = await pool.query(
    `SELECT p.*, d.title AS document_title
       FROM suivitess_inbox_proposals p
       LEFT JOIN suivitess_documents d ON d.id = p.document_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT ${limit}`,
    params,
  );
  return r.rows.map(mapInboxRow);
}

/** Single inbox proposal by id, ownership-checked. */
export async function getInboxProposal(
  id: string,
  userId: number,
): Promise<InboxProposal | null> {
  const r = await pool.query(
    `SELECT p.*, d.title AS document_title
       FROM suivitess_inbox_proposals p
       LEFT JOIN suivitess_documents d ON d.id = p.document_id
      WHERE p.id = $1 AND p.user_id = $2`,
    [id, userId],
  );
  return r.rows[0] ? mapInboxRow(r.rows[0]) : null;
}

/** Flip status to accepted / rejected, stamp reviewed_at. Idempotent —
 *  re-accepting an already-accepted row is a no-op. */
export async function setInboxProposalStatus(
  id: string,
  userId: number,
  status: InboxProposalStatus,
): Promise<InboxProposal | null> {
  const r = await pool.query(
    `UPDATE suivitess_inbox_proposals
        SET status = $3,
            reviewed_at = CASE WHEN $3 = 'pending' THEN NULL ELSE NOW() END
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [id, userId, status],
  );
  return r.rows[0] ? mapInboxRow(r.rows[0]) : null;
}

/** Quick count of pending proposals for the nav badge. */
export async function countPendingForUser(userId: number): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM suivitess_inbox_proposals
      WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );
  return r.rows[0]?.n ?? 0;
}

/** User-level dedup guard — the cron uses this instead of the
 *  per-doc variant because in the cross-doc model the source isn't
 *  scoped to a target document upfront (the AI decides). Returns
 *  true if any row for the same (user, source) exists in any
 *  status (pending/accepted/rejected). */
export async function inboxProposalAlreadyExistsForUser(
  userId: number,
  sourceKind: string,
  sourceId: string,
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1
       FROM suivitess_inbox_proposals
      WHERE user_id = $1
        AND source_kind = $2
        AND source_id = $3
      LIMIT 1`,
    [userId, sourceKind, sourceId],
  );
  return r.rowCount! > 0;
}
