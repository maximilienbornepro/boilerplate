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

export interface AutoImportConfig {
  id: string;
  userId: number;
  documentId: string;
  enabled: boolean;
  enabledSources: AutoImportSource[];
  lastRunAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  createdAt: string;
  updatedAt: string;
}

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

function mapConfigRow(r: any): AutoImportConfig {
  return {
    id: r.id,
    userId: r.user_id,
    documentId: r.document_id,
    enabled: r.enabled,
    enabledSources: Array.isArray(r.enabled_sources) ? r.enabled_sources as AutoImportSource[] : [],
    lastRunAt: r.last_run_at instanceof Date ? r.last_run_at.toISOString() : (r.last_run_at ?? null),
    lastError: r.last_error ?? null,
    consecutiveErrors: r.consecutive_errors ?? 0,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

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
// Config CRUD
// ────────────────────────────────────────────────────────────────────

/** Fetch a config by (user, document). Returns null when nothing's been
 *  set yet — the caller treats null as "auto-import disabled". */
export async function getConfig(
  userId: number,
  documentId: string,
): Promise<AutoImportConfig | null> {
  const r = await pool.query(
    `SELECT * FROM suivitess_auto_import_config
      WHERE user_id = $1 AND document_id = $2`,
    [userId, documentId],
  );
  return r.rows[0] ? mapConfigRow(r.rows[0]) : null;
}

/** UPSERT a config row. Used by the settings page each time the user
 *  toggles a switch or a source checkbox. */
export async function upsertConfig(
  userId: number,
  documentId: string,
  patch: { enabled?: boolean; enabledSources?: AutoImportSource[] },
): Promise<AutoImportConfig> {
  const existing = await getConfig(userId, documentId);
  const enabled = patch.enabled ?? existing?.enabled ?? false;
  const sources = patch.enabledSources ?? existing?.enabledSources ?? [];
  const r = await pool.query(
    `INSERT INTO suivitess_auto_import_config
       (user_id, document_id, enabled, enabled_sources, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, document_id) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           enabled_sources = EXCLUDED.enabled_sources,
           updated_at = NOW()
     RETURNING *`,
    [userId, documentId, enabled, sources],
  );
  return mapConfigRow(r.rows[0]);
}

/** List ALL configs flagged enabled — consumed by the scheduler when
 *  it walks every active doc/user pair. */
export async function listEnabledConfigs(): Promise<AutoImportConfig[]> {
  const r = await pool.query(
    `SELECT * FROM suivitess_auto_import_config WHERE enabled = TRUE ORDER BY last_run_at NULLS FIRST`,
  );
  return r.rows.map(mapConfigRow);
}

/** Update the post-run metadata on a config. Called after each
 *  scheduler tick — success path resets `consecutive_errors` to 0,
 *  failure path increments + stores the last_error message. The
 *  scheduler auto-disables a config once `consecutive_errors >= 3`
 *  to avoid burning tokens on a broken integration. */
export async function recordRunResult(
  configId: string,
  success: boolean,
  errorMessage: string | null = null,
): Promise<void> {
  if (success) {
    await pool.query(
      `UPDATE suivitess_auto_import_config
          SET last_run_at = NOW(),
              last_error = NULL,
              consecutive_errors = 0,
              updated_at = NOW()
        WHERE id = $1`,
      [configId],
    );
  } else {
    await pool.query(
      `UPDATE suivitess_auto_import_config
          SET last_run_at = NOW(),
              last_error = $2,
              consecutive_errors = consecutive_errors + 1,
              -- auto-pause after 3 consecutive errors
              enabled = (consecutive_errors + 1 < 3),
              updated_at = NOW()
        WHERE id = $1`,
      [configId, errorMessage ?? 'unknown'],
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// User-level master kill-switch
// ────────────────────────────────────────────────────────────────────

/** Master kill-switch lives in the module-local
 *  `suivitess_user_settings` table. Absence of a row = default
 *  (= NOT disabled, = auto-import allowed if the per-doc config
 *  enables it). Returns true when the user explicitly opted out. */
export async function isMasterKillSwitchOn(userId: number): Promise<boolean> {
  const r = await pool.query(
    `SELECT auto_import_disabled FROM suivitess_user_settings WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0]?.auto_import_disabled === true;
}

/** Set/unset the master kill-switch on the user level. Upserts the
 *  module-local settings row (created if missing). */
export async function setMasterKillSwitch(
  userId: number,
  disabled: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO suivitess_user_settings (user_id, auto_import_disabled, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET auto_import_disabled = EXCLUDED.auto_import_disabled,
           updated_at = NOW()`,
    [userId, disabled],
  );
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

/** Duplicate guard — used by the scheduler before inserting a fresh
 *  proposal. Returns true if a row for the same (user, doc, source)
 *  already exists in any status (pending/accepted/rejected). Prevents
 *  re-analysing a source that the user already saw, even if the
 *  underlying `transcript_imports` dedup somehow missed it. */
export async function inboxProposalAlreadyExists(
  userId: number,
  documentId: string,
  sourceKind: string,
  sourceId: string,
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1
       FROM suivitess_inbox_proposals
      WHERE user_id = $1
        AND document_id = $2
        AND source_kind = $3
        AND source_id = $4
      LIMIT 1`,
    [userId, documentId, sourceKind, sourceId],
  );
  return r.rowCount! > 0;
}
