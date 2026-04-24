// Per-import AI-vs-user routing comparison.
//
// Merges three data sources for one `ai_analysis_logs` row:
//   1. `proposals_json` on the log itself — the AI's original decisions
//      per subject (review + section + subjectAction).
//   2. `suivitess_routing_memory` rows with matching `log_id` —
//      the user's final committed decisions, indexed by proposal_index.
//   3. `routingMemoryService.retrieveSimilar` per subject — the top-K
//      past decisions that the RAG would have injected as few-shot
//      examples, demonstrating whether the system is already learning
//      from past corrections.
//
// Produces the payload consumed by /ai-routing's three-column table.

import pg from 'pg';
import { config } from '../../config.js';
import type { AnalysisLogRow } from './analysisLogsService.js';

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: config.appDatabaseUrl });
  return pool;
}

/** AI side — one entry per proposal in `proposals_json`. */
export interface AiProposal {
  proposalIndex: number;
  subjectTitle: string;
  situationExcerpt: string | null;
  reviewAction: 'new-review' | 'existing-review' | null;
  reviewId: string | null;
  reviewTitle: string | null;
  sectionAction: 'new-section' | 'existing-section' | null;
  sectionId: string | null;
  sectionName: string | null;
  subjectAction: 'new-subject' | 'update-existing-subject' | null;
  targetSubjectId: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  reasoning: string | null;
}

/** User side — pulled from `suivitess_routing_memory`. Null when the
 *  user never committed this proposition (skipped). */
export interface UserDecision {
  memoryId: string;
  subjectTitle: string;
  targetDocumentId: string;
  targetDocumentTitle: string;
  targetSectionId: string | null;
  targetSectionName: string;
  targetSubjectAction: 'new-subject' | 'update-existing-subject';
  userOverrodeAi: boolean;
  createdAt: string;
}

/** RAG retrieval — shows what past decisions the system already knows
 *  about this subject. Ideally the user's correction is already in
 *  here, meaning the system is learning automatically. */
export interface SimilarPastDecision {
  id: string;
  subjectTitle: string;
  targetDocumentTitle: string;
  targetSectionName: string;
  targetSubjectAction: 'new-subject' | 'update-existing-subject';
  similarity: number;
  createdAt: string;
}

export interface ComparisonRow {
  proposalIndex: number;
  ai: AiProposal;
  user: UserDecision | null;
  similarPastDecisions: SimilarPastDecision[];
  /** Convenience flag: true when `user` exists AND differs from `ai` at
   *  either the review or section or subject level. Frontend uses it to
   *  highlight rows where the user overrode the AI. */
  userOverrodeAi: boolean;
}

export interface ComparisonResult {
  logId: number;
  skillSlug: string;
  sourceKind: string | null;
  sourceTitle: string | null;
  createdAt: string;
  totalProposals: number;
  totalCommitted: number;
  totalOverrides: number;
  rows: ComparisonRow[];
}

/** First non-empty string from a list of candidate field names. The
 *  log's `proposals_json` can hold three distinct shapes depending on
 *  which pipeline tier wrote it last (extractor vs placer vs append),
 *  each with slightly different aliases. Rather than branch per
 *  shape, we walk every known alias until we hit a usable value. */
function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

/** Extract the AI proposals from the log's JSONB payload. Defensive —
 *  `proposals_json` can hold `ExtractedSubject[]` (tier-1 extractor
 *  logs) or `ReviewPlacement[]` / `FinalReviewProposal[]` (tier-2
 *  placer logs) depending on which pipeline stage persisted last via
 *  `attachProposalsToLog`. Tier-2 entries don't carry explicit
 *  `action` / `sectionAction` fields — they're implicit via the
 *  presence of `reviewId` (existing) vs `suggestedNewReviewTitle`
 *  (new), so we derive them on the fly. */
function extractAiProposals(proposalsJson: unknown): AiProposal[] {
  if (!Array.isArray(proposalsJson)) return [];
  return proposalsJson.map((p, i) => {
    const prop = p as Record<string, unknown>;
    const title = firstString(prop, ['title', 'subjectTitle', 'subject_title']);
    const situation = firstString(prop, ['situation', 'situationExcerpt']);

    const reviewId = firstString(prop, ['reviewId', 'aiProposedReviewId', 'targetReviewId']);
    const newReviewTitle = firstString(prop, [
      'suggestedNewReviewTitle',
      'newReviewTitle',
    ]);
    const reviewAction: AiProposal['reviewAction'] =
      (prop.action as AiProposal['reviewAction'])
      ?? (prop.reviewAction as AiProposal['reviewAction'])
      ?? (reviewId ? 'existing-review' : newReviewTitle ? 'new-review' : null);

    const sectionId = firstString(prop, ['sectionId', 'targetSectionId']);
    const newSectionName = firstString(prop, [
      'suggestedNewSectionName',
      'newSectionName',
    ]);
    const sectionAction: AiProposal['sectionAction'] =
      (prop.sectionAction as AiProposal['sectionAction'])
      ?? (sectionId ? 'existing-section' : newSectionName ? 'new-section' : null);

    return {
      proposalIndex: i,
      subjectTitle: title ?? '(sans titre)',
      situationExcerpt: situation ? situation.slice(0, 400) : null,
      reviewAction,
      reviewId,
      reviewTitle: firstString(prop, [
        'aiProposedReviewTitle',
        'reviewTitle',
      ]) ?? newReviewTitle,
      sectionAction,
      sectionId,
      sectionName: firstString(prop, ['sectionName']) ?? newSectionName,
      subjectAction: (prop.subjectAction as AiProposal['subjectAction']) ?? null,
      targetSubjectId: firstString(prop, ['targetSubjectId']),
      confidence: (prop.confidence as AiProposal['confidence']) ?? null,
      reasoning: firstString(prop, ['reasoning', 'rationale', 'reason']),
    };
  });
}

/** Fetch every log in the pipeline tree rooted at `logId` (the log
 *  itself + direct + indirect descendants via parent_log_id). The
 *  pipeline produces a chain: tier-1 extractor → tier-2 placer →
 *  tier-3 append — each tier logs its own row and only the tier-2+
 *  ones carry routing decisions (review/section/subjectAction).
 *  We merge the tree so the comparison table sees the full picture. */
async function fetchLogTree(rootLogId: number): Promise<Array<{
  id: number;
  proposalsJson: unknown;
  createdAt: Date;
}>> {
  const { rows } = await getPool().query<{
    id: number;
    proposals_json: unknown;
    created_at: Date;
  }>(
    `WITH RECURSIVE log_tree AS (
       SELECT id, parent_log_id, proposals_json, created_at FROM ai_analysis_logs WHERE id = $1
       UNION ALL
       SELECT l.id, l.parent_log_id, l.proposals_json, l.created_at
         FROM ai_analysis_logs l
         JOIN log_tree t ON l.parent_log_id = t.id
     )
     SELECT id, proposals_json, created_at FROM log_tree ORDER BY created_at ASC`,
    [rootLogId],
  );
  return rows.map(r => ({ id: r.id, proposalsJson: r.proposals_json, createdAt: r.created_at }));
}

/** A "routing-shaped" log holds proposals with review/section/subjectAction
 *  fields — i.e. it's one of the placer tiers, not the extractor. We
 *  detect by sniffing the first array element. */
function hasRoutingShape(proposalsJson: unknown): boolean {
  if (!Array.isArray(proposalsJson) || proposalsJson.length === 0) return false;
  const p = proposalsJson[0] as Record<string, unknown>;
  return (
    typeof p.action === 'string'
    || typeof p.sectionAction === 'string'
    || typeof p.subjectAction === 'string'
  );
}

/** Merge tier-1 (titles only) and tier-2+ (routing) logs onto a single
 *  proposal array. Tier-2 wins when available; tier-1 fills the title
 *  gap when the later tier lost/renamed it. Proposals are matched by
 *  index — the pipeline preserves ordering across tiers. */
function mergeTierProposals(tiers: Array<{ proposalsJson: unknown; isRouting: boolean }>): unknown[] {
  const extractor = tiers.find(t => !t.isRouting)?.proposalsJson;
  const router = [...tiers].reverse().find(t => t.isRouting)?.proposalsJson;

  // Pick the richer side as the spine; overlay fallback titles from
  // the other. If only one side is non-null, use it verbatim.
  if (Array.isArray(router) && Array.isArray(extractor)) {
    return router.map((rp, i) => {
      const ep = extractor[i] as Record<string, unknown> | undefined;
      const merged = { ...(ep ?? {}), ...(rp as Record<string, unknown>) };
      return merged;
    });
  }
  if (Array.isArray(router)) return router;
  if (Array.isArray(extractor)) return extractor;
  return [];
}

/** Fetch all routing_memory entries persisted for this analysis log. */
async function fetchUserDecisions(logId: number): Promise<Map<number, UserDecision & {
  aiProposedDocumentId: string | null;
  aiProposedDocumentTitle: string | null;
}>> {
  const { rows } = await getPool().query<{
    id: string;
    proposal_index: number | null;
    subject_title: string;
    target_document_id: string;
    target_document_title: string;
    target_section_id: string | null;
    target_section_name: string;
    target_subject_action: 'new-subject' | 'update-existing-subject';
    user_overrode_ai: boolean;
    ai_proposed_document_id: string | null;
    ai_proposed_document_title: string | null;
    created_at: Date;
  }>(
    `SELECT id, proposal_index, subject_title,
            target_document_id, target_document_title,
            target_section_id, target_section_name, target_subject_action,
            user_overrode_ai, ai_proposed_document_id, ai_proposed_document_title,
            created_at
       FROM suivitess_routing_memory
      WHERE log_id = $1`,
    [logId],
  );

  const byIndex = new Map<number, UserDecision & {
    aiProposedDocumentId: string | null;
    aiProposedDocumentTitle: string | null;
  }>();
  for (const row of rows) {
    if (row.proposal_index == null) continue;
    byIndex.set(row.proposal_index, {
      memoryId: row.id,
      subjectTitle: row.subject_title,
      targetDocumentId: row.target_document_id,
      targetDocumentTitle: row.target_document_title,
      targetSectionId: row.target_section_id,
      targetSectionName: row.target_section_name,
      targetSubjectAction: row.target_subject_action,
      userOverrodeAi: row.user_overrode_ai,
      aiProposedDocumentId: row.ai_proposed_document_id,
      aiProposedDocumentTitle: row.ai_proposed_document_title,
      createdAt: row.created_at.toISOString(),
    });
  }
  return byIndex;
}

/** Resolve a set of review/section UUIDs to their human titles in
 *  one round-trip. Returns two maps (reviews, sections) so the
 *  comparison table can render "Suivi Hebdo TV" instead of a UUID
 *  when the log's `proposals_json` only stores ids. */
async function resolveTitles(reviewIds: string[], sectionIds: string[]): Promise<{
  reviews: Map<string, string>;
  sections: Map<string, string>;
}> {
  const reviews = new Map<string, string>();
  const sections = new Map<string, string>();
  if (reviewIds.length > 0) {
    try {
      const { rows } = await getPool().query<{ id: string; title: string }>(
        `SELECT id, title FROM suivitess_documents WHERE id = ANY($1)`,
        [reviewIds],
      );
      for (const r of rows) reviews.set(r.id, r.title);
    } catch { /* titles are best-effort */ }
  }
  if (sectionIds.length > 0) {
    try {
      const { rows } = await getPool().query<{ id: string; name: string }>(
        `SELECT id, name FROM suivitess_sections WHERE id = ANY($1)`,
        [sectionIds],
      );
      for (const r of rows) sections.set(r.id, r.name);
    } catch { /* titles are best-effort */ }
  }
  return { reviews, sections };
}

/** True when the user's decision diverges from the AI's proposal at
 *  any of review / section / subject-action. Used for row highlighting
 *  and the aggregate `totalOverrides` counter. */
function didUserOverride(ai: AiProposal, user: UserDecision | null): boolean {
  if (!user) return false;
  if (user.userOverrodeAi) return true;
  if (ai.subjectAction && ai.subjectAction !== user.targetSubjectAction) return true;
  if (ai.sectionName && user.targetSectionName
      && ai.sectionName.trim().toLowerCase() !== user.targetSectionName.trim().toLowerCase()) return true;
  return false;
}

/** Sidebar feed — most recent logs that have at least one persisted
 *  routing decision. Excludes logs whose proposals were never committed
 *  (skipped or deleted) so the /ai-routing page only lists imports
 *  where there's actually something to compare. */
export interface ComparableLogSummary {
  logId: number;
  skillSlug: string;
  sourceKind: string | null;
  sourceTitle: string | null;
  createdAt: string;
  decisionsCount: number;
  overridesCount: number;
}

export async function listComparableLogs(limit = 100): Promise<ComparableLogSummary[]> {
  const { rows } = await getPool().query<{
    log_id: number;
    skill_slug: string;
    source_kind: string | null;
    source_title: string | null;
    created_at: Date;
    decisions_count: string;
    overrides_count: string;
  }>(
    `SELECT l.id AS log_id, l.skill_slug, l.source_kind, l.source_title, l.created_at,
            COUNT(m.id) AS decisions_count,
            COUNT(*) FILTER (WHERE m.user_overrode_ai) AS overrides_count
       FROM ai_analysis_logs l
       JOIN suivitess_routing_memory m ON m.log_id = l.id
      GROUP BY l.id, l.skill_slug, l.source_kind, l.source_title, l.created_at
      ORDER BY l.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(r => ({
    logId: r.log_id,
    skillSlug: r.skill_slug,
    sourceKind: r.source_kind,
    sourceTitle: r.source_title,
    createdAt: r.created_at.toISOString(),
    decisionsCount: parseInt(r.decisions_count, 10) || 0,
    overridesCount: parseInt(r.overrides_count, 10) || 0,
  }));
}

/** Build the full comparison payload for one log. */
export async function buildRoutingComparison(params: {
  logId: number;
  userId: number;
  log: AnalysisLogRow;
}): Promise<ComparisonResult> {
  const { logId, userId, log } = params;

  // The modal's `lastLogId` typically points to the tier-1 extractor
  // log (only titles + rawQuotes), while review/section/subjectAction
  // live on a tier-2 child log. Walk the whole pipeline tree and merge
  // so the comparison table shows the full AI decision even though the
  // routing_memory rows are keyed on the root id.
  const tree = await fetchLogTree(logId);
  const tierSummaries = tree.map(t => ({
    proposalsJson: t.proposalsJson,
    isRouting: hasRoutingShape(t.proposalsJson),
  }));
  const mergedProposals = tierSummaries.length > 1
    ? mergeTierProposals(tierSummaries)
    : log.proposals_json;
  const aiProposals = extractAiProposals(mergedProposals);
  const userDecisions = await fetchUserDecisions(logId);

  // Tier-2 `ReviewPlacement[]` stores review/section UUIDs but not the
  // human titles — resolve them here so the comparison table shows
  // "Suivi Hebdo TV" instead of an opaque UUID. Collect unique ids
  // first, one DB round-trip each.
  const reviewIdsToResolve = new Set<string>();
  const sectionIdsToResolve = new Set<string>();
  for (const p of aiProposals) {
    if (p.reviewId && !p.reviewTitle) reviewIdsToResolve.add(p.reviewId);
    if (p.sectionId && !p.sectionName) sectionIdsToResolve.add(p.sectionId);
  }
  const titles = await resolveTitles(
    Array.from(reviewIdsToResolve),
    Array.from(sectionIdsToResolve),
  );
  for (const p of aiProposals) {
    if (!p.reviewTitle && p.reviewId) p.reviewTitle = titles.reviews.get(p.reviewId) ?? null;
    if (!p.sectionName && p.sectionId) p.sectionName = titles.sections.get(p.sectionId) ?? null;
  }

  // Top-K retrieval is pgvector-backed and issues one embedding call
  // per row — cap K low and run sequentially to avoid bursting the
  // embedding provider. If anything in the path fails the row still
  // renders with an empty similarPastDecisions array.
  const { retrieveSimilar } = await import('../suivitess/routingMemoryService.js');
  const rows: ComparisonRow[] = [];
  // If the pipeline chain couldn't supply proposals (root log is a
  // standalone writer call, or mutated / null JSONB), synthesise
  // placeholder rows from whatever the user's routing decisions tell
  // us — better than showing an empty page when we know decisions
  // exist for this log id.
  const ensuredProposals = aiProposals.length > 0
    ? aiProposals
    : [...userDecisions.keys()].sort((a, b) => a - b).map(idx => ({
        proposalIndex: idx,
        subjectTitle: userDecisions.get(idx)?.subjectTitle ?? '(sans titre)',
        situationExcerpt: null,
        reviewAction: null,
        reviewId: null,
        reviewTitle: null,
        sectionAction: null,
        sectionId: null,
        sectionName: null,
        subjectAction: null,
        targetSubjectId: null,
        confidence: null,
        reasoning: null,
      } as AiProposal));

  for (const ai of ensuredProposals) {
    const user = userDecisions.get(ai.proposalIndex) ?? null;
    // Final safety net: the log may have dropped the title between
    // tiers (compose rewrites, multi-source reconcile, …). The user's
    // committed subject is the same as what the AI proposed for this
    // index — use it as the visible title when the AI side is blank.
    if ((!ai.subjectTitle || ai.subjectTitle === '(sans titre)') && user?.subjectTitle) {
      ai.subjectTitle = user.subjectTitle;
    }
    // Last-chance review-title fallback: routing_memory persists the
    // ai_proposed_document_title captured at apply-routing time, which
    // survives even when proposals_json got trimmed. Only used when the
    // log side couldn't produce a title at all.
    if (!ai.reviewTitle && user?.aiProposedDocumentTitle) {
      ai.reviewTitle = user.aiProposedDocumentTitle;
      if (!ai.reviewAction) ai.reviewAction = 'existing-review';
    }
    let similar: SimilarPastDecision[] = [];
    try {
      const hits = await retrieveSimilar({
        userId,
        subjectTitle: ai.subjectTitle,
        rawQuotes: [],
        entities: [],
        k: 3,
      });
      similar = hits.map(h => ({
        id: h.id,
        subjectTitle: h.subjectTitle,
        targetDocumentTitle: h.targetDocumentTitle,
        targetSectionName: h.targetSectionName,
        targetSubjectAction: h.targetSubjectAction,
        similarity: h.similarity ?? 0,
        createdAt: h.createdAt,
      }));
    } catch { /* RAG retrieval is best-effort */ }

    rows.push({
      proposalIndex: ai.proposalIndex,
      ai,
      user,
      similarPastDecisions: similar,
      userOverrodeAi: didUserOverride(ai, user),
    });
  }

  const totalCommitted = rows.filter(r => r.user != null).length;
  const totalOverrides = rows.filter(r => r.userOverrodeAi).length;

  return {
    logId,
    skillSlug: log.skill_slug,
    sourceKind: log.source_kind,
    sourceTitle: log.source_title,
    createdAt: log.created_at,
    totalProposals: rows.length,
    totalCommitted,
    totalOverrides,
    rows,
  };
}
