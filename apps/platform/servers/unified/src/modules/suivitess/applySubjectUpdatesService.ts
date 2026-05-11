// Pure subject-update applier — extracted from the apply-routing route
// so the auto-import scheduler (cron) and the one-shot inbox cleanup
// script can apply an update WITHOUT going through the full HTTP
// handler. Mirrors the route's behaviour exactly :
//
//   - existing subject loaded by id
//   - if `updatedSituation` is non-blank → smart-merge via
//     `mergeSituationAppend(currentSituation, append, todayFrFr())`
//     (same-day imports share a header)
//   - if `updatedStatus` set → write it
//   - if `updatedResponsibility` set → write it
//   - the row is committed via `db.updateSubjectFields`
//
// Routing memory is NOT updated here — that's intentional. The memory
// is meant to capture HUMAN routing decisions, and an auto-applied
// update isn't one. Memory keeps being fed by the regular bulk modal
// path when the user validates new subjects.
//
// Only handles the "update-existing-subject" case. Creation paths stay
// in the route handler.

import * as db from './dbService.js';
import { scheduleSynthForSubjects } from './synthesizeAfterUpdateService.js';

export interface PureSubjectUpdate {
  /** Display title — used for routing memory + error reporting only. */
  title: string;
  targetSubjectId: string;
  /** Free-text append to the subject's situation. Empty/blank = skip. */
  updatedSituation?: string | null;
  /** New status to write on the subject. Empty = skip. */
  updatedStatus?: string | null;
  /** New responsibility to write on the subject. `null` is significant. */
  updatedResponsibility?: string | null;
}

export interface ApplySubjectUpdatesResult {
  updated: number;
  /** Skipped because the subject id was missing or didn't resolve. */
  skipped: number;
  /** Touched review ids — useful for the caller to bookkeep
   *  (e.g. tag transcripts as imported on those documents). */
  touchedReviewIds: Set<string>;
  errors: Array<{ title: string; error: string }>;
}

/** Apply a batch of pure subject-update payloads.
 *  Same merge / write semantics as the route's update branch.
 *  `userId` is now used to attribute the post-update synthesis pass
 *  to the right account in /ai-logs ; `userEmail` is optional. */
export async function applySubjectUpdates(
  userId: number,
  subjects: PureSubjectUpdate[],
  userEmail: string | null = null,
): Promise<ApplySubjectUpdatesResult> {
  const errors: Array<{ title: string; error: string }> = [];
  const touchedReviewIds = new Set<string>();
  const updatedSubjectIds = new Set<string>();
  let updated = 0;
  let skipped = 0;

  if (subjects.length === 0) {
    return { updated, skipped, touchedReviewIds, errors };
  }

  const { mergeSituationAppend, todayFrFr } = await import('./situationMerge.js');
  const todayHeader = todayFrFr();

  for (const s of subjects) {
    if (!s.targetSubjectId) { skipped++; continue; }
    try {
      const existing = await db.getSubject(s.targetSubjectId);
      if (!existing) { skipped++; continue; }

      const fragments: string[] = [];
      const values: (string | number | null)[] = [];
      let idx = 1;

      if (
        s.updatedSituation !== undefined
        && s.updatedSituation !== null
        && String(s.updatedSituation).trim().length > 0
      ) {
        const merged = mergeSituationAppend(
          existing.situation || '',
          String(s.updatedSituation),
          todayHeader,
        );
        fragments.push(`situation = $${idx++}`);
        values.push(merged);
      }
      if (s.updatedStatus) {
        fragments.push(`status = $${idx++}`);
        values.push(s.updatedStatus);
      }
      if (s.updatedResponsibility !== undefined && s.updatedResponsibility !== null) {
        fragments.push(`responsibility = $${idx++}`);
        values.push(s.updatedResponsibility);
      }

      if (fragments.length > 0) {
        await db.updateSubjectFields(s.targetSubjectId, fragments, values);
        updatedSubjectIds.add(s.targetSubjectId);
      }
      updated++;

      // Track the parent review for the caller (transcript-imports tagging).
      try {
        const sec = await db.getSection(existing.section_id);
        if (sec) touchedReviewIds.add(sec.document_id);
      } catch { /* ignore — best effort */ }
    } catch (err) {
      errors.push({ title: s.title, error: (err as Error).message });
    }
  }

  // Fire-and-forget : schedule the post-update synthesis on every
  // subject we actually wrote to. Runs in background, never blocks
  // the import response.
  scheduleSynthForSubjects(updatedSubjectIds, userId, userEmail);

  return { updated, skipped, touchedReviewIds, errors };
}

/** Best-effort tag of one source as already imported on every touched
 *  document, so the cron / inbox dedup correctly skips it next tick.
 *  Mirrors the bookkeeping the apply-routing route does at the end of
 *  a successful import. */
export async function recordSourceImported(
  reviewIds: Iterable<string>,
  sourceKind: string,
  sourceId: string,
  sourceTitle?: string | null,
): Promise<void> {
  for (const reviewId of reviewIds) {
    try {
      await db.pool.query(
        `INSERT INTO suivitess_transcript_imports (document_id, call_id, provider, call_title)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [reviewId, sourceId, `auto-import:${sourceKind}`, sourceTitle ?? ''],
      );
    } catch { /* ignore — best effort */ }
  }
}
