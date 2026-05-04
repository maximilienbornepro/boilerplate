// Tile-by-tile CV adaptation pipeline.
//
// The flow has three steps :
//   1. Skill A (`mon-cv-extract-atomic-subjects`) flattens the CV into
//      a list of `AtomicSubject` items — one per adaptable text node
//      (summary, each skill, each mission, each project, etc.).
//   2. Skill B (`mon-cv-adapt-atomic-to-offer`) takes the list + the
//      job offer and proposes adapted text for each atomic subject.
//      Same skill is invoked single-mode when the user clicks
//      "Régénérer" on a tile.
//   3. The resulting tiles are persisted into `cv_adaptation_tiles`.
//      As the user accepts / edits each tile in the modal, the chosen
//      text is merged back into `cv_adaptations.adapted_cv` at the
//      atomic's `path`.
//
// All AI calls go through `runSkill()` so the runs are logged in
// `ai_analysis_logs` and visible from /ai-logs.

import { runSkill } from '../aiSkills/runSkill.js';
import * as adaptDb from './adaptationDbService.js';
import type { CVAdaptationTile } from './adaptationDbService.js';
import type { CVData } from './types.js';

/** Output of skill A — one atomic CV element per row, ready to be
 *  adapted to a job offer by skill B and validated tile-by-tile by
 *  the user. The `path` is JSONPath-ish so the apply step can merge
 *  the chosen text back into the adapted CV by walking it. */
export interface AtomicSubject {
  id: string;
  path: string;
  kind: string;
  originalText: string;
  label: string;
}

/** Skill B output (single-item shape — used both alone for
 *  regeneration and inside an array for the batch initial pass). */
export interface AdaptedAtomic {
  id: string;
  proposedText: string;
  reasoning?: string;
}

// ────────────────────────────────────────────────────────────────────
// Skill A — extract atomic subjects from a CV.
// ────────────────────────────────────────────────────────────────────

export async function extractAtomicSubjects(
  cvData: CVData,
  userId: number,
  userEmail: string | null = null,
): Promise<{ subjects: AtomicSubject[]; logId: number | null }> {
  const cvJson = JSON.stringify(cvData, null, 2);
  // Hard cap to keep the prompt under a reasonable budget : 30k chars
  // covers a packed CV (~50 missions + 20 projects) without truncation.
  const cvJsonClipped = cvJson.length > 30000 ? cvJson.slice(0, 30000) : cvJson;

  const run = await runSkill({
    slug: 'mon-cv-extract-atomic-subjects',
    userId,
    userEmail,
    buildContext: () => `## Contexte\n\n\`\`\`json\n${cvJsonClipped}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON des sujets atomiques.`,
    inputContent: cvJsonClipped,
    sourceKind: 'cv',
    sourceTitle: cvData.name || cvData.title || 'CV',
    maxTokens: 8000,
  });

  const subjects = parseJsonArray<AtomicSubject>(run.outputText);
  return { subjects: subjects ?? [], logId: run.logId };
}

// ────────────────────────────────────────────────────────────────────
// Skill B — adapt atomic subjects to a job offer (batch + single).
// ────────────────────────────────────────────────────────────────────

export async function adaptAllAtomics(
  atomics: AtomicSubject[],
  jobOffer: string,
  userId: number,
  userEmail: string | null = null,
): Promise<{ proposals: AdaptedAtomic[]; logId: number | null }> {
  if (atomics.length === 0) return { proposals: [], logId: null };

  const payload = { atomics, jobOffer };
  const json = JSON.stringify(payload, null, 2);
  const clipped = json.length > 60000 ? json.slice(0, 60000) : json;

  const run = await runSkill({
    slug: 'mon-cv-adapt-atomic-to-offer',
    userId,
    userEmail,
    buildContext: () => `## Contexte (mode batch)\n\n\`\`\`json\n${clipped}\n\`\`\`\n\nRenvoie UNIQUEMENT le tableau JSON des propositions, un objet par sujet, dans le même ordre.`,
    inputContent: clipped,
    sourceKind: 'cv',
    sourceTitle: 'Adaptation batch',
    maxTokens: 8000,
  });

  const proposals = parseJsonArray<AdaptedAtomic>(run.outputText) ?? [];
  return { proposals, logId: run.logId };
}

export async function adaptOneAtomic(
  atomic: AtomicSubject,
  jobOffer: string,
  userId: number,
  userEmail: string | null = null,
): Promise<{ proposal: AdaptedAtomic | null; logId: number | null }> {
  const payload = { atomic, jobOffer };
  const json = JSON.stringify(payload, null, 2);

  const run = await runSkill({
    slug: 'mon-cv-adapt-atomic-to-offer',
    userId,
    userEmail,
    buildContext: () => `## Contexte (mode single)\n\n\`\`\`json\n${json}\n\`\`\`\n\nRenvoie UNIQUEMENT l'objet JSON de la proposition pour ce sujet.`,
    inputContent: json,
    sourceKind: 'cv',
    sourceTitle: `Régénération : ${atomic.label}`,
    maxTokens: 1000,
  });

  const proposal = parseJsonObject<AdaptedAtomic>(run.outputText);
  return { proposal, logId: run.logId };
}

// ────────────────────────────────────────────────────────────────────
// Persistence — bulk insert + per-tile updates.
// ────────────────────────────────────────────────────────────────────

/** Take the atomics from skill A and the proposals from skill B,
 *  pair them by id, and persist as `cv_adaptation_tiles` rows. Any
 *  atomic without a matching proposal falls back to its
 *  originalText (no AI proposal — user can still accept/skip). */
export async function persistTilesForAdaptation(
  adaptationId: number,
  atomics: AtomicSubject[],
  proposals: AdaptedAtomic[],
): Promise<CVAdaptationTile[]> {
  const proposalsById = new Map(proposals.map(p => [p.id, p]));
  const rows = atomics.map(a => {
    const p = proposalsById.get(a.id);
    return {
      tileId: a.id,
      path: a.path,
      kind: a.kind,
      originalText: a.originalText,
      proposedText: p?.proposedText && p.proposedText.trim().length > 0
        ? p.proposedText
        : a.originalText,
    };
  });
  return adaptDb.insertTilesForAdaptation(adaptationId, rows);
}

// ────────────────────────────────────────────────────────────────────
// Path-based JSONB merge.
// ────────────────────────────────────────────────────────────────────

/** Walk a `path` like "experiences[2].missions[0]" and write
 *  `finalText` at that location inside `cvData`. Mutates a deep
 *  clone, returns it (the original is untouched). Best-effort —
 *  silently no-ops if the path doesn't match the CV structure (an
 *  unmatched path would only happen if the underlying CV was edited
 *  between extract and apply). */
export function applyTextAtPath(cvData: CVData, path: string, finalText: string): CVData {
  const next = JSON.parse(JSON.stringify(cvData)) as CVData;
  const segments = parsePath(path);
  if (segments.length === 0) return next;

  let cursor: any = next;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (cursor == null) return next;
    cursor = seg.kind === 'index' ? cursor[seg.value] : cursor[seg.value];
    if (cursor == null) return next;
  }
  const last = segments[segments.length - 1];
  if (cursor == null) return next;
  if (last.kind === 'index') cursor[last.value] = finalText;
  else cursor[last.value] = finalText;
  return next;
}

type Segment = { kind: 'key'; value: string } | { kind: 'index'; value: number };

function parsePath(path: string): Segment[] {
  // Tokenise patterns like "experiences[2].projects[1].title" into
  // [{key,'experiences'},{index,2},{key,'projects'},{index,1},{key,'title'}].
  // Tolerant : accepts dot-only paths like "summary".
  const out: Segment[] = [];
  const tokenRe = /([a-zA-Z_][a-zA-Z0-9_]*)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(path)) !== null) {
    if (m[1] != null) out.push({ kind: 'key', value: m[1] });
    else if (m[2] != null) out.push({ kind: 'index', value: parseInt(m[2], 10) });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Tolerant JSON parsing (skill outputs sometimes wrap in markdown).
// ────────────────────────────────────────────────────────────────────

function parseJsonArray<T>(raw: string): T[] | null {
  try {
    const cleaned = stripMarkdownFences(raw);
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed as T[] : null;
  } catch {
    // Last-resort : extract the first [..] block.
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try { return JSON.parse(match[0]) as T[]; } catch { return null; }
  }
}

function parseJsonObject<T>(raw: string): T | null {
  try {
    const cleaned = stripMarkdownFences(raw);
    return JSON.parse(cleaned) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]) as T; } catch { return null; }
  }
}

function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  return s;
}
