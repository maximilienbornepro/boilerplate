// ═══════════════════════════════════════════════════════════════════════
// Modular 3-tier AI pipeline for analysing a source (transcript/slack/email).
//
//   Tier 1 — adapters (per-source) : extract subjects with raw quotes
//      suivitess-extract-{transcript|slack|outlook}
//   Tier 2 — placement : decide enrich/create per subject, no writing
//      suivitess-place-in-document | suivitess-place-in-reviews
//   Tier 3 — writers (parallel, per proposal) : append or compose
//      suivitess-append-situation | suivitess-compose-situation
//
// Each tier is a separate registered skill, logged individually, chained via
// parent_log_id so /ai-logs shows the tree. Activated per-request via
// `env.USE_PIPELINE_SKILLS=1` (see routes.ts).
//
// Never throws — errors fall through as empty proposal lists + the error is
// captured in the per-tier log rows.
// ═══════════════════════════════════════════════════════════════════════

import { runSkill } from './runSkill.js';

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

/** Tolerant JSON extraction — handles ```json fences and stray prose. */
function extractJson<T>(text: string): T | null {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  try { return JSON.parse(s) as T; } catch { /* fall through */ }
  const arrMatch = s.match(/\[[\s\S]*\]/);
  const objMatch = s.match(/\{[\s\S]*\}/);
  try {
    if (arrMatch && (!objMatch || (arrMatch.index ?? 0) < (objMatch.index ?? Infinity))) {
      return JSON.parse(arrMatch[0]) as T;
    }
    if (objMatch) return JSON.parse(objMatch[0]) as T;
  } catch { /* ignore */ }
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
}): Promise<{ logId: number | null; subjects: ExtractedSubject[] }> {
  const run = await runSkill({
    slug: extractorSlugFor(base.sourceKind as SourceKind),
    userId: base.userId,
    userEmail: base.userEmail,
    buildPrompt: (skill) => `${skill}\n\n---\n\n## Source brute\n\n${base.sourceRaw.slice(0, 30000)}\n\nRenvoie UNIQUEMENT le tableau JSON des sujets extraits.`,
    inputContent: base.sourceRaw,
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    maxTokens: 3000,
  });
  const raw = extractJson<ExtractedSubject[]>(run.outputText) ?? [];
  const subjects = Array.isArray(raw)
    ? raw.map((s, i) => ({ ...s, index: i })) // re-index to be safe
    : [];
  return { logId: run.logId, subjects };
}

async function tier2PlaceDocument(base: TierBase & {
  subjects: ExtractedSubject[];
  document: DocumentContext;
  parentLogId: number | null;
}): Promise<{ logId: number | null; placements: DocumentPlacement[] }> {
  const ctx = { subjects: base.subjects, document: base.document };
  const run = await runSkill({
    slug: 'suivitess-place-in-document',
    userId: base.userId,
    userEmail: base.userEmail,
    buildPrompt: (skill) => `${skill}\n\n---\n\n## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2).slice(0, 30000)}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON des décisions de placement.`,
    inputContent: JSON.stringify({ subjectsCount: base.subjects.length, documentId: base.document.id }),
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    parentLogId: base.parentLogId,
    maxTokens: 2500,
  });
  const raw = extractJson<DocumentPlacement[]>(run.outputText) ?? [];
  return { logId: run.logId, placements: Array.isArray(raw) ? raw : [] };
}

async function tier2PlaceReviews(base: TierBase & {
  subjects: ExtractedSubject[];
  reviews: ReviewContext[];
  parentLogId: number | null;
}): Promise<{ logId: number | null; placements: ReviewPlacement[] }> {
  const ctx = { subjects: base.subjects, reviews: base.reviews };
  const run = await runSkill({
    slug: 'suivitess-place-in-reviews',
    userId: base.userId,
    userEmail: base.userEmail,
    buildPrompt: (skill) => `${skill}\n\n---\n\n## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2).slice(0, 30000)}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON des décisions de routage.`,
    inputContent: JSON.stringify({ subjectsCount: base.subjects.length, reviewsCount: base.reviews.length }),
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    parentLogId: base.parentLogId,
    maxTokens: 3000,
  });
  const raw = extractJson<ReviewPlacement[]>(run.outputText) ?? [];
  return { logId: run.logId, placements: Array.isArray(raw) ? raw : [] };
}

async function tier3Append(base: TierBase & {
  existingSituation: string;
  rawQuotes: string[];
  subjectTitle: string;
  parentLogId: number | null;
}): Promise<{ logId: number | null; appendText: string | null }> {
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
    buildPrompt: (skill) => `${skill}\n\n---\n\n## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nRenvoie UNIQUEMENT l'objet JSON { "appendText": … }.`,
    inputContent: JSON.stringify(ctx),
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    parentLogId: base.parentLogId,
    maxTokens: 800,
  });
  const parsed = extractJson<{ appendText: string | null }>(run.outputText);
  return { logId: run.logId, appendText: parsed?.appendText ?? null };
}

async function tier3Compose(base: TierBase & {
  title: string;
  rawQuotes: string[];
  parentLogId: number | null;
}): Promise<{ logId: number | null; situation: string }> {
  const ctx = { title: base.title, rawQuotes: base.rawQuotes };
  const run = await runSkill({
    slug: 'suivitess-compose-situation',
    userId: base.userId,
    userEmail: base.userEmail,
    buildPrompt: (skill) => `${skill}\n\n---\n\n## Contexte\n\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nRenvoie UNIQUEMENT l'objet JSON { "situation": … }.`,
    inputContent: JSON.stringify(ctx),
    sourceKind: base.sourceKind,
    sourceTitle: base.sourceTitle,
    documentId: base.documentId,
    parentLogId: base.parentLogId,
    maxTokens: 800,
  });
  const parsed = extractJson<{ situation: string }>(run.outputText);
  return { logId: run.logId, situation: parsed?.situation ?? '' };
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
): Promise<{ proposals: FinalDocumentProposal[]; rootLogId: number | null }> {
  const base = {
    userId: input.userId,
    userEmail: input.userEmail,
    sourceKind: input.sourceKind,
    sourceTitle: input.sourceTitle,
    documentId: input.document.id,
  };

  // Tier 1
  const ex = await tier1Extract({ ...base, sourceRaw: input.sourceRaw });
  if (ex.subjects.length === 0) return { proposals: [], rootLogId: ex.logId };

  // Tier 2
  const pl = await tier2PlaceDocument({
    ...base,
    subjects: ex.subjects,
    document: input.document,
    parentLogId: ex.logId,
  });
  if (pl.placements.length === 0) return { proposals: [], rootLogId: ex.logId };

  // Tier 3 — parallel per placement
  const proposals = await Promise.all(pl.placements.map(async (p): Promise<FinalDocumentProposal | null> => {
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
  }));

  return {
    proposals: proposals.filter((p): p is FinalDocumentProposal => p !== null),
    rootLogId: ex.logId,
  };
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
): Promise<{ proposals: FinalReviewProposal[]; rootLogId: number | null }> {
  const base = {
    userId: input.userId,
    userEmail: input.userEmail,
    sourceKind: input.sourceKind,
    sourceTitle: input.sourceTitle,
    documentId: null,
  };

  // Tier 1
  const ex = await tier1Extract({ ...base, sourceRaw: input.sourceRaw });
  if (ex.subjects.length === 0) return { proposals: [], rootLogId: ex.logId };

  // Tier 2
  const pl = await tier2PlaceReviews({
    ...base,
    subjects: ex.subjects,
    reviews: input.reviews,
    parentLogId: ex.logId,
  });
  if (pl.placements.length === 0) return { proposals: [], rootLogId: ex.logId };

  // Tier 3 — parallel per placement
  const proposals = await Promise.all(pl.placements.map(async (p): Promise<FinalReviewProposal | null> => {
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
  }));

  return {
    proposals: proposals.filter((p): p is FinalReviewProposal => p !== null),
    rootLogId: ex.logId,
  };
}

// ── Feature flag helper ───────────────────────────────────────────────

/** Returns true when the caller should use the modular pipeline.
 *  Single source of truth : env var USE_PIPELINE_SKILLS=1. */
export function isPipelineEnabled(): boolean {
  return process.env.USE_PIPELINE_SKILLS === '1' || process.env.USE_PIPELINE_SKILLS === 'true';
}
