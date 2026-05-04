// Tile-by-tile CV adaptation pipeline.
//
// The flow :
//   1. **Extraction (deterministic, NO AI)** — `extractAtomicsFromCV()`
//      walks the structured CVData JSON and emits one `AtomicSubject`
//      per adaptable field. Free and instant ; replaces what used to be
//      "skill A". The CV is already structured in DB so paying for an
//      LLM to re-extract it was wasteful.
//   2. Skill B (`mon-cv-adapt-atomic-to-offer`) takes the list + the
//      job offer and proposes adapted text for each atomic subject.
//      Same skill is invoked single-mode when the user clicks
//      "Régénérer" on a tile.
//   3. The resulting tiles are persisted into `cv_adaptation_tiles`.
//      As the user accepts / edits each tile in the modal, the chosen
//      text is merged back into `cv_adaptations.adapted_cv` at the
//      atomic's `path`.
//
// AI calls go through `runSkill()` so the runs are logged in
// `ai_analysis_logs` and visible from /ai-logs.

import { runSkill } from '../aiSkills/runSkill.js';
import * as adaptDb from './adaptationDbService.js';
import type { CVAdaptationTile } from './adaptationDbService.js';
import type { CVData, Experience, Project, Formation, Award, SideProjectItem } from './types.js';

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
// Extraction — deterministic walk of CVData (no AI call).
// ────────────────────────────────────────────────────────────────────

const TRUE = (s: string | null | undefined): boolean => !!(s && s.trim().length > 0);

/** Flatten a CVData object into the atomic subjects the modal will
 *  show. Pure function — no LLM, no I/O. Skips empty fields and
 *  fields that don't make sense to adapt to a job offer
 *  (name/contact/photo). The resulting `id` IS the `path` (already
 *  stable, no need for an extra hash). */
export function extractAtomicsFromCV(cvData: CVData): AtomicSubject[] {
  const out: AtomicSubject[] = [];
  const push = (path: string, kind: string, originalText: string, label: string) => {
    if (!TRUE(originalText)) return;
    out.push({ id: path, path, kind, originalText, label });
  };

  // Top-level adaptable scalars.
  push('summary', 'summary', cvData.summary ?? '', 'Présentation');
  push('title', 'professional_title', cvData.title ?? '', 'Titre professionnel');

  // Flat skill arrays. Use index-based labels so duplicates ("React"
  // appearing twice somewhere) don't clobber each other.
  const skillBuckets: Array<[keyof CVData, string, string]> = [
    ['languages',   'language',         'Langue'],
    ['competences', 'skill_competence', 'Compétence'],
    ['outils',      'skill_outil',      'Outil'],
    ['dev',         'skill_dev',        'Dev'],
    ['frameworks',  'skill_framework',  'Framework'],
    ['solutions',   'skill_solution',   'Solution'],
  ];
  for (const [field, kind, prefix] of skillBuckets) {
    const arr = (cvData[field] as string[] | undefined) ?? [];
    arr.forEach((value, i) => {
      push(`${field}[${i}]`, kind, value, `${prefix} : ${value || '(vide)'}`);
    });
  }

  // Experiences — one big nested block per row. Adds tiles for
  // title, description, missions, project titles + descriptions.
  const experiences = cvData.experiences ?? [];
  experiences.forEach((exp: Experience, i) => {
    const company = exp.company || `Expérience #${i + 1}`;
    push(`experiences[${i}].title`, 'experience_title', exp.title ?? '', `${company} — Poste`);
    push(`experiences[${i}].description`, 'experience_description', exp.description ?? '', `${company} — Description`);
    (exp.missions ?? []).forEach((m, j) => {
      push(`experiences[${i}].missions[${j}]`, 'mission', m, `${company} — Mission #${j + 1}`);
    });
    (exp.projects ?? []).forEach((p: Project, j) => {
      push(`experiences[${i}].projects[${j}].title`, 'project_title', p.title ?? '', `${company} — Projet #${j + 1} (titre)`);
      push(`experiences[${i}].projects[${j}].description`, 'project_description', p.description ?? '', `${company} — Projet #${j + 1} (description)`);
    });
  });

  // Formations / awards — only their `title` is interesting to adapt.
  (cvData.formations ?? []).forEach((f: Formation, i) => {
    push(`formations[${i}].title`, 'formation_title', f.title ?? '', `Formation #${i + 1}`);
  });
  (cvData.awards ?? []).forEach((a: Award, i) => {
    push(`awards[${i}].title`, 'award_title', a.title ?? '', `Distinction #${i + 1}`);
  });

  // Side projects.
  const sp = cvData.sideProjects;
  if (sp?.items) {
    sp.items.forEach((item: SideProjectItem, i) => {
      push(`sideProjects.items[${i}].category`, 'side_project_category', item.category ?? '', `Side projects — Catégorie #${i + 1}`);
      (item.projects ?? []).forEach((p, j) => {
        push(`sideProjects.items[${i}].projects[${j}]`, 'side_project_item', p, `Side projects — Item #${j + 1}`);
      });
    });
  }

  return out;
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
    // Same 16k cap as skill A : N atomics × ~150 tokens of JSON
    // per proposal saturates 8k for any CV with > ~50 atomics.
    maxTokens: 16000,
  });

  const proposals = parseJsonArray<AdaptedAtomic>(run.outputText) ?? [];
  if (proposals.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[mon-cv adapt batch] skill B returned empty/unparseable output (logId=${run.logId}). Raw (first 2k):\n${run.outputText.slice(0, 2000)}`,
    );
  }
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
      label: a.label,
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

/** Tolerant JSON-array parser. Tries, in order :
 *   1. JSON.parse on the trimmed input (happy path).
 *   2. Strip a leading/trailing ```json fence + retry.
 *   3. Find the first ```json…``` block ANYWHERE in the output.
 *   4. Largest [...] substring fallback.
 *   5. **Truncation recovery** : if the model hit max_tokens
 *      mid-string, keep every COMPLETE `{…}` item up to the last
 *      one, then close the array — same idea as the suivitess
 *      pipeline's `extractJson()`. Lets us salvage 90% of the work
 *      when the cap is reached.
 *  Returns null if every attempt fails — the caller logs the raw
 *  output so /ai-logs can show what the skill produced. */
function parseJsonArray<T>(raw: string): T[] | null {
  const candidates: string[] = [];
  candidates.push(raw.trim());
  candidates.push(stripMarkdownFences(raw));
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1].trim());
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (arrMatch) candidates.push(arrMatch[0]);
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed as T[];
      // Some models wrap the array in `{ "subjects": [...] }`.
      if (parsed && typeof parsed === 'object') {
        for (const v of Object.values(parsed)) {
          if (Array.isArray(v)) return v as T[];
        }
      }
    } catch { /* try next */ }
  }
  // ── Truncation recovery ────────────────────────────────────────
  // Find the open bracket, then the last complete object before the
  // cut-off. Close the array around it. This rescues the items that
  // DID make it through when max_tokens was reached mid-emission.
  const openArr = raw.indexOf('[');
  if (openArr >= 0) {
    const body = raw.slice(openArr);
    const lastClose = Math.max(body.lastIndexOf('},'), body.lastIndexOf('}\n'), body.lastIndexOf('} '));
    if (lastClose > 0) {
      const truncated = body.slice(0, lastClose + 1) + ']';
      try {
        const parsed = JSON.parse(truncated);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as T[];
      } catch { /* fall through */ }
    }
    // One last shot : a lone complete object at the end.
    const lastBrace = body.lastIndexOf('}');
    if (lastBrace > 0) {
      const truncated = body.slice(0, lastBrace + 1) + ']';
      try {
        const parsed = JSON.parse(truncated);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as T[];
      } catch { /* give up */ }
    }
  }
  return null;
}

function parseJsonObject<T>(raw: string): T | null {
  const candidates: string[] = [];
  candidates.push(raw.trim());
  candidates.push(stripMarkdownFences(raw));
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1].trim());
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c) as T; } catch { /* try next */ }
  }
  return null;
}

function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  return s;
}
