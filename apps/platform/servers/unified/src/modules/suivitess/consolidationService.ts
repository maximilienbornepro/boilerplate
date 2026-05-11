// Cross-source inbox consolidation.
//
// One-shot LLM call : take every PENDING inbox row matching the user's
// active filters, hand them all to the cross-source-consolidate skill,
// get back a deduplicated, theme-merged view that the user can validate
// from a single modal.
//
// Apply behaviour (refactored) : applying a consolidation NO LONGER
// creates subjects/sections/reviews directly. Instead, we materialize
// the consolidated subjects as a NEW inbox row (source_kind =
// 'consolidation') and flip every contributing row to `accepted`. The
// user then validates the new row one-by-one through the existing
// per-row Valider flow — preserving every safety check (auto-apply
// of update-existing-subject, BulkTranscriptionImportModal for the
// new-subject ones).

import { runSkill } from '../aiSkills/runSkill.js';
import * as autoImportDb from './autoImportDbService.js';
import { buildReviewsSnapshotForAI } from './reviewSnapshotBuilder.js';
import * as db from './dbService.js';
import type { AutoImportSource, InboxProposalStatus } from './autoImportDbService.js';

// ────────────────────────────────────────────────────────────────────
// Types — exported so routes.ts and the frontend can share shapes.
// ────────────────────────────────────────────────────────────────────

export interface ConsolidationFilter {
  sourceKind?: AutoImportSource;
  documentId?: string;
}

export interface ConsolidatedSubjectMergedFrom {
  rowId: string;
  proposalIndex: number;
  sourceTitle: string;
  /** External source id (Fathom call_id, "outlook:YYYY-MM-DD", etc.) —
   *  hydrated server-side after the model returns its output so the UI
   *  can disambiguate two chips that share the same `sourceTitle` but
   *  point at different inbox rows. The model itself never sees / sets
   *  this. */
  sourceId?: string;
  /** Source kind from the inbox row — same hydration path. */
  sourceKind?: string;
}

export interface ConsolidatedSubject {
  title: string;
  subjectAction: 'new-subject' | 'update-existing-subject';
  reviewId: string | null;
  sectionId: string | null;
  suggestedNewReviewTitle: string | null;
  suggestedNewSectionName: string | null;
  targetSubjectId: string | null;
  situation: string;
  rawQuotes: string[];
  entities: string[];
  mergedFrom: ConsolidatedSubjectMergedFrom[];
  reasoning: string;
}

export interface ConsolidationResult {
  logId: number | null;
  consolidated: ConsolidatedSubject[];
  rowCount: number;
  propsCount: number;
  /** True when the model's JSON output was non-trivial but couldn't be
   *  parsed — usually because the response hit the maxTokens ceiling
   *  and got truncated mid-string. The frontend surfaces this as a
   *  distinct error message so the user understands why they got no
   *  consolidation despite a long wait. */
  truncated?: boolean;
}

export interface ApplyConsolidatedResult {
  /** Id of the newly inserted inbox row that materializes the
   *  consolidated subjects. Null when nothing was applied (every
   *  item had an empty title or similar). */
  newInboxRowId: string | null;
  /** Number of AnalyzedSubject entries placed in the new row's
   *  `proposals` JSONB. */
  proposalsCount: number;
  /** Number of contributing inbox rows that were flipped to
   *  `accepted` (subset of the union of every `mergedFrom[].rowId`). */
  rowsAccepted: number;
  errors: Array<{ title: string; error: string }>;
  /** Id of the persisted `suivitess_consolidation_runs` row that can be
   *  passed to `revertConsolidationRun` to undo every change applied
   *  in this call. `null` when nothing was actually applied. */
  runId: string | null;
}

// ────────────────────────────────────────────────────────────────────
// Undo data — the inverse-operations payload persisted with each apply.
// The new model is dramatically simpler than the legacy one : we only
// need to track the new inbox row to delete + the contributing rows
// whose status we flipped.
// ────────────────────────────────────────────────────────────────────

export interface UndoData {
  /** The inbox row we created to materialize the consolidation. */
  newInboxRowId: string;
  /** Rows we flipped during apply — needed so revert can put them
   *  back to their pre-apply status (a row that was already accepted
   *  before the consolidation must NOT be flipped back to pending). */
  contributingRows: Array<{
    id: string;
    prevStatus: InboxProposalStatus;
  }>;
}

export interface RevertResult {
  /** True when the new inbox row was actually deleted. */
  inboxRowDeleted: boolean;
  /** Count of contributing rows whose status was restored. */
  rowsRestored: number;
  errors: Array<{ step: string; error: string }>;
}

export interface ConsolidationRunSummary {
  id: string;
  appliedAt: string;
  revertedAt: string | null;
  aiLogId: number | null;
  summary: {
    /** Count of contributing rows captured at apply time. */
    rowsAccepted: number;
  };
}

// ────────────────────────────────────────────────────────────────────
// Output parser — defensive, the model sometimes wraps the JSON in
// markdown fences or adds a trailing comment despite the prompt.
// ────────────────────────────────────────────────────────────────────

/** Extracts and parses the consolidated array from raw model output.
 *  Returns [] on any structural issue — the caller surfaces it as
 *  "no consolidation found" rather than crashing. */
export function parseConsolidationOutput(raw: string): ConsolidatedSubject[] {
  if (!raw || typeof raw !== 'string') return [];
  // Strip ``` fences if any.
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  // Find the first '{' and the last '}'.
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return [];
  }
  const root = parsed as { consolidated?: unknown };
  if (!root || !Array.isArray(root.consolidated)) return [];
  const items = root.consolidated as unknown[];
  const out: ConsolidatedSubject[] = [];
  for (const it of items) {
    const o = it as Record<string, unknown>;
    if (!o || typeof o !== 'object') continue;
    const title = String(o.title ?? '').trim();
    if (!title) continue;
    const mergedRaw = Array.isArray(o.mergedFrom) ? (o.mergedFrom as unknown[]) : [];
    const mergedFrom: ConsolidatedSubjectMergedFrom[] = [];
    for (const m of mergedRaw) {
      const mm = m as Record<string, unknown>;
      if (!mm || typeof mm !== 'object') continue;
      const rowId = typeof mm.rowId === 'string' ? mm.rowId : '';
      const proposalIndex = typeof mm.proposalIndex === 'number' ? mm.proposalIndex : -1;
      if (!rowId || proposalIndex < 0) continue;
      mergedFrom.push({
        rowId,
        proposalIndex,
        sourceTitle: typeof mm.sourceTitle === 'string' ? mm.sourceTitle : '',
      });
    }
    if (mergedFrom.length === 0) continue;
    const subjectAction = o.subjectAction === 'update-existing-subject'
      ? 'update-existing-subject'
      : 'new-subject';
    out.push({
      title,
      subjectAction,
      reviewId: typeof o.reviewId === 'string' ? o.reviewId : null,
      sectionId: typeof o.sectionId === 'string' ? o.sectionId : null,
      suggestedNewReviewTitle: typeof o.suggestedNewReviewTitle === 'string'
        ? o.suggestedNewReviewTitle : null,
      suggestedNewSectionName: typeof o.suggestedNewSectionName === 'string'
        ? o.suggestedNewSectionName : null,
      targetSubjectId: typeof o.targetSubjectId === 'string' ? o.targetSubjectId : null,
      situation: typeof o.situation === 'string' ? o.situation : '',
      rawQuotes: Array.isArray(o.rawQuotes) ? (o.rawQuotes as unknown[]).map(String) : [],
      entities: Array.isArray(o.entities) ? (o.entities as unknown[]).map(String) : [],
      mergedFrom,
      reasoning: typeof o.reasoning === 'string' ? o.reasoning : '',
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Validation — drop outputs that violate hard rules (cross-targetSubjectId
// fusion in particular is a non-negotiable safety guarantee).
// ────────────────────────────────────────────────────────────────────

/** Drop any consolidated subject that fuses two `update-existing-subject`
 *  proposals targeting different `targetSubjectId`s — that's a hard
 *  safety violation per the prompt rules. We replace the offending entry
 *  with N solo entries (one per merged source) so the user still sees
 *  the proposals. Pure function, easy to test. */
export function enforceNeverFuseDifferentTargets(
  consolidated: ConsolidatedSubject[],
  rowProposalIndex: Map<string, Array<{ subjectAction: string; targetSubjectId: string | null }>>,
): ConsolidatedSubject[] {
  const out: ConsolidatedSubject[] = [];
  for (const c of consolidated) {
    if (c.mergedFrom.length <= 1) {
      out.push(c);
      continue;
    }
    // Collect the underlying targetSubjectIds for every merged source.
    const updateTargets = new Set<string>();
    for (const m of c.mergedFrom) {
      const props = rowProposalIndex.get(m.rowId) ?? [];
      const p = props[m.proposalIndex];
      if (p && p.subjectAction === 'update-existing-subject' && p.targetSubjectId) {
        updateTargets.add(p.targetSubjectId);
      }
    }
    if (updateTargets.size > 1) {
      // Violation — split back into solos. Each solo keeps the leader's
      // copy fields but with a single mergedFrom entry; the apply path
      // will use the row's own original proposal at that index.
      for (const m of c.mergedFrom) {
        out.push({ ...c, mergedFrom: [m] });
      }
    } else {
      out.push(c);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// consolidatePendingForUser — main entry point.
// ────────────────────────────────────────────────────────────────────

/** Snapshot the user's pending inbox + run the consolidation skill. */
export async function consolidatePendingForUser(
  userId: number,
  userEmail: string | null,
  isAdmin: boolean,
  filter: ConsolidationFilter,
): Promise<ConsolidationResult> {
  // 1) Pull the matching pending rows.
  const rows = await autoImportDb.listInboxProposals({
    userId,
    status: 'pending',
    sourceKind: filter.sourceKind,
    documentId: filter.documentId,
    limit: 500,
  });
  if (rows.length === 0) {
    return { logId: null, consolidated: [], rowCount: 0, propsCount: 0 };
  }

  // 2) Build the LLM payload. Each row is flattened into a compact shape
  //    the skill knows about. We strip pushy fields the skill doesn't
  //    need (createdAt, status, ai_log_id) to keep the prompt lean.
  const rowsPayload = rows.map(r => {
    const proposals = (Array.isArray(r.proposals) ? r.proposals : []) as Array<Record<string, unknown>>;
    return {
      rowId: r.id,
      sourceTitle: r.sourceTitle ?? r.sourceId,
      sourceKind: r.sourceKind,
      sourceDate: r.sourceDate,
      proposals: proposals.map((p, i) => ({
        index: i,
        title: typeof p.title === 'string' ? p.title : '',
        subjectAction: p.subjectAction === 'update-existing-subject'
          ? 'update-existing-subject' : 'new-subject',
        reviewId: typeof p.reviewId === 'string' ? p.reviewId : null,
        sectionId: typeof p.sectionId === 'string' ? p.sectionId : null,
        suggestedNewReviewTitle: typeof p.suggestedNewReviewTitle === 'string'
          ? p.suggestedNewReviewTitle : null,
        suggestedNewSectionName: typeof p.suggestedNewSectionName === 'string'
          ? p.suggestedNewSectionName : null,
        targetSubjectId: typeof p.targetSubjectId === 'string' ? p.targetSubjectId : null,
        rawQuotes: Array.isArray(p.sourceRawQuotes) ? p.sourceRawQuotes
          : Array.isArray(p.rawQuotes) ? p.rawQuotes : [],
        entities: Array.isArray(p.sourceEntities) ? p.sourceEntities
          : Array.isArray(p.entities) ? p.entities : [],
        participants: Array.isArray(p.sourceParticipants) ? p.sourceParticipants
          : Array.isArray(p.participants) ? p.participants : [],
        situation: typeof p.situation === 'string' ? p.situation : '',
      })),
    };
  });

  const reviews = await buildReviewsSnapshotForAI({ userId, isAdmin, db });

  const propsCount = rowsPayload.reduce((acc, r) => acc + r.proposals.length, 0);

  // 3) Chunk the rows so each LLM call fits comfortably in the 16k
  //    output budget. The cap was hitting on 19 rows × ~115 props
  //    (60k input tokens → 16k output truncated). We size each chunk
  //    by total `proposals` count so dense rows don't make the output
  //    overshoot. The trade-off : two rows about the same business
  //    topic that land in different chunks won't be cross-merged ; in
  //    practice this is rare and the alternative (silent truncation
  //    returning [] consolidated) is strictly worse.
  const MAX_PROPS_PER_CHUNK = 40;
  const MAX_ROWS_PER_CHUNK = 8;
  const chunks: typeof rowsPayload[] = [];
  let current: typeof rowsPayload = [];
  let currentProps = 0;
  for (const r of rowsPayload) {
    const rProps = r.proposals.length;
    if (current.length > 0
        && (currentProps + rProps > MAX_PROPS_PER_CHUNK
            || current.length >= MAX_ROWS_PER_CHUNK)) {
      chunks.push(current);
      current = [];
      currentProps = 0;
    }
    current.push(r);
    currentProps += rProps;
  }
  if (current.length > 0) chunks.push(current);

  // Build the (rowId → proposals) index ONCE — used by the safety
  // enforcer across every chunk result.
  const rowIndex = new Map<string, Array<{ subjectAction: string; targetSubjectId: string | null }>>();
  for (const r of rowsPayload) {
    rowIndex.set(r.rowId, r.proposals.map(p => ({
      subjectAction: p.subjectAction,
      targetSubjectId: p.targetSubjectId,
    })));
  }

  // Run all chunks IN PARALLEL — they're independent (each gets the
  // same reviews snapshot and is self-contained). Sequential runs
  // pushed the total wall-clock past the nginx gateway timeout (504)
  // on dense backlogs. Parallel = max(chunk_time) instead of sum.
  const chunkResults = await Promise.all(chunks.map((chunkRows, ci) => {
    const chunkProps = chunkRows.reduce((a, r) => a + r.proposals.length, 0);
    const inputJson = JSON.stringify({ rows: chunkRows, reviews }, null, 2);
    return runSkill({
      slug: 'suivitess-cross-source-consolidate',
      userId,
      userEmail: userEmail ?? null,
      sourceKind: 'inbox-consolidation',
      sourceTitle: chunks.length === 1
        ? `Inbox consolidation (${chunkRows.length} rows, ${chunkProps} props)`
        : `Inbox consolidation chunk ${ci + 1}/${chunks.length} (${chunkRows.length} rows, ${chunkProps} props)`,
      documentId: filter.documentId ?? null,
      inputContent: inputJson,
      buildContext: () => `## Contexte\n\n\`\`\`json\n${inputJson}\n\`\`\``,
      maxTokens: 16000,
    });
  }));

  let aggregateConsolidated: ConsolidatedSubject[] = [];
  let anyTruncated = false;
  let firstLogId: number | null = null;
  for (const run of chunkResults) {
    if (firstLogId === null) firstLogId = run.logId;
    const parsed = parseConsolidationOutput(run.outputText);
    const looksTruncated =
      parsed.length === 0
      && typeof run.outputText === 'string'
      && run.outputText.length > 2000
      && !/\]\s*\}\s*```?\s*$/.test(run.outputText.trimEnd());
    if (looksTruncated) anyTruncated = true;
    const safe = enforceNeverFuseDifferentTargets(parsed, rowIndex);
    aggregateConsolidated = aggregateConsolidated.concat(safe);
  }

  // Hydrate every `mergedFrom[].sourceId` + `sourceKind` from the
  // original inbox rows so the modal can disambiguate two chips that
  // happen to share a generic title.
  const rowMeta = new Map<string, { sourceId: string; sourceKind: string }>();
  for (const r of rows) {
    rowMeta.set(r.id, { sourceId: r.sourceId, sourceKind: r.sourceKind });
  }
  for (const c of aggregateConsolidated) {
    for (const m of c.mergedFrom) {
      const meta = rowMeta.get(m.rowId);
      if (meta) {
        m.sourceId = meta.sourceId;
        m.sourceKind = meta.sourceKind;
      }
    }
  }

  return {
    logId: firstLogId,
    consolidated: aggregateConsolidated,
    rowCount: rows.length,
    propsCount,
    truncated: anyTruncated || undefined,
  };
}

// ────────────────────────────────────────────────────────────────────
// Helpers for the new "materialize as inbox row" apply path.
// ────────────────────────────────────────────────────────────────────

/** Shape that `suivitess_inbox_proposals.proposals` JSONB carries —
 *  matches the frontend `AnalyzedSubject` shape so the existing
 *  per-row Valider flow + BulkTranscriptionImportModal consume the
 *  new consolidated row as if it came from a regular source. */
export interface AnalyzedSubjectShape {
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
  sourceRawQuotes?: string[];
  sourceEntities?: string[];
  sourceParticipants?: string[];
  aiProposedReviewId?: string | null;
  aiProposedReviewTitle?: string | null;
}

/** Map one consolidated subject to the AnalyzedSubject shape that the
 *  inbox row's `proposals` JSONB expects. The contributing original
 *  proposals are passed in so we can union their sourceRawQuotes /
 *  sourceEntities / sourceParticipants — preserving the routing-memory
 *  context that would otherwise be lost. Pure function, easy to test. */
export function consolidatedToAnalyzedSubject(
  c: ConsolidatedSubject,
  contributingOriginals: Array<Record<string, unknown>>,
): AnalyzedSubjectShape {
  // Union the source-context arrays from the contributing originals.
  // Dedupe via Set so we don't carry the same quote twice when the
  // AI merged two near-identical proposals.
  const rawQuotes = new Set<string>();
  const entities = new Set<string>();
  const participants = new Set<string>();
  for (const orig of contributingOriginals) {
    const rq = Array.isArray(orig.sourceRawQuotes) ? orig.sourceRawQuotes
      : Array.isArray(orig.rawQuotes) ? orig.rawQuotes : [];
    for (const q of rq) if (typeof q === 'string' && q.length > 0) rawQuotes.add(q);
    const ents = Array.isArray(orig.sourceEntities) ? orig.sourceEntities
      : Array.isArray(orig.entities) ? orig.entities : [];
    for (const e of ents) if (typeof e === 'string' && e.length > 0) entities.add(e);
    const parts = Array.isArray(orig.sourceParticipants) ? orig.sourceParticipants
      : Array.isArray(orig.participants) ? orig.participants : [];
    for (const p of parts) if (typeof p === 'string' && p.length > 0) participants.add(p);
  }

  const isUpdate = c.subjectAction === 'update-existing-subject';
  return {
    title: c.title,
    situation: c.situation,
    status: '🔴 à faire',
    responsibility: null,
    action: c.reviewId ? 'existing-review' : 'new-review',
    reviewId: c.reviewId,
    suggestedNewReviewTitle: c.suggestedNewReviewTitle,
    sectionAction: c.sectionId ? 'existing-section' : 'new-section',
    sectionId: c.sectionId,
    suggestedNewSectionName: c.suggestedNewSectionName,
    subjectAction: c.subjectAction,
    targetSubjectId: c.targetSubjectId,
    updatedSituation: isUpdate ? c.situation : null,
    updatedStatus: null,
    updatedResponsibility: null,
    // The AI already filtered for redundancy across sources — by the
    // time we reach this branch, confidence is implicitly high.
    confidence: 'high',
    reasoning: c.reasoning,
    sourceRawQuotes: Array.from(rawQuotes),
    sourceEntities: Array.from(entities),
    sourceParticipants: Array.from(participants),
    aiProposedReviewId: c.reviewId,
    aiProposedReviewTitle: c.suggestedNewReviewTitle,
  };
}

/** Pick a `primaryDocumentId` for the new inbox row. Majority vote of
 *  the consolidated subjects' `reviewId` (ties → first non-null).
 *  Fallback : first contributing inbox row's `documentId` when every
 *  subject is `new-review` (no reviewId). Pure function. */
export function pickPrimaryDocumentId(
  items: ConsolidatedSubject[],
  contributingRowDocIds: Map<string, string>,
): string | null {
  const votes = new Map<string, number>();
  for (const c of items) {
    if (c.reviewId) {
      votes.set(c.reviewId, (votes.get(c.reviewId) ?? 0) + 1);
    }
  }
  if (votes.size > 0) {
    // Order: highest vote count first, ties broken by insertion order
    // (which mirrors the iteration order over `items` — first non-null
    // wins on a tie, as the requirements demand).
    let winner: string | null = null;
    let winnerCount = -1;
    for (const [id, count] of votes) {
      if (count > winnerCount) {
        winner = id;
        winnerCount = count;
      }
    }
    if (winner) return winner;
  }
  // Fallback : first contributing row's documentId.
  for (const c of items) {
    for (const m of c.mergedFrom) {
      const docId = contributingRowDocIds.get(m.rowId);
      if (docId) return docId;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// applyConsolidatedSubjects — materialize as a NEW inbox row.
// ────────────────────────────────────────────────────────────────────

/** Apply the user-accepted consolidated subjects by materializing them
 *  as a NEW inbox row that the user will then validate one-by-one
 *  through the existing per-row Valider flow.
 *
 *  Steps :
 *    1. Map each ConsolidatedSubject → AnalyzedSubject shape, unioning
 *       source-context arrays from the contributing originals.
 *    2. Pick a `primaryDocumentId` (majority vote of reviewIds).
 *    3. Insert ONE new row in `suivitess_inbox_proposals` with
 *       `source_kind = 'consolidation'`.
 *    4. Flip every distinct contributing row to `accepted`.
 *    5. Persist the undo data so revert can put everything back.
 */
export async function applyConsolidatedSubjects(
  userId: number,
  items: ConsolidatedSubject[],
  logId?: number | null,
): Promise<ApplyConsolidatedResult> {
  const result: ApplyConsolidatedResult = {
    newInboxRowId: null,
    proposalsCount: 0,
    rowsAccepted: 0,
    errors: [],
    runId: null,
  };
  if (!Array.isArray(items) || items.length === 0) return result;

  // Filter out empty-title items up-front — they'd be useless in the
  // new inbox row's proposals and confuse the per-row Valider flow.
  const validItems: ConsolidatedSubject[] = [];
  for (const c of items) {
    const title = (c.title || '').trim();
    if (!title) {
      result.errors.push({ title: '', error: 'Titre vide' });
      continue;
    }
    validItems.push(c);
  }
  if (validItems.length === 0) return result;

  // 1) Resolve the union of contributing row ids.
  const contributingRowIds = new Set<string>();
  for (const c of validItems) {
    for (const m of c.mergedFrom) contributingRowIds.add(m.rowId);
  }
  if (contributingRowIds.size === 0) {
    result.errors.push({ title: '', error: 'Aucune ligne source identifiée' });
    return result;
  }

  // 2) Load every contributing row up-front : we need their original
  //    proposals JSONB to union sourceRawQuotes/sourceEntities, and we
  //    need their current status to capture pre-flip undo data.
  const contributingRows = new Map<string, autoImportDb.InboxProposal>();
  for (const rowId of contributingRowIds) {
    try {
      const row = await autoImportDb.getInboxProposal(rowId, userId);
      if (row) contributingRows.set(rowId, row);
    } catch {
      // Skip missing rows — they probably got deleted between
      // consolidate-pending and apply.
    }
  }
  if (contributingRows.size === 0) {
    result.errors.push({ title: '', error: 'Aucune ligne source accessible' });
    return result;
  }

  // 3) Map each consolidated subject → AnalyzedSubject shape.
  const analyzedSubjects: AnalyzedSubjectShape[] = [];
  for (const c of validItems) {
    const originals: Array<Record<string, unknown>> = [];
    for (const m of c.mergedFrom) {
      const row = contributingRows.get(m.rowId);
      if (!row) continue;
      const props = Array.isArray(row.proposals) ? row.proposals : [];
      const orig = props[m.proposalIndex];
      if (orig && typeof orig === 'object') {
        originals.push(orig as Record<string, unknown>);
      }
    }
    analyzedSubjects.push(consolidatedToAnalyzedSubject(c, originals));
  }

  // 4) Pick the new inbox row's documentId.
  const rowDocIds = new Map<string, string>();
  for (const [id, row] of contributingRows) rowDocIds.set(id, row.documentId);
  const primaryDocumentId = pickPrimaryDocumentId(validItems, rowDocIds);
  if (!primaryDocumentId) {
    result.errors.push({ title: '', error: 'Impossible de résoudre le document principal' });
    return result;
  }

  // 5) Insert the new consolidated inbox row.
  const consolidationSourceId = `consolidation:${logId ?? 'noid'}:${Date.now()}`;
  const title = `Consolidation IA · ${validItems.length} sujet(s) issus de ${contributingRowIds.size} lignes`;
  let newRow: autoImportDb.InboxProposal | null = null;
  try {
    newRow = await autoImportDb.insertInboxProposal({
      userId,
      documentId: primaryDocumentId,
      // `source_kind` is plain TEXT in the schema with no CHECK
      // constraint, so we can introduce a new value here without a
      // migration. We cast through `unknown` because the helper's
      // typed union doesn't (yet) include 'consolidation'.
      sourceKind: 'consolidation' as unknown as AutoImportSource,
      sourceId: consolidationSourceId,
      sourceTitle: title,
      sourceDate: new Date().toISOString(),
      proposals: analyzedSubjects,
      aiLogId: logId ?? null,
    });
  } catch (err) {
    result.errors.push({ title: '', error: `Insertion impossible : ${(err as Error).message}` });
    return result;
  }
  if (!newRow) {
    result.errors.push({ title: '', error: 'Insertion impossible (conflit unique)' });
    return result;
  }
  result.newInboxRowId = newRow.id;
  result.proposalsCount = analyzedSubjects.length;

  // 6) Flip every contributing row to accepted, capturing previous
  //    status for revert.
  const undoData: UndoData = {
    newInboxRowId: newRow.id,
    contributingRows: [],
  };
  for (const [rowId, row] of contributingRows) {
    // Capture prev status BEFORE the flip so revert can put a row
    // that was already accepted before consolidation back to that
    // exact status rather than incorrectly flipping it to pending.
    const prevStatus = row.status;
    try {
      const flipped = await autoImportDb.setInboxProposalStatus(rowId, userId, 'accepted');
      if (flipped) {
        undoData.contributingRows.push({ id: rowId, prevStatus });
        result.rowsAccepted++;
      }
    } catch {
      // best effort
    }
  }

  // 7) Persist the run (always, because we always have at least the
  //    new inbox row to delete on revert).
  try {
    const r = await db.pool.query<{ id: string }>(
      `INSERT INTO suivitess_consolidation_runs (user_id, ai_log_id, undo_data)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [userId, logId ?? null, JSON.stringify(undoData)],
    );
    result.runId = r.rows[0]?.id ?? null;
  } catch (err) {
    console.warn('[consolidation] failed to persist run:', (err as Error).message);
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────
// revertConsolidationRun — undo a previous apply.
// ────────────────────────────────────────────────────────────────────

/** Revert every change recorded by a previous `applyConsolidatedSubjects` :
 *    1. Delete the new inbox row we created.
 *    2. Flip every contributing row back to its pre-apply status.
 *    3. Mark `reverted_at = NOW()` so we cannot double-revert.
 *
 *  Each step is wrapped in its own try/catch so a single failure does
 *  not abort the rest — partial revert is better than nothing. */
export async function revertConsolidationRun(
  userId: number,
  runId: string,
): Promise<RevertResult> {
  const result: RevertResult = {
    inboxRowDeleted: false,
    rowsRestored: 0,
    errors: [],
  };

  // 1. Load the run row (scoped to the caller).
  const r = await db.pool.query<{ id: string; undo_data: UndoData; reverted_at: Date | null }>(
    `SELECT id, undo_data, reverted_at
       FROM suivitess_consolidation_runs
      WHERE id = $1 AND user_id = $2`,
    [runId, userId],
  );
  if (r.rowCount === 0) {
    throw new Error('Consolidation introuvable');
  }
  if (r.rows[0].reverted_at) {
    throw new Error('Cette consolidation a déjà été annulée');
  }
  const undo = r.rows[0].undo_data;

  // 2. Delete the new inbox row.
  if (undo.newInboxRowId) {
    try {
      const del = await db.pool.query(
        `DELETE FROM suivitess_inbox_proposals WHERE id = $1 AND user_id = $2`,
        [undo.newInboxRowId, userId],
      );
      if ((del.rowCount ?? 0) > 0) result.inboxRowDeleted = true;
    } catch (err) {
      result.errors.push({ step: `delete-inbox-row:${undo.newInboxRowId}`, error: (err as Error).message });
    }
  }

  // 3. Restore inbox row statuses. setInboxProposalStatus accepts
  //    'pending'/'accepted'/'rejected'.
  for (const row of undo.contributingRows ?? []) {
    try {
      const restored = await autoImportDb.setInboxProposalStatus(
        row.id,
        userId,
        row.prevStatus,
      );
      if (restored) result.rowsRestored++;
    } catch (err) {
      result.errors.push({ step: `restore-row:${row.id}`, error: (err as Error).message });
    }
  }

  // 4. Mark the run as reverted so we cannot double-revert.
  await db.pool.query(
    'UPDATE suivitess_consolidation_runs SET reverted_at = NOW() WHERE id = $1',
    [runId],
  );

  return result;
}

// ────────────────────────────────────────────────────────────────────
// listConsolidationRuns — used by the optional history endpoint.
// ────────────────────────────────────────────────────────────────────

export async function listConsolidationRuns(
  userId: number,
  limit = 10,
): Promise<ConsolidationRunSummary[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const r = await db.pool.query<{
    id: string;
    applied_at: Date;
    reverted_at: Date | null;
    ai_log_id: number | null;
    undo_data: UndoData;
  }>(
    `SELECT id, applied_at, reverted_at, ai_log_id, undo_data
       FROM suivitess_consolidation_runs
      WHERE user_id = $1
      ORDER BY applied_at DESC
      LIMIT $2`,
    [userId, safeLimit],
  );
  return r.rows.map(row => ({
    id: row.id,
    appliedAt: row.applied_at.toISOString(),
    revertedAt: row.reverted_at ? row.reverted_at.toISOString() : null,
    aiLogId: row.ai_log_id,
    summary: {
      rowsAccepted: row.undo_data?.contributingRows?.length ?? 0,
    },
  }));
}
