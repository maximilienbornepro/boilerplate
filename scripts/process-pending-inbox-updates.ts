#!/usr/bin/env npx tsx
/**
 * One-shot retroactive cleanup of the suivitess auto-import inbox.
 *
 * The hourly cron now applies subject UPDATES silently (no human
 * validation needed), but the inbox rows that were created BEFORE
 * that change still carry update proposals waiting in pending.
 *
 * This script :
 *   1. Walks every `suivitess_inbox_proposals` row with status = pending.
 *   2. Splits its `proposals` into auto (subjectAction =
 *      'update-existing-subject' with a targetSubjectId) and manual.
 *   3. Applies every auto proposal via the same in-process helper the
 *      scheduler now uses (`applySubjectUpdates`).
 *   4. If nothing manual is left → marks the inbox row as `accepted`
 *      (it disappears from the Pending tab — exactly what the user
 *      would see if they had clicked "Valider" today).
 *      Otherwise → rewrites `proposals` to keep only the manual
 *      entries, so the modal opens with just the new subjects to
 *      validate next time the user clicks "Valider".
 *   5. Tags the source as imported in `suivitess_transcript_imports`
 *      on every touched review so the cron's dedup is strict.
 *
 * Usage :
 *   APP_DATABASE_URL=postgres://... npx tsx scripts/process-pending-inbox-updates.ts
 *
 * Idempotent — running it twice is safe (the second run finds nothing
 * left to auto-apply).
 */

// We deliberately avoid importing the suivitess dbService here — that
// module's pool is lazy (initialised by initDb()), and pulling in the
// rest of the suivitess module surface from a CLI script is more
// surface than we need. We just speak SQL directly via a fresh Pool,
// and re-implement the small subset of merge/update logic the helper
// would have run.

import pg from 'pg';
import { mergeSituationAppend, todayFrFr } from '../apps/platform/servers/unified/src/modules/suivitess/situationMerge.js';

const { Pool } = pg;

const connectionString = process.env.APP_DATABASE_URL;
if (!connectionString) {
  // eslint-disable-next-line no-console
  console.error('[inbox-cleanup] APP_DATABASE_URL is not set. Aborting.');
  process.exit(1);
}
const pool = new Pool({ connectionString });

interface RawRow {
  id: string;
  user_id: number;
  source_kind: string;
  source_id: string;
  source_title: string | null;
  proposals: unknown;
}

interface RawProposal {
  title?: string;
  subjectAction?: 'new-subject' | 'update-existing-subject';
  targetSubjectId?: string | null;
  updatedSituation?: string | null;
  updatedStatus?: string | null;
  updatedResponsibility?: string | null;
}

interface PureSubjectUpdate {
  title: string;
  targetSubjectId: string;
  updatedSituation: string | null;
  updatedStatus: string | null;
  updatedResponsibility: string | null;
}

/** Direct SQL re-implementation of `applySubjectUpdates` :
 *  - load existing subject by id
 *  - smart-merge the situation append (same-day single header)
 *  - write status / responsibility if provided
 *  - return the touched review ids so we can tag the source as imported
 *
 *  Mirrors the in-process service but speaks SQL directly so the
 *  script doesn't need the suivitess module's lazy pool. */
async function applySubjectUpdates(
  _userId: number,
  subjects: PureSubjectUpdate[],
): Promise<{
  updated: number;
  skipped: number;
  touchedReviewIds: Set<string>;
  errors: Array<{ title: string; error: string }>;
}> {
  const errors: Array<{ title: string; error: string }> = [];
  const touchedReviewIds = new Set<string>();
  let updated = 0;
  let skipped = 0;
  if (subjects.length === 0) return { updated, skipped, touchedReviewIds, errors };

  const today = todayFrFr();

  for (const s of subjects) {
    if (!s.targetSubjectId) { skipped++; continue; }
    try {
      const existingQ = await pool.query<{
        id: string; situation: string | null; section_id: string;
      }>(
        `SELECT id, situation, section_id FROM suivitess_subjects WHERE id = $1`,
        [s.targetSubjectId],
      );
      const existing = existingQ.rows[0];
      if (!existing) { skipped++; continue; }

      const fragments: string[] = [];
      const values: (string | null)[] = [];
      let idx = 1;

      if (s.updatedSituation && String(s.updatedSituation).trim().length > 0) {
        const merged = mergeSituationAppend(
          existing.situation || '',
          String(s.updatedSituation),
          today,
        );
        fragments.push(`situation = $${idx++}`);
        values.push(merged);
      }
      if (s.updatedStatus) {
        fragments.push(`status = $${idx++}`);
        values.push(s.updatedStatus);
      }
      if (s.updatedResponsibility !== null && s.updatedResponsibility !== undefined) {
        fragments.push(`responsibility = $${idx++}`);
        values.push(s.updatedResponsibility);
      }

      if (fragments.length > 0) {
        values.push(s.targetSubjectId);
        await pool.query(
          `UPDATE suivitess_subjects SET ${fragments.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
          values,
        );
      }
      updated++;

      // Touch the parent review for transcript-imports tagging.
      const secQ = await pool.query<{ document_id: string }>(
        `SELECT document_id FROM suivitess_sections WHERE id = $1`,
        [existing.section_id],
      );
      if (secQ.rows[0]) touchedReviewIds.add(secQ.rows[0].document_id);
    } catch (err) {
      errors.push({ title: s.title, error: (err as Error).message });
    }
  }
  return { updated, skipped, touchedReviewIds, errors };
}

async function recordSourceImported(
  reviewIds: Iterable<string>,
  sourceKind: string,
  sourceId: string,
  sourceTitle: string | null,
): Promise<void> {
  for (const reviewId of reviewIds) {
    try {
      await pool.query(
        `INSERT INTO suivitess_transcript_imports (document_id, call_id, provider, call_title)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [reviewId, sourceId, `auto-import:${sourceKind}`, sourceTitle ?? ''],
      );
    } catch { /* best-effort */ }
  }
}

async function main() {
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.log('[inbox-cleanup] scanning pending inbox rows…');

  const rows = await pool.query<RawRow>(
    `SELECT id, user_id, source_kind, source_id, source_title, proposals
       FROM suivitess_inbox_proposals
      WHERE status = 'pending'
      ORDER BY created_at ASC`,
  );

  let scanned = 0;
  let rowsAccepted = 0;
  let rowsTrimmed = 0;
  let totalUpdatesApplied = 0;
  let totalErrors = 0;

  for (const r of rows.rows) {
    scanned++;
    const proposals = Array.isArray(r.proposals) ? (r.proposals as RawProposal[]) : [];
    const auto: PureSubjectUpdate[] = [];
    const manual: RawProposal[] = [];
    for (const p of proposals) {
      if (p.subjectAction === 'update-existing-subject' && p.targetSubjectId) {
        auto.push({
          title: p.title ?? '(untitled)',
          targetSubjectId: p.targetSubjectId,
          updatedSituation: p.updatedSituation ?? null,
          updatedStatus: p.updatedStatus ?? null,
          updatedResponsibility: p.updatedResponsibility ?? null,
        });
      } else {
        manual.push(p);
      }
    }

    if (auto.length === 0) continue; // already nothing to auto-apply

    const result = await applySubjectUpdates(r.user_id, auto);
    totalUpdatesApplied += result.updated;
    totalErrors += result.errors.length;
    if (result.errors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[inbox-cleanup] row ${r.id} : ${result.errors.length} error(s)`, result.errors);
    }

    // Bookkeeping : tag the source as imported on every touched
    // review so the cron's dedup keeps it from re-appearing.
    await recordSourceImported(result.touchedReviewIds, r.source_kind, r.source_id, r.source_title);

    if (manual.length === 0) {
      // Nothing left to validate — accept the row.
      await pool.query(
        `UPDATE suivitess_inbox_proposals
            SET status = 'accepted', reviewed_at = NOW()
          WHERE id = $1`,
        [r.id],
      );
      rowsAccepted++;
    } else {
      // Trim proposals to keep only the manual entries.
      await pool.query(
        `UPDATE suivitess_inbox_proposals
            SET proposals = $2::jsonb
          WHERE id = $1`,
        [r.id, JSON.stringify(manual)],
      );
      rowsTrimmed++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[inbox-cleanup] done in ${Date.now() - t0}ms`,
    `\n  scanned    : ${scanned} pending row(s)`,
    `\n  accepted   : ${rowsAccepted} (only updates)`,
    `\n  trimmed    : ${rowsTrimmed} (kept new subjects only)`,
    `\n  updates    : ${totalUpdatesApplied} subject(s) applied`,
    `\n  errors     : ${totalErrors}`,
  );

  await pool.end();
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[inbox-cleanup] failed:', err);
  process.exit(1);
});
