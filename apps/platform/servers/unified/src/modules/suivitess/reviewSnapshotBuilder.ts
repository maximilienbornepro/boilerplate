// ═══════════════════════════════════════════════════════════════════════
// Build the "all reviews / all subjects, classified by review" snapshot
// fed to the T2 placement skill `suivitess-place-in-reviews`.
//
// Why this exists in its own file:
//   - 4 endpoints in routes.ts were building exactly the same structure,
//     with the same silent 20-subjects-per-section cap and the same
//     missing `responsibility` propagation. Centralising the shape here
//     guarantees the 4 paths evolve together and the AI sees a coherent
//     payload regardless of which entry point the user hit.
//
// What it does differently from the legacy inline mapping:
//   - Removes the hard `slice(0, 20)` cap. Replaces it with a
//     per-review budget proportional to the portfolio size, so we
//     surface the full list of subjects on small portfolios and only
//     trim the oldest tail on large ones.
//   - Sorts subjects by `updated_at DESC` before applying the budget so
//     the most recent (= most relevant for routing decisions) survive.
//   - Counts dropped subjects per section into `subjectsTruncated` so
//     the prompt can flag low-confidence matching when the cap kicked in.
//   - Propagates `responsibility` (the "who owns this" field) — the
//     legacy AI payload mapping forgot to include it, depriving the
//     skill of a strong signal for team-based routing.
// ═══════════════════════════════════════════════════════════════════════

import type { ReviewContext } from '../aiSkills/analyzeSourcePipeline.js';
import type * as DbService from './dbService.js';

/** Total subjects budget across the whole portfolio that T2 sees in
 *  one prompt. Calibrated to fit comfortably under the 150 000-char
 *  serialization clamp in `tier2PlaceReviews` while leaving room for
 *  the prompt body and the few-shot RAG examples. */
const SUBJECT_BUDGET_TOTAL = 120;

/** Floor on the per-review cap so that small portfolios with many
 *  reviews don't end up showing < 5 subjects per review (which would
 *  defeat the matching). 8 is a pragmatic choice — covers the
 *  typical "live + recently closed" subjects on an active review. */
const PER_REVIEW_FLOOR = 8;

/** Maximum number of reviews considered. Matches the previous cap in
 *  routes.ts (`existingDocs.slice(0, 40)`) — 40 reviews is already
 *  beyond what an active user maintains. */
const MAX_REVIEWS = 40;

/** Maximum chars kept from the situation field — same as the legacy
 *  cap, enough for the skill to recognise the topic without bloating
 *  the payload. */
const SITUATION_EXCERPT_MAX = 200;

type DbModule = typeof DbService;

export interface BuildReviewsSnapshotOpts {
  userId: number;
  isAdmin: boolean;
  db: DbModule;
}

/**
 * Returns the snapshot to pass as `reviews:` to `analyzeSourceForReviews`
 * / `analyzeMultiSourceForReviews`. Best-effort : a failure on any
 * single document is swallowed (logged) and that review is omitted —
 * matches the legacy inline behaviour.
 */
export async function buildReviewsSnapshotForAI(
  opts: BuildReviewsSnapshotOpts,
): Promise<ReviewContext[]> {
  const { userId, isAdmin, db } = opts;

  const existingDocs = await db.getAllDocuments(userId, isAdmin);
  const consideredDocs = existingDocs.slice(0, MAX_REVIEWS);
  if (consideredDocs.length === 0) return [];

  // Per-review cap : split the global subject budget evenly across the
  // reviews actually in scope. Floor protects small portfolios.
  const perReviewCap = Math.max(
    PER_REVIEW_FLOOR,
    Math.floor(SUBJECT_BUDGET_TOTAL / consideredDocs.length),
  );

  const out: ReviewContext[] = [];
  for (const d of consideredDocs) {
    try {
      const doc = await db.getDocumentWithSections(d.id);
      if (!doc) continue;

      // Sort all subjects of this review by recency, take the top N
      // and remember which subject ids made the cut so we can compute
      // per-section truncation counts.
      type SubjectLite = {
        id: string;
        title: string;
        situation?: string | null;
        status?: string | null;
        responsibility?: string | null;
        updated_at?: string | Date | null;
      };
      type SectionLite = {
        id: string;
        name: string;
        subjects?: SubjectLite[] | null;
      };
      const sections = (doc.sections || []) as SectionLite[];
      const allSubjects: Array<{ section: SectionLite; sub: SubjectLite }> = [];
      for (const s of sections) {
        for (const sub of s.subjects || []) {
          allSubjects.push({ section: s, sub });
        }
      }
      // updated_at DESC → most recent first. Subjects without timestamp
      // (defensive) sink to the bottom.
      allSubjects.sort((a, b) => {
        const ta = a.sub.updated_at ? new Date(a.sub.updated_at).getTime() : 0;
        const tb = b.sub.updated_at ? new Date(b.sub.updated_at).getTime() : 0;
        return tb - ta;
      });
      const kept = allSubjects.slice(0, perReviewCap);
      const keptIds = new Set(kept.map(x => x.sub.id));

      // Re-group kept subjects by section, preserving the section's
      // original position order (we only sort subjects within a
      // section if needed — for now, iterate sections in their natural
      // order and pick the kept subjects).
      out.push({
        id: doc.id,
        title: doc.title,
        description: (d as { description?: string | null }).description ?? null,
        sections: sections.map(s => {
          const total = (s.subjects || []).length;
          const keptInSection = (s.subjects || []).filter(sub => keptIds.has(sub.id));
          const truncated = total - keptInSection.length;
          return {
            id: s.id,
            name: s.name,
            ...(truncated > 0 ? { subjectsTruncated: truncated } : {}),
            subjects: keptInSection.map(sub => ({
              id: sub.id,
              title: sub.title,
              status: sub.status ?? null,
              situationExcerpt: (sub.situation || '').slice(0, SITUATION_EXCERPT_MAX),
              responsibility: sub.responsibility ?? null,
            })),
          };
        }),
      });
    } catch (err) {
      // Best-effort : skip this review, but log so a degraded snapshot
      // doesn't go unnoticed during dev.
      // eslint-disable-next-line no-console
      console.warn(`[reviewSnapshotBuilder] skipping review ${d.id}:`, err);
    }
  }

  return out;
}

// Exported for tests.
export const _internals = {
  SUBJECT_BUDGET_TOTAL,
  PER_REVIEW_FLOOR,
  MAX_REVIEWS,
  SITUATION_EXCERPT_MAX,
};
