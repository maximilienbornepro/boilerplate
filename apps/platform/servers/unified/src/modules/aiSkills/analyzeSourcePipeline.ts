// ═══════════════════════════════════════════════════════════════════════
// Modular 3-tier AI pipeline for analysing a source (transcript/slack/email).
// This is the ONLY path for suivitess analyse-and-route / analyse-and-propose
// since we removed the legacy monolithic skill `suivitess-import-source-into-
// document` as a runtime dependency. The monolith skill remains registered
// for historical log browsing but is never invoked anymore.
//
//   Tier 1 — adapters (per-source) : extract subjects with raw quotes
//      suivitess-extract-{transcript|slack|outlook}
//   Tier 2 — placement : decide enrich/create per subject, no writing
//      suivitess-place-in-document | suivitess-place-in-reviews
//   Tier 3 — writers (parallel, per proposal) : append or compose
//      suivitess-append-situation | suivitess-compose-situation
//
// Each tier is a separate registered skill, logged individually, chained via
// parent_log_id so /ai-logs shows the tree.
//
// Never throws — errors fall through as empty proposal lists + the error is
// captured in the per-tier log rows.
// ═══════════════════════════════════════════════════════════════════════

import { runSkill } from './runSkill.js';
import { updateLogError, attachProposalsToLog } from './analysisLogsService.js';

// ── Progress callback — optional, used by the async-job variants to
//    report real phase transitions to the frontend (replaces the fake
//    timer-based progress indicator in BulkTranscriptionImportModal). ──

export type PipelineProgressEvent =
  | { kind: 't1-start'; sourcesCount?: number }
  | { kind: 't1-end'; subjectsExtracted: number; rootLogId: number | null; durationMs: number }
  | { kind: 'reconcile-start' }
  | { kind: 'reconcile-end'; subjectsConsolidated: number; durationMs: number }
  | { kind: 't2-start' }
  | { kind: 't2-end'; placementsProduced: number; durationMs: number }
  | { kind: 't3-start'; t3Total: number }
  | { kind: 't3-writer-done' }
  | { kind: 't3-end'; durationMs: number }
  | { kind: 'error'; error: string };

export type PipelineProgressCallback = (e: PipelineProgressEvent) => void;

// No-op default so callers who don't care don't have to pass anything.
const NOOP: PipelineProgressCallback = () => { /* no-op */ };

// ── Shared types ──────────────────────────────────────────────────────

export type SourceKind = 'transcript' | 'slack' | 'outlook' | 'fathom' | 'otter' | 'gmail';

export interface ExtractedSubject {
  index: number;
  title: string;
  rawQuotes: string[];
  participants: string[];
  entities: string[];
  statusHint: string | null;
  responsibilityHint: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface DocumentContext {
  id: string;
  title: string;
  sections: Array<{
    id: string;
    name: string;
    subjects: Array<{
      id: string;
      title: string;
      situationExcerpt: string;
      status: string;
      responsibility: string | null;
    }>;
  }>;
}

export interface ReviewContext {
  id: string;
  title: string;
  description: string | null;
  sections: Array<{
    id: string;
    name: string;
    subjects: Array<{
      id: string;
      title: string;
      situationExcerpt: string;
      status: string;
    }>;
  }>;
}

// ── Tier 2 decision types (tight coupling with skill output JSON) ─────

interface DocumentPlacement {
  subjectIndex: number;
  action: 'enrich' | 'create_subject' | 'create_section';
  targetSubjectId?: string;
  targetSubjectTitle?: string;
  sectionId?: string;
  sectionName?: string;
  suggestedNewSectionName?: string;
  reason: string;
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

// ── Final proposal types (shape expected by existing frontend) ────────

/** Matches the legacy `suivitess-import-source-into-document` output shape
 *  so the frontend (TranscriptionWizard) needs no change. */
export interface FinalDocumentProposal {
  action: 'enrich' | 'create_subject' | 'create_section';
  subjectId?: string;
  subjectTitle?: string;
  sectionId?: string;
  sectionName?: string;
  title?: string;
  situation?: string;
  appendText?: string;
  responsibility?: string | null;
  status?: string;
  subjects?: Array<{
    title: string;
    situation: string;
    responsibility: string | null;
    status: string;
  }>;
  reason: string;
}

/** Matches the legacy `AnalyzedSubject` shape from transcriptionRoutingService
 *  so the frontend (BulkTranscriptionImportModal) needs no change when the
 *  pipeline is active. */
export interface FinalReviewProposal {
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
  /** Only set when subjectAction === 'update-existing-subject'. */
  updatedSituation: string | null;
  updatedStatus: string | null;
  updatedResponsibility: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Tolerant JSON extraction — handles ```json fences, stray prose AND
 *  **truncated output** (cut off by max_tokens). For truncated arrays we
 *  drop the last incomplete item and close the array, which is strictly
 *  better than losing everything. */
function extractJson<T>(text: string): T | null {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();

  // 1) Try as-is.
  try { return JSON.parse(s) as T; } catch { /* fall through */ }

  // 2) Try extracting the first array/object that looks complete.
  const arrMatch = s.match(/\[[\s\S]*\]/);
  const objMatch = s.match(/\{[\s\S]*\}/);
  try {
    if (arrMatch && (!objMatch || (arrMatch.index ?? 0) < (objMatch.index ?? Infinity))) {
      return JSON.parse(arrMatch[0]) as T;
    }
    if (objMatch) return JSON.parse(objMatch[0]) as T;
  } catch { /* fall through to truncation recovery */ }

  // 3) Truncation recovery — output hit max_tokens mid-item. Find the last
  //    `},` inside a `[...`-open array, keep everything before it, close
  //    the array, re-parse. Covers the common case of extract-* skills
  //    returning N-1 valid items + a half-written N-th.
  const openArr = s.indexOf('[');
  if (openArr >= 0) {
    const body = s.slice(openArr);
    // Find last occurrence of "}," or "}\n" that marks the end of a
    // complete object.
    const lastComma = Math.max(body.lastIndexOf('},'), body.lastIndexOf('}\n'));
    if (lastComma > 0) {
      const truncated = body.slice(0, lastComma + 1) + ']';
      try { return JSON.parse(truncated) as T; } catch { /* give up */ }
    }
    // Or a single complete object at the end.
    const lastBrace = body.lastIndexOf('}');
    if (lastBrace > 0) {
      const truncated = body.slice(0, lastBrace + 1) + ']';
      try { return JSON.parse(truncated) as T; } catch { /* give up */ }
    }
  }

  return null;
}

function extractorSlugFor(kind: SourceKind): string {
  // Our three adapters : transcript, slack, outlook. Map provider variants
  // (fathom / otter → transcript, gmail → outlook).
  if (kind === 'fathom' || kind === 'otter' || kind === 'transcript') return 'suivitess-extract-transcript';
  if (kind === 'slack') return 'suivitess-extract-slack';
  return 'suivitess-extract-outlook'; // outlook, gmail, default
}

function todayFrFr(): string {
  return new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/** "1234ms" → "1.23s (1234ms)". We log both units because seconds are more
 *  readable for humans, ms are more precise for comparisons/regressions. */
function fmtDur(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s (${ms}ms)`;
}

function defaultStatus(hint: string | null | undefined): string {
  return hint ?? '🟡 en cours';
}

// ── Tier runners ──────────────────────────────────────────────────────

interface TierBase {
  userId: number;
  userEmail: string;
  sourceKind: string;
  sourceTitle: string;
  documentId: string | null;
}

async function tier1Extract(base: TierBase & {
  sourceRaw: string;
}): Promise<{ logId: number | null; subjects: ExtractedSubject[]; durationMs: number }> {
  const t0 = Date.now();
  const run = await runSkill({
    slug: extractorSlugFor(base.sourceKind as SourceKind),
    userId: base.userId,
    userEmail: base.userEmail,
    // Use buildContext (cacheable) — the skill body goes to system with
    // cache_control, the user message carries only the source.
    buildContext: () => `## Source brute\n\n${base.sourceRaw.slice(0, 30000)}\n\nRenvoie UNIQUEMENT le tableau JSON des sujets extraits.`,
    inputContent: base.sourceRaw,
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    // Extract step needs headroom for N subjects × (title + rawQuotes +
    // participants + entities). 10 subjects ≈ 4000 tokens, 15 ≈ 6500.
    // We size for the full 15 so the JSON never truncates mid-item.
    maxTokens: 8000,
  });
  const raw = extractJson<ExtractedSubject[]>(run.outputText);
  const subjects = Array.isArray(raw)
    ? raw.map((s, i) => ({ ...s, index: i })) // re-index to be safe
    : [];
  const durationMs = Date.now() - t0;
  // eslint-disable-next-line no-console -- visible for pipeline debugging
  console.log(`[pipeline] tier1 extract (${base.sourceKind}) → ${subjects.length} subjects · ${fmtDur(durationMs)} · logId=${run.logId}`);
  // Annotate the log row so /ai-logs shows a clear error instead of a
  // successful-looking log with empty proposals.
  if (run.logId != null) {
    if (raw == null) {
      await updateLogError(run.logId, `[PIPELINE T1] JSON parse failed — output may be truncated (${run.outputText.length} chars). Check the raw output below.`);
    } else if (subjects.length === 0) {
      await updateLogError(run.logId, `[PIPELINE T1] Extracted 0 subjects — source may lack actionable content or the skill's filtering is too aggressive.`);
    } else {
      // Attach the subjects as "proposals" so the log's count reflects
      // what this tier actually produced (otherwise the UI shows
      // "0 propositions" which is misleading).
      await attachProposalsToLog(run.logId, subjects);
    }
  }
  return { logId: run.logId, subjects, durationMs };
}

async function tier2PlaceDocument(base: TierBase & {
  subjects: ExtractedSubject[];
  document: DocumentContext;
  parentLogId: number | null;
}): Promise<{ logId: number | null; placements: DocumentPlacement[]; durationMs: number }> {
  const t0 = Date.now();
  const ctx = { subjects: base.subjects, document: base.document };
  const ctxJson = JSON.stringify(ctx, null, 2).slice(0, 30000);
  const run = await runSkill({
    slug: 'suivitess-place-in-document',
    userId: base.userId,
    userEmail: base.userEmail,
    buildContext: () => `## Contexte\n\n\`\`\`json\n${ctxJson}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON des décisions de placement.`,
    // Store the actual context JSON (not a summary) so /ai-logs → "Input
    // brut" shows what the model really received. Truncated at 30k chars
    // to match the prompt itself.
    inputContent: ctxJson,
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    parentLogId: base.parentLogId,
    maxTokens: 4000,
  });
  const raw = extractJson<DocumentPlacement[]>(run.outputText);
  const placements = Array.isArray(raw) ? raw : [];
  const durationMs = Date.now() - t0;
  // eslint-disable-next-line no-console -- visible for pipeline debugging
  console.log(`[pipeline] tier2 place-in-document → ${placements.length} placements · ${fmtDur(durationMs)} · logId=${run.logId}`);
  if (run.logId != null) {
    if (raw == null) {
      await updateLogError(run.logId, `[PIPELINE T2 document] JSON parse failed — output may be truncated.`);
    } else if (placements.length === 0 && base.subjects.length > 0) {
      await updateLogError(run.logId, `[PIPELINE T2 document] 0 placements for ${base.subjects.length} subjects — likely all considered duplicates already present in the document.`);
    } else {
      await attachProposalsToLog(run.logId, placements);
    }
  }
  return { logId: run.logId, placements, durationMs };
}

async function tier2PlaceReviews(base: TierBase & {
  subjects: ExtractedSubject[];
  reviews: ReviewContext[];
  parentLogId: number | null;
}): Promise<{ logId: number | null; placements: ReviewPlacement[]; durationMs: number }> {
  const t0 = Date.now();
  const ctx = { subjects: base.subjects, reviews: base.reviews };
  const ctxJson = JSON.stringify(ctx, null, 2).slice(0, 30000);
  const run = await runSkill({
    slug: 'suivitess-place-in-reviews',
    userId: base.userId,
    userEmail: base.userEmail,
    buildContext: () => `## Contexte\n\n\`\`\`json\n${ctxJson}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON des décisions de routage.`,
    // Store the real context JSON (not a summary) so /ai-logs → "Input
    // brut" shows what the model really received.
    inputContent: ctxJson,
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    parentLogId: base.parentLogId,
    maxTokens: 4500,
  });
  const raw = extractJson<ReviewPlacement[]>(run.outputText);
  const placements = Array.isArray(raw) ? raw : [];
  const durationMs = Date.now() - t0;
  // eslint-disable-next-line no-console -- visible for pipeline debugging
  console.log(`[pipeline] tier2 place-in-reviews → ${placements.length} placements · ${fmtDur(durationMs)} · logId=${run.logId}`);
  if (run.logId != null) {
    if (raw == null) {
      await updateLogError(run.logId, `[PIPELINE T2 reviews] JSON parse failed — output may be truncated.`);
    } else if (placements.length === 0 && base.subjects.length > 0) {
      await updateLogError(run.logId, `[PIPELINE T2 reviews] 0 routings for ${base.subjects.length} subjects — likely all considered duplicates already present in existing reviews.`);
    } else {
      await attachProposalsToLog(run.logId, placements);
    }
  }
  return { logId: run.logId, placements, durationMs };
}

async function tier3Append(base: TierBase & {
  existingSituation: string;
  rawQuotes: string[];
  subjectTitle: string;
  parentLogId: number | null;
}): Promise<{ logId: number | null; appendText: string | null; durationMs: number }> {
  const t0 = Date.now();
  const ctx = {
    existingSituation: base.existingSituation,
    rawQuotes: base.rawQuotes,
    today: todayFrFr(),
    subjectTitle: base.subjectTitle,
  };
  const run = await runSkill({
    slug: 'suivitess-append-situation',
    userId: base.userId,
    userEmail: base.userEmail,
    // T3 runs in parallel N times with the SAME skill → prompt caching
    // brings the biggest win here. First call pays cache_creation ~1.25×,
    // all subsequent calls pay cache_read ~0.1×.
    buildContext: () => `## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nRenvoie UNIQUEMENT l'objet JSON { "appendText": … }.`,
    inputContent: JSON.stringify(ctx),
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    parentLogId: base.parentLogId,
    maxTokens: 800,
  });
  const parsed = extractJson<{ appendText: string | null }>(run.outputText);
  if (run.logId != null) {
    if (parsed == null) {
      await updateLogError(run.logId, `[PIPELINE T3 append] JSON parse failed — output may be truncated or malformed.`);
    } else if (parsed.appendText) {
      // A T3 writer produces a single item. We store it as a 1-item array so
      // /ai-logs displays "1 proposition" instead of "0 propositions" (which
      // made these logs look like failures).
      await attachProposalsToLog(run.logId, [{ kind: 'append', text: parsed.appendText }]);
    } else {
      // Writer decided explicitly that nothing new was worth appending —
      // valid no-op, not an error.
      await attachProposalsToLog(run.logId, [{ kind: 'append', text: null, note: 'writer decided nothing new to add' }]);
    }
  }
  const durationMs = Date.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`[pipeline] tier3 append → ${parsed?.appendText ? 'text' : 'null'} · ${fmtDur(durationMs)} · logId=${run.logId}`);
  return { logId: run.logId, appendText: parsed?.appendText ?? null, durationMs };
}

async function tier3Compose(base: TierBase & {
  title: string;
  rawQuotes: string[];
  parentLogId: number | null;
}): Promise<{ logId: number | null; situation: string; durationMs: number }> {
  const t0 = Date.now();
  const ctx = { title: base.title, rawQuotes: base.rawQuotes };
  const run = await runSkill({
    slug: 'suivitess-compose-situation',
    userId: base.userId,
    userEmail: base.userEmail,
    buildContext: () => `## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nRenvoie UNIQUEMENT l'objet JSON { "situation": … }.`,
    inputContent: JSON.stringify(ctx),
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    parentLogId: base.parentLogId,
    maxTokens: 800,
  });
  const parsed = extractJson<{ situation: string }>(run.outputText);
  if (run.logId != null) {
    if (parsed == null) {
      await updateLogError(run.logId, `[PIPELINE T3 compose] JSON parse failed — output may be truncated or malformed.`);
    } else {
      await attachProposalsToLog(run.logId, [{ kind: 'compose', text: parsed.situation ?? '' }]);
    }
  }
  const durationMs = Date.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`[pipeline] tier3 compose → ${(parsed?.situation?.length ?? 0)} chars · ${fmtDur(durationMs)} · logId=${run.logId}`);
  return { logId: run.logId, situation: parsed?.situation ?? '', durationMs };
}

// ── Public API ────────────────────────────────────────────────────────

export interface AnalyzeForDocumentInput {
  sourceKind: SourceKind;
  sourceRaw: string;
  sourceTitle: string;
  document: DocumentContext;
  userId: number;
  userEmail: string;
}

/** Pipeline for the TranscriptionWizard / content-wizard on a specific doc. */
export async function analyzeSourceForDocument(
  input: AnalyzeForDocumentInput,
  onProgress: PipelineProgressCallback = NOOP,
): Promise<{ proposals: FinalDocumentProposal[]; rootLogId: number | null }> {
  const wallStart = Date.now();
  const base = {
    userId: input.userId,
    userEmail: input.userEmail,
    sourceKind: input.sourceKind,
    sourceTitle: input.sourceTitle,
    documentId: input.document.id,
  };

  // Tier 1
  onProgress({ kind: 't1-start' });
  const ex = await tier1Extract({ ...base, sourceRaw: input.sourceRaw });
  onProgress({ kind: 't1-end', subjectsExtracted: ex.subjects.length, rootLogId: ex.logId, durationMs: ex.durationMs });
  if (ex.subjects.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pipeline] tier1 returned 0 subjects — aborting. logId=${ex.logId}. Check the raw output in /ai-logs.`);
    return { proposals: [], rootLogId: ex.logId };
  }

  // Tier 2
  onProgress({ kind: 't2-start' });
  const pl = await tier2PlaceDocument({
    ...base,
    subjects: ex.subjects,
    document: input.document,
    parentLogId: ex.logId,
  });
  onProgress({ kind: 't2-end', placementsProduced: pl.placements.length, durationMs: pl.durationMs });
  if (pl.placements.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pipeline] tier2 returned 0 placements (had ${ex.subjects.length} subjects) — aborting. logId=${pl.logId}.`);
    return { proposals: [], rootLogId: ex.logId };
  }

  // Tier 3 — parallel per placement
  const tier3Start = Date.now();
  onProgress({ kind: 't3-start', t3Total: pl.placements.length });
  // eslint-disable-next-line no-console
  console.log(`[pipeline] tier3 running ${pl.placements.length} writer(s) in parallel…`);
  const proposals = await Promise.all(pl.placements.map(async (p): Promise<FinalDocumentProposal | null> => {
    try {
    const subj = ex.subjects[p.subjectIndex];
    if (!subj) return null;

    if (p.action === 'enrich') {
      // Locate the existing situation from the document structure.
      let existing = '';
      for (const s of input.document.sections) {
        const match = s.subjects.find(x => x.id === p.targetSubjectId);
        if (match) { existing = match.situationExcerpt; break; }
      }
      const w = await tier3Append({
        ...base,
        existingSituation: existing,
        rawQuotes: subj.rawQuotes,
        subjectTitle: subj.title,
        parentLogId: pl.logId,
      });
      if (!w.appendText || !w.appendText.trim()) return null; // writer decided nothing new
      return {
        action: 'enrich',
        subjectId: p.targetSubjectId,
        subjectTitle: p.targetSubjectTitle,
        sectionName: p.sectionName,
        appendText: w.appendText,
        reason: p.reason,
      };
    }

    if (p.action === 'create_subject') {
      const w = await tier3Compose({
        ...base,
        title: subj.title,
        rawQuotes: subj.rawQuotes,
        parentLogId: pl.logId,
      });
      return {
        action: 'create_subject',
        sectionId: p.sectionId,
        sectionName: p.sectionName,
        title: subj.title,
        situation: w.situation,
        responsibility: subj.responsibilityHint ?? null,
        status: defaultStatus(subj.statusHint),
        reason: p.reason,
      };
    }

    if (p.action === 'create_section') {
      const w = await tier3Compose({
        ...base,
        title: subj.title,
        rawQuotes: subj.rawQuotes,
        parentLogId: pl.logId,
      });
      return {
        action: 'create_section',
        sectionName: p.suggestedNewSectionName ?? subj.title,
        subjects: [{
          title: subj.title,
          situation: w.situation,
          responsibility: subj.responsibilityHint ?? null,
          status: defaultStatus(subj.statusHint),
        }],
        reason: p.reason,
      };
    }

    return null;
    } finally {
      onProgress({ kind: 't3-writer-done' });
    }
  }));

  const final = proposals.filter((p): p is FinalDocumentProposal => p !== null);
  const tier3WallMs = Date.now() - tier3Start;
  onProgress({ kind: 't3-end', durationMs: tier3WallMs });
  const totalMs = Date.now() - wallStart;
  // Final timing summary — one line per pipeline run, easy to grep.
  // eslint-disable-next-line no-console
  console.log(
    `[pipeline:summary] (document) ` +
    `T1=${fmtDur(ex.durationMs)} · T2=${fmtDur(pl.durationMs)} · ` +
    `T3=${fmtDur(tier3WallMs)} (${pl.placements.length} writers in //) · ` +
    `TOTAL=${fmtDur(totalMs)} · final=${final.length}/${pl.placements.length} proposals`,
  );
  return { proposals: final, rootLogId: ex.logId };
}

export interface AnalyzeForReviewsInput {
  sourceKind: SourceKind;
  sourceRaw: string;
  sourceTitle: string;
  reviews: ReviewContext[];
  userId: number;
  userEmail: string;
}

/** Pipeline for the bulk import modal on the listing page (multi-review). */
export async function analyzeSourceForReviews(
  input: AnalyzeForReviewsInput,
  onProgress: PipelineProgressCallback = NOOP,
): Promise<{ proposals: FinalReviewProposal[]; rootLogId: number | null }> {
  const wallStart = Date.now();
  const base = {
    userId: input.userId,
    userEmail: input.userEmail,
    sourceKind: input.sourceKind,
    sourceTitle: input.sourceTitle,
    documentId: null,
  };

  // Tier 1
  onProgress({ kind: 't1-start' });
  const ex = await tier1Extract({ ...base, sourceRaw: input.sourceRaw });
  onProgress({ kind: 't1-end', subjectsExtracted: ex.subjects.length, rootLogId: ex.logId, durationMs: ex.durationMs });
  if (ex.subjects.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pipeline] tier1 returned 0 subjects — aborting. logId=${ex.logId}.`);
    return { proposals: [], rootLogId: ex.logId };
  }

  // Tier 2
  onProgress({ kind: 't2-start' });
  const pl = await tier2PlaceReviews({
    ...base,
    subjects: ex.subjects,
    reviews: input.reviews,
    parentLogId: ex.logId,
  });
  onProgress({ kind: 't2-end', placementsProduced: pl.placements.length, durationMs: pl.durationMs });
  if (pl.placements.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pipeline] tier2 returned 0 placements (had ${ex.subjects.length} subjects) — aborting. logId=${pl.logId}.`);
    return { proposals: [], rootLogId: ex.logId };
  }

  // Tier 3 — parallel per placement
  const tier3Start = Date.now();
  onProgress({ kind: 't3-start', t3Total: pl.placements.length });
  // eslint-disable-next-line no-console
  console.log(`[pipeline] tier3 running ${pl.placements.length} writer(s) in parallel…`);
  const proposals = await Promise.all(pl.placements.map(async (p): Promise<FinalReviewProposal | null> => {
    try {
    const subj = ex.subjects[p.subjectIndex];
    if (!subj) return null;

    // Derive review/section action from the ids.
    const reviewAction: 'new-review' | 'existing-review' = p.reviewId ? 'existing-review' : 'new-review';
    const sectionAction: 'new-section' | 'existing-section' = p.sectionId ? 'existing-section' : 'new-section';
    const status = defaultStatus(subj.statusHint);
    const responsibility = subj.responsibilityHint ?? null;

    if (p.subjectAction === 'update-existing-subject') {
      // Locate existing situation in the chosen review.
      let existing = '';
      const rev = input.reviews.find(r => r.id === p.reviewId);
      if (rev) {
        for (const s of rev.sections) {
          const match = s.subjects.find(x => x.id === p.targetSubjectId);
          if (match) { existing = match.situationExcerpt; break; }
        }
      }
      const w = await tier3Append({
        ...base,
        existingSituation: existing,
        rawQuotes: subj.rawQuotes,
        subjectTitle: subj.title,
        parentLogId: pl.logId,
      });
      if (!w.appendText || !w.appendText.trim()) return null;
      return {
        title: subj.title,
        situation: '', // unused for updates
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
        updatedSituation: (existing ? existing + '\n' : '') + w.appendText,
        updatedStatus: null, // the writer skill doesn't touch status
        updatedResponsibility: null,
        confidence: p.confidence,
        reasoning: p.reason,
      };
    }

    // new-subject
    const w = await tier3Compose({
      ...base,
      title: subj.title,
      rawQuotes: subj.rawQuotes,
      parentLogId: pl.logId,
    });
    return {
      title: subj.title,
      situation: w.situation,
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
    };
    } finally {
      onProgress({ kind: 't3-writer-done' });
    }
  }));

  const final = proposals.filter((p): p is FinalReviewProposal => p !== null);
  const tier3WallMs = Date.now() - tier3Start;
  onProgress({ kind: 't3-end', durationMs: tier3WallMs });
  const totalMs = Date.now() - wallStart;
  // eslint-disable-next-line no-console
  console.log(
    `[pipeline:summary] (reviews) ` +
    `T1=${fmtDur(ex.durationMs)} · T2=${fmtDur(pl.durationMs)} · ` +
    `T3=${fmtDur(tier3WallMs)} (${pl.placements.length} writers in //) · ` +
    `TOTAL=${fmtDur(totalMs)} · final=${final.length}/${pl.placements.length} proposals`,
  );
  return { proposals: final, rootLogId: ex.logId };
}

// ═══════════════════════════════════════════════════════════════════════
// MULTI-SOURCE PIPELINE (T1 per-source → T1.5 reconcile → T2 → T3)
//
// Invoked when the user selects ≥2 sources at once in the import modal.
// Each source goes through its own T1 extractor (same 3 extractors as
// single-source), then the outputs are fed to the new T1.5 reconciler
// which produces a CONSOLIDATED list of subjects (with multi-source
// evidence, chronology, and reconciliation notes). T2 and T3 then run
// over the consolidated list — they never know multiple sources existed.
// ═══════════════════════════════════════════════════════════════════════

/** One source descriptor as the caller passes it in — the raw content
 *  plus enough metadata for the reconciler to order and attribute the
 *  extracted subjects. */
export interface MultiSourceInput {
  sourceId: string;
  sourceKind: SourceKind;
  sourceTitle: string;
  sourceTimestamp: string; // ISO 8601
  sourceRaw: string;
}

/** Output of the T1.5 reconciler — one consolidated subject per unique
 *  topic, with 1..N evidence entries (one per source that mentions it). */
export interface ConsolidatedSubject {
  canonicalTitle: string;
  evidence: Array<{
    sourceId: string;
    sourceType: string;
    ts: string;
    subjectIndex: number;
    rawQuotes: string[];
    stance: 'propose' | 'confirm' | 'complement' | 'contradict';
    summary: string;
  }>;
  chronology: string | null;
  reconciliationNote: string | null;
  mergedRawQuotes: string[];
  mergedParticipants: string[];
  mergedEntities: string[];
  mergedStatusHint: string | null;
  mergedResponsibilityHint: string | null;
}

/** Run tier 1 extractors for every source in parallel. Preserves the order
 *  of the input array in the output (best-effort — failed extractions are
 *  kept as empty arrays with the error annotated on the log row). */
async function tier1ExtractMulti(params: {
  sources: MultiSourceInput[];
  userId: number;
  userEmail: string;
  documentId: string | null;
}): Promise<Array<{
  source: MultiSourceInput;
  logId: number | null;
  subjects: ExtractedSubject[];
  durationMs: number;
}>> {
  const { sources, userId, userEmail, documentId } = params;
  return Promise.all(sources.map(async (src) => {
    const res = await tier1Extract({
      userId, userEmail,
      sourceKind: src.sourceKind,
      sourceTitle: src.sourceTitle,
      documentId,
      sourceRaw: src.sourceRaw,
    });
    return { source: src, ...res };
  }));
}

/** Tier 1.5 — reconcile multi-source extractions into a consolidated list.
 *  Invokes the `suivitess-reconcile-multi-source` skill with the full N
 *  extractions as JSON context. Tolerant parser — if the skill fails or
 *  returns malformed JSON, we fall back to a simple concatenation of all
 *  extractions (each subject becomes its own consolidated entry). */
async function tier15Reconcile(params: {
  extractions: Array<{ source: MultiSourceInput; subjects: ExtractedSubject[] }>;
  userId: number;
  userEmail: string;
  documentId: string | null;
  parentLogId: number | null;
}): Promise<{ logId: number | null; consolidated: ConsolidatedSubject[]; durationMs: number }> {
  const t0 = Date.now();
  const payload = {
    sources: params.extractions.map(e => ({
      sourceId: e.source.sourceId,
      sourceType: e.source.sourceKind,
      sourceTitle: e.source.sourceTitle,
      sourceTimestamp: e.source.sourceTimestamp,
      extractedSubjects: e.subjects.map(s => ({
        index: s.index,
        title: s.title,
        rawQuotes: s.rawQuotes,
        participants: s.participants,
        entities: s.entities,
        statusHint: s.statusHint,
        responsibilityHint: s.responsibilityHint,
        confidence: s.confidence,
      })),
    })),
  };
  const ctxJson = JSON.stringify(payload, null, 2).slice(0, 40000);

  const run = await runSkill({
    slug: 'suivitess-reconcile-multi-source',
    userId: params.userId,
    userEmail: params.userEmail,
    buildContext: () => `## Extractions multi-source\n\n\`\`\`json\n${ctxJson}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON consolidé.`,
    inputContent: ctxJson,
    sourceKind: 'multi-source',
    sourceTitle: `Reconcile ${params.extractions.length} sources`,
    documentId: params.documentId,
    parentLogId: params.parentLogId,
    // The reconciler can produce verbose evidence arrays — size for
    // ~15 consolidated subjects × 3 evidence each × 200 tokens.
    maxTokens: 10000,
  });
  const durationMs = Date.now() - t0;

  const raw = extractJson<ConsolidatedSubject[]>(run.outputText);
  let consolidated: ConsolidatedSubject[];
  if (Array.isArray(raw) && raw.length > 0) {
    consolidated = raw;
  } else {
    // Fallback — pass-through : each extracted subject becomes its own
    // consolidated entry. Preserves zero-loss guarantee even if the
    // reconciler fails. The UI will show "source unique" for each.
    if (run.logId != null) {
      await updateLogError(run.logId, `[PIPELINE T1.5] Parse failed or empty — falling back to pass-through consolidation across ${params.extractions.length} sources.`);
    }
    consolidated = buildPassThroughConsolidation(params.extractions);
  }

  // eslint-disable-next-line no-console
  console.log(`[pipeline] tier1.5 reconcile → ${consolidated.length} consolidated · ${fmtDur(durationMs)} · logId=${run.logId}`);
  if (run.logId != null && consolidated.length > 0) {
    await attachProposalsToLog(run.logId, consolidated);
  }
  return { logId: run.logId, consolidated, durationMs };
}

/** Deterministic fallback : each extracted subject becomes its own
 *  consolidated entry, no cross-source linking. Used when the T1.5 skill
 *  fails to parse — ensures the pipeline never loses data. */
function buildPassThroughConsolidation(
  extractions: Array<{ source: MultiSourceInput; subjects: ExtractedSubject[] }>,
): ConsolidatedSubject[] {
  const out: ConsolidatedSubject[] = [];
  for (const { source, subjects } of extractions) {
    for (const s of subjects) {
      out.push({
        canonicalTitle: s.title,
        evidence: [{
          sourceId: source.sourceId,
          sourceType: source.sourceKind,
          ts: source.sourceTimestamp,
          subjectIndex: s.index,
          rawQuotes: s.rawQuotes,
          stance: 'propose',
          summary: s.title,
        }],
        chronology: null,
        reconciliationNote: null,
        mergedRawQuotes: s.rawQuotes,
        mergedParticipants: s.participants,
        mergedEntities: s.entities,
        mergedStatusHint: s.statusHint,
        mergedResponsibilityHint: s.responsibilityHint,
      });
    }
  }
  return out;
}

/** Convert a ConsolidatedSubject back to the ExtractedSubject shape that
 *  T2 and T3 expect. The multi-source evidence is flattened into the
 *  existing fields — rawQuotes becomes mergedRawQuotes, participants /
 *  entities become the merged union. Consumers that care about the
 *  evidence chain read it separately from the pipeline output. */
function consolidatedToExtracted(
  consolidated: ConsolidatedSubject[],
): ExtractedSubject[] {
  return consolidated.map((c, i) => ({
    index: i,
    title: c.canonicalTitle,
    rawQuotes: c.mergedRawQuotes,
    participants: c.mergedParticipants,
    entities: c.mergedEntities,
    statusHint: c.mergedStatusHint,
    responsibilityHint: c.mergedResponsibilityHint,
    confidence: 'medium' as const,
  }));
}

export interface AnalyzeMultiSourceForReviewsInput {
  sources: MultiSourceInput[];
  reviews: ReviewContext[];
  userId: number;
  userEmail: string;
}

export interface AnalyzeMultiSourceForReviewsResult {
  proposals: FinalReviewProposal[];
  /** Consolidation metadata — one entry per final proposal at the same
   *  index. Lets the frontend surface "3 sources" badges and chronology
   *  tooltips next to each proposal. `null` entries = single-source
   *  pass-throughs (no reconciliation needed). */
  consolidationByProposal: Array<ConsolidatedSubject | null>;
  rootLogId: number | null;
}

/** Multi-source variant of `analyzeSourceForReviews`. If `sources.length`
 *  is 1, falls back to the single-source pipeline (same behavior as
 *  before). For ≥2 sources, runs the full T1 × N → T1.5 → T2 → T3 flow. */
export async function analyzeMultiSourceForReviews(
  input: AnalyzeMultiSourceForReviewsInput,
  onProgress: PipelineProgressCallback = NOOP,
): Promise<AnalyzeMultiSourceForReviewsResult> {
  const { sources, reviews, userId, userEmail } = input;
  const wallStart = Date.now();

  // Single-source fast path — reuse the existing pipeline verbatim so we
  // don't pay for a reconciliation call that would do nothing useful.
  if (sources.length === 1) {
    const only = sources[0];
    const res = await analyzeSourceForReviews({
      sourceKind: only.sourceKind,
      sourceRaw: only.sourceRaw,
      sourceTitle: only.sourceTitle,
      reviews,
      userId,
      userEmail,
    }, onProgress);
    return {
      proposals: res.proposals,
      consolidationByProposal: res.proposals.map(() => null), // no consolidation
      rootLogId: res.rootLogId,
    };
  }

  // ── Multi-source flow ──
  // T1 per-source in parallel
  onProgress({ kind: 't1-start', sourcesCount: sources.length });
  const extractions = await tier1ExtractMulti({
    sources,
    userId,
    userEmail,
    documentId: null,
  });
  const t1WallMs = Math.max(...extractions.map(e => e.durationMs));
  const totalExtracted = extractions.reduce((s, e) => s + e.subjects.length, 0);
  const firstLogId = extractions.find(e => e.logId != null)?.logId ?? null;
  onProgress({
    kind: 't1-end',
    subjectsExtracted: totalExtracted,
    rootLogId: firstLogId,
    durationMs: t1WallMs,
  });

  if (totalExtracted === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[pipeline-multi] tier1 returned 0 subjects across ${sources.length} sources — aborting.`);
    return { proposals: [], consolidationByProposal: [], rootLogId: firstLogId };
  }

  // T1.5 reconciliation
  onProgress({ kind: 'reconcile-start' });
  const rec = await tier15Reconcile({
    extractions,
    userId,
    userEmail,
    documentId: null,
    parentLogId: firstLogId,
  });
  onProgress({
    kind: 'reconcile-end',
    subjectsConsolidated: rec.consolidated.length,
    durationMs: rec.durationMs,
  });

  if (rec.consolidated.length === 0) {
    return { proposals: [], consolidationByProposal: [], rootLogId: firstLogId };
  }

  // Flatten to ExtractedSubject for T2 (placement) — T2 doesn't need to
  // know about multi-source evidence. Still exposes the consolidation
  // metadata to the UI at the end.
  const flattened = consolidatedToExtracted(rec.consolidated);

  const base = {
    userId,
    userEmail,
    sourceKind: 'multi-source',
    sourceTitle: `${sources.length} sources (${sources.map(s => s.sourceKind).join(' + ')})`,
    documentId: null,
  };

  onProgress({ kind: 't2-start' });
  const pl = await tier2PlaceReviews({
    ...base,
    subjects: flattened,
    reviews,
    parentLogId: rec.logId,
  });
  onProgress({ kind: 't2-end', placementsProduced: pl.placements.length, durationMs: pl.durationMs });

  if (pl.placements.length === 0) {
    return { proposals: [], consolidationByProposal: [], rootLogId: firstLogId };
  }

  // T3 writers — parallel, same logic as single-source review path.
  const tier3Start = Date.now();
  onProgress({ kind: 't3-start', t3Total: pl.placements.length });
  // eslint-disable-next-line no-console
  console.log(`[pipeline-multi] tier3 running ${pl.placements.length} writer(s) in parallel…`);

  type ProposalWithConsolidation = { proposal: FinalReviewProposal; consolidation: ConsolidatedSubject | null };

  const results = await Promise.all(pl.placements.map(async (p): Promise<ProposalWithConsolidation | null> => {
    try {
      const subj = flattened[p.subjectIndex];
      if (!subj) return null;
      const consolidation = rec.consolidated[p.subjectIndex] ?? null;

      const reviewAction: 'new-review' | 'existing-review' = p.reviewId ? 'existing-review' : 'new-review';
      const sectionAction: 'new-section' | 'existing-section' = p.sectionId ? 'existing-section' : 'new-section';
      const status = defaultStatus(subj.statusHint);
      const responsibility = subj.responsibilityHint ?? null;

      if (p.subjectAction === 'update-existing-subject') {
        let existing = '';
        const rev = reviews.find(r => r.id === p.reviewId);
        if (rev) {
          for (const s of rev.sections) {
            const match = s.subjects.find(x => x.id === p.targetSubjectId);
            if (match) { existing = match.situationExcerpt; break; }
          }
        }
        const w = await tier3Append({
          ...base,
          existingSituation: existing,
          rawQuotes: subj.rawQuotes,
          subjectTitle: subj.title,
          parentLogId: pl.logId,
        });
        if (!w.appendText || !w.appendText.trim()) return null;
        return {
          consolidation,
          proposal: {
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
            updatedSituation: (existing ? existing + '\n' : '') + w.appendText,
            updatedStatus: null,
            updatedResponsibility: null,
            confidence: p.confidence,
            reasoning: p.reason,
          },
        };
      }

      // new-subject
      const w = await tier3Compose({
        ...base,
        title: subj.title,
        rawQuotes: subj.rawQuotes,
        parentLogId: pl.logId,
      });
      return {
        consolidation,
        proposal: {
          title: subj.title,
          situation: w.situation,
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
        },
      };
    } finally {
      onProgress({ kind: 't3-writer-done' });
    }
  }));

  const kept = results.filter((r): r is ProposalWithConsolidation => r !== null);
  const tier3WallMs = Date.now() - tier3Start;
  onProgress({ kind: 't3-end', durationMs: tier3WallMs });
  const totalMs = Date.now() - wallStart;

  // eslint-disable-next-line no-console
  console.log(
    `[pipeline-multi:summary] (${sources.length} sources) ` +
    `T1=${fmtDur(t1WallMs)} · T1.5=${fmtDur(rec.durationMs)} · ` +
    `T2=${fmtDur(pl.durationMs)} · T3=${fmtDur(tier3WallMs)} · ` +
    `TOTAL=${fmtDur(totalMs)} · final=${kept.length}/${pl.placements.length} proposals · ` +
    `consolidated=${rec.consolidated.length} (from ${totalExtracted} extracted)`,
  );

  return {
    proposals: kept.map(k => k.proposal),
    consolidationByProposal: kept.map(k => k.consolidation),
    rootLogId: firstLogId,
  };
}

