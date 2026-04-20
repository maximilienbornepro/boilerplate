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
  | { kind: 't1-start' }
  | { kind: 't1-end'; subjectsExtracted: number; rootLogId: number | null; durationMs: number }
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

