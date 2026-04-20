// ═══════════════════════════════════════════════════════════════════════
// Replay a past suivitess pipeline run from the logs — no LLM calls.
// The T2 log stores the full routing decisions (proposals_json) + its
// input (subjects + reviews). The T3 children store the composed
// situations / appendTexts. We stitch them together into the exact shape
// the frontend expects from the live pipeline.
//
// Primary use-case : UI iteration. A full multi-source run takes 2-3
// minutes ; replaying from logs takes ~100 ms and spends $0.
// ═══════════════════════════════════════════════════════════════════════

import pg from 'pg';
import { config } from '../../config.js';

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: config.appDatabaseUrl });
  return pool;
}

export interface ReplayableRun {
  t2LogId: number;
  createdAt: string;
  /** Subjects count as reported by the T2 log itself. */
  proposalsCount: number;
  /** Optional human label built from sourceTitle + timestamp. */
  label: string;
  /** Short preview of the first few subject titles from the log. */
  subjectsPreview: string[];
}

/** List recent T2 runs (place-in-reviews) for a given user, newest first.
 *  Each entry is a replayable pipeline root. */
export async function listReplayableRuns(userId: number, limit = 20): Promise<ReplayableRun[]> {
  const { rows } = await getPool().query<{
    id: number; created_at: Date; proposals_count: number; source_title: string | null;
    proposals_json: unknown;
  }>(
    `SELECT id, created_at, proposals_count, source_title, proposals_json
     FROM ai_analysis_logs
     WHERE skill_slug = 'suivitess-place-in-reviews'
       AND user_id = $1
       AND proposals_count > 0
       AND error IS NULL
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map(r => ({
    t2LogId: r.id,
    createdAt: r.created_at.toISOString(),
    proposalsCount: r.proposals_count,
    label: r.source_title || `Import #${r.id}`,
    subjectsPreview: extractTopTitles(r.proposals_json, 3),
  }));
}

function extractTopTitles(proposalsJson: unknown, n: number): string[] {
  if (!Array.isArray(proposalsJson)) return [];
  // T2 proposals_json = ReviewPlacement[] — no `title` field directly.
  // We fall back to `reason` which typically cites the topic, or nothing.
  return proposalsJson.slice(0, n)
    .map(p => {
      const reason = (p as { reason?: string }).reason ?? '';
      return reason.slice(0, 80);
    })
    .filter(Boolean);
}

// ── Types replicated from analyzeSourcePipeline to avoid a circular import.

interface ExtractedSubject {
  index: number;
  title: string;
  rawQuotes: string[];
  participants: string[];
  entities: string[];
  statusHint: string | null;
  responsibilityHint: string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface ReviewPlacement {
  subjectIndex: number;
  reviewId?: string;
  suggestedNewReviewTitle?: string;
  sectionId?: string;
  suggestedNewSectionName?: string;
  subjectAction: 'new-subject' | 'update-existing-subject';
  targetSubjectId?: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface T2InputCtx {
  reviews?: Array<{ id: string; title: string; description: string | null; sections: Array<{ id: string; name: string; subjects: Array<{ id: string; title: string; status: string; situationExcerpt: string }> }> }>;
  subjects?: ExtractedSubject[];
}

export interface ReplayedProposal {
  title: string;
  situation: string;
  status: string;
  responsibility: string | null;
  action: 'new-review' | 'existing-review';
  reviewId: string | null;
  suggestedNewReviewTitle: string | null;
  sectionAction: 'new-section' | 'existing-section';
  sectionId: string | null;
  suggestedNewSectionName: string | null;
  subjectAction: 'new-subject' | 'update-existing-subject';
  targetSubjectId: string | null;
  updatedSituation: string | null;
  updatedStatus: string | null;
  updatedResponsibility: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  sourceRawQuotes: string[];
  sourceEntities: string[];
  sourceParticipants: string[];
  aiProposedReviewId: string | null;
  aiProposedReviewTitle: string | null;
}

export interface ReplayResult {
  summary: string;
  subjects: ReplayedProposal[];
  logId: number | null;
  /** Metadata flag so the frontend can display a "Replayed from log #N" banner. */
  replayedFromLogId: number;
}

/** Reconstruct a pipeline result from a T2 log id. Reads the T2 log's
 *  stored input + output + every T3 child (writers) and stitches them
 *  into `FinalReviewProposal` shape. Never calls the LLM. */
export async function replayFromT2Log(t2LogId: number, userId: number): Promise<ReplayResult | null> {
  const { rows: t2Rows } = await getPool().query<{
    id: number; input_content: string; proposals_json: unknown; user_id: number;
  }>(
    `SELECT id, input_content, proposals_json, user_id
     FROM ai_analysis_logs
     WHERE id = $1 AND skill_slug = 'suivitess-place-in-reviews'
     LIMIT 1`,
    [t2LogId],
  );
  const t2 = t2Rows[0];
  if (!t2) return null;
  if (t2.user_id !== userId) return null; // isolation — can't replay someone else's run

  // Parse the T2 input to recover the subjects the skill saw.
  let t2Ctx: T2InputCtx = {};
  try { t2Ctx = JSON.parse(t2.input_content); } catch { /* fall-through → empty */ }
  const subjects: ExtractedSubject[] = Array.isArray(t2Ctx.subjects) ? t2Ctx.subjects : [];

  const placements: ReviewPlacement[] = Array.isArray(t2.proposals_json)
    ? (t2.proposals_json as ReviewPlacement[])
    : [];

  // Fetch every T3 writer log that has this T2 as parent. They carry the
  // composed situation / appendText for each placement.
  const { rows: t3Rows } = await getPool().query<{
    id: number; skill_slug: string; proposals_json: unknown; created_at: Date;
  }>(
    `SELECT id, skill_slug, proposals_json, created_at
     FROM ai_analysis_logs
     WHERE parent_log_id = $1
       AND (skill_slug = 'suivitess-compose-situation' OR skill_slug = 'suivitess-append-situation')
     ORDER BY created_at ASC, id ASC`,
    [t2LogId],
  );

  // T3 writers don't carry their subjectIndex back — we pair by position
  // (same order as the placement loop in the live orchestrator, which
  // fires Promise.all with an index-preserving map).
  // This is brittle if the DB ordering drifts ; we fall back to empty
  // situations when a writer log is missing.
  const subjectProposals: ReplayedProposal[] = [];
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const subj = subjects[p.subjectIndex];
    if (!subj) continue;

    const writer = t3Rows[i]; // best-effort positional match
    const writerOut = writer?.proposals_json as { situation?: string; appendText?: string } | null;

    const isUpdate = p.subjectAction === 'update-existing-subject';
    const reviewAction: 'new-review' | 'existing-review' = p.reviewId ? 'existing-review' : 'new-review';
    const sectionAction: 'new-section' | 'existing-section' = p.sectionId ? 'existing-section' : 'new-section';
    const status = subj.statusHint ?? '🟡 en cours';
    const responsibility = subj.responsibilityHint ?? null;

    if (isUpdate) {
      subjectProposals.push({
        title: subj.title,
        situation: '',
        status,
        responsibility,
        action: reviewAction,
        reviewId: p.reviewId ?? null,
        suggestedNewReviewTitle: p.suggestedNewReviewTitle ?? null,
        sectionAction,
        sectionId: p.sectionId ?? null,
        suggestedNewSectionName: p.suggestedNewSectionName ?? null,
        subjectAction: 'update-existing-subject',
        targetSubjectId: p.targetSubjectId ?? null,
        updatedSituation: writerOut?.appendText ?? null,
        updatedStatus: null,
        updatedResponsibility: null,
        confidence: p.confidence,
        reasoning: p.reason,
        sourceRawQuotes: subj.rawQuotes,
        sourceEntities: subj.entities,
        sourceParticipants: subj.participants,
        aiProposedReviewId: p.reviewId ?? null,
        aiProposedReviewTitle: p.suggestedNewReviewTitle ?? null,
      });
    } else {
      subjectProposals.push({
        title: subj.title,
        situation: writerOut?.situation ?? '',
        status,
        responsibility,
        action: reviewAction,
        reviewId: p.reviewId ?? null,
        suggestedNewReviewTitle: p.suggestedNewReviewTitle ?? null,
        sectionAction,
        sectionId: p.sectionId ?? null,
        suggestedNewSectionName: p.suggestedNewSectionName ?? null,
        subjectAction: 'new-subject',
        targetSubjectId: null,
        updatedSituation: null,
        updatedStatus: null,
        updatedResponsibility: null,
        confidence: p.confidence,
        reasoning: p.reason,
        sourceRawQuotes: subj.rawQuotes,
        sourceEntities: subj.entities,
        sourceParticipants: subj.participants,
        aiProposedReviewId: p.reviewId ?? null,
        aiProposedReviewTitle: p.suggestedNewReviewTitle ?? null,
      });
    }
  }

  return {
    summary: `Rejeu de l'import #${t2LogId} : ${subjectProposals.length} sujet(s) restitué(s) sans appel IA.`,
    subjects: subjectProposals,
    logId: t2LogId,
    replayedFromLogId: t2LogId,
  };
}
