// Cross-document duplicate-subject detection.
//
// Single-shot LLM call : take every subject the user can see (flattened
// to `{ subject, section, document }`), hand them to the
// `suivitess-detect-cross-doc-duplicates` skill, get back N groups of
// 2..5 subjects coming from DISTINCT documents that converge to the
// same theme. The user picks a canonical "parent" per group ; we
// materialize the duplicates as cross-links via the same helper the
// LinkSubjectModal flow uses (`createSubjectCrossLink`). Each apply
// persists an undo row in `suivitess_duplicate_detection_runs` so the
// whole batch can be reverted from a toast affordance.

import { runSkill } from '../aiSkills/runSkill.js';
import * as db from './dbService.js';

// ────────────────────────────────────────────────────────────────────
// Types — exported so routes + frontend share shapes.
// ────────────────────────────────────────────────────────────────────

export interface DuplicateGroup {
  subjectIds: string[];
  confidence: 'high' | 'medium';
  reasoning: string;
}

/** Subject payload shipped to the frontend modal alongside the groups.
 *  Indexed by `id` for O(1) lookup at render time. */
export interface DuplicateSubject {
  id: string;
  title: string;
  status: string;
  responsibility: string | null;
  situationExcerpt: string;
  documentId: string;
  documentTitle: string;
  sectionId: string;
  sectionName: string;
  updatedAt: string;
}

export interface DetectionResult {
  logId: number | null;
  groups: DuplicateGroup[];
  subjects: Record<string, DuplicateSubject>;
  subjectCount: number;
  /** True when the LLM output was non-trivial but couldn't be parsed
   *  (likely max_tokens truncation). The frontend surfaces this as a
   *  distinct error message so the user understands why no groups
   *  came back despite a long wait. */
  truncated?: boolean;
}

export interface AppliedLink {
  parentId: string;
  duplicateId: string;
  linkId: string;
}

export interface ApplyDuplicateResult {
  groupsApplied: number;
  linksCreated: number;
  errors: Array<{ subjectId: string; error: string }>;
  runId: string | null;
}

interface AppliedGroupRecord {
  parentId: string;
  duplicates: AppliedLink[];
}

// Maximum number of subjects we send to the LLM. Beyond this the input
// payload gets too big for the model to reason coherently about the
// whole portfolio in one shot. Ordered by `updated_at DESC` so we keep
// the freshest ones — most relevant for duplicate detection.
const MAX_SUBJECTS_PER_RUN = 300;

// First N chars of the situation we expose to the model. Keeps the
// payload lean while still giving enough context to disambiguate two
// titles that read alike but cover different work.
const SITUATION_EXCERPT_CHARS = 300;

// ────────────────────────────────────────────────────────────────────
// Output parser — defensive, the model sometimes wraps the JSON in
// fences or adds a trailing comment despite the prompt.
// ────────────────────────────────────────────────────────────────────

/** Extract and parse the groups array from raw LLM output. Returns []
 *  on any structural issue — the caller surfaces it as "no duplicates
 *  found" rather than crashing. Pure function, easy to test. */
export function parseDuplicateDetectionOutput(raw: string): DuplicateGroup[] {
  if (!raw || typeof raw !== 'string') return [];
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return [];
  }
  const root = parsed as { groups?: unknown };
  if (!root || !Array.isArray(root.groups)) return [];
  const out: DuplicateGroup[] = [];
  for (const g of root.groups as unknown[]) {
    const o = g as Record<string, unknown>;
    if (!o || typeof o !== 'object') continue;
    const ids = Array.isArray(o.subjectIds)
      ? (o.subjectIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
    if (ids.length < 2) continue;
    const confRaw = typeof o.confidence === 'string' ? o.confidence.toLowerCase() : 'medium';
    if (confRaw === 'low') continue;
    const confidence: 'high' | 'medium' = confRaw === 'high' ? 'high' : 'medium';
    const reasoning = typeof o.reasoning === 'string' ? o.reasoning.trim() : '';
    out.push({ subjectIds: ids, confidence, reasoning });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Safety net — even though the prompt forbids same-document groups,
// we defend the contract server-side. Pure function, easy to test.
// ────────────────────────────────────────────────────────────────────

/** Drop any group whose subjects all live in the same document. The
 *  prompt forbids this but we never trust the model on safety. Returns
 *  a filtered copy. */
export function dropSameDocGroups(
  groups: DuplicateGroup[],
  subjectDocMap: Map<string, string>,
): DuplicateGroup[] {
  const out: DuplicateGroup[] = [];
  for (const g of groups) {
    const docs = new Set<string>();
    let allKnown = true;
    for (const sid of g.subjectIds) {
      const doc = subjectDocMap.get(sid);
      if (!doc) { allKnown = false; break; }
      docs.add(doc);
    }
    // Drop groups where any subjectId is unknown (hallucinated id) OR
    // every known subject sits in the same document.
    if (!allKnown) continue;
    if (docs.size < 2) continue;
    // Cap subjectIds at 5 if the model overshot the soft cap.
    out.push({
      ...g,
      subjectIds: g.subjectIds.slice(0, 5),
    });
  }
  // Hard cap on the number of groups returned (20 per prompt rule).
  return out.slice(0, 20);
}

// ────────────────────────────────────────────────────────────────────
// detectCrossDocDuplicatesForUser — main detection entry point.
// ────────────────────────────────────────────────────────────────────

/** Snapshot the user's subject portfolio + run the detection skill.
 *  Subjects already involved in a cross-link (either side) are filtered
 *  out — they've been manually deduped already, no point re-asking. */
export async function detectCrossDocDuplicatesForUser(
  userId: number,
  userEmail: string | null,
  isAdmin: boolean,
): Promise<DetectionResult> {
  // 1) Load every document the user can see, expand to sections +
  //    subjects, and flatten to a `DuplicateSubject` payload.
  const docs = await db.getAllDocuments(userId, isAdmin);
  const subjects: DuplicateSubject[] = [];
  const subjectMap: Record<string, DuplicateSubject> = {};
  for (const doc of docs as Array<{ id: string; title: string }>) {
    const full = await db.getDocumentWithSections(doc.id);
    if (!full) continue;
    for (const section of full.sections) {
      for (const sub of section.subjects) {
        // Skip subjects surfaced via a cross-link — they're already a
        // pointer to a canonical row living in another section.
        if (sub.linkedFromSectionId) continue;
        const situation = (sub.situation ?? '').toString();
        const excerpt = situation.length > SITUATION_EXCERPT_CHARS
          ? situation.slice(0, SITUATION_EXCERPT_CHARS)
          : situation;
        const payload: DuplicateSubject = {
          id: sub.id,
          title: sub.title,
          status: sub.status,
          responsibility: sub.responsibility ?? null,
          situationExcerpt: excerpt,
          documentId: full.id,
          documentTitle: full.title,
          sectionId: section.id,
          sectionName: (section as { name: string }).name,
          updatedAt: typeof sub.updated_at === 'string'
            ? sub.updated_at
            : (sub.updated_at as unknown as Date | undefined)?.toISOString?.() ?? '',
        };
        subjects.push(payload);
      }
    }
  }

  // 2) Filter out subjects already involved in any cross-link (either
  //    as origin OR as a linked target's pointer). They've been deduped
  //    manually — no point re-asking the model.
  let alreadyLinkedIds = new Set<string>();
  try {
    const r = await db.pool.query<{ origin_subject_id: string }>(
      `SELECT DISTINCT origin_subject_id
         FROM suivitess_subject_cross_links cl
        WHERE cl.origin_subject_id IN (
           SELECT id FROM suivitess_subjects
            WHERE section_id IN (
              SELECT id FROM suivitess_sections
               WHERE document_id = ANY($1::varchar[])
            )
        )`,
      [(docs as Array<{ id: string }>).map(d => d.id)],
    );
    alreadyLinkedIds = new Set(r.rows.map(row => row.origin_subject_id));
  } catch {
    // If the table doesn't exist yet (very fresh DB), assume no links.
    alreadyLinkedIds = new Set();
  }
  const filtered = subjects.filter(s => !alreadyLinkedIds.has(s.id));

  // 3) Sort by updatedAt DESC and cap at MAX_SUBJECTS_PER_RUN. The cap
  //    keeps the prompt under the model's effective reasoning window.
  filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const capped = filtered.slice(0, MAX_SUBJECTS_PER_RUN);
  for (const s of capped) subjectMap[s.id] = s;

  if (capped.length < 2) {
    // Not enough material to detect anything — skip the LLM call.
    return {
      logId: null,
      groups: [],
      subjects: subjectMap,
      subjectCount: capped.length,
    };
  }

  // 4) Build the LLM input — slim shape that matches the prompt's contract.
  const inputPayload = {
    subjects: capped.map(s => ({
      id: s.id,
      title: s.title,
      situationExcerpt: s.situationExcerpt,
      status: s.status,
      responsibility: s.responsibility,
      documentId: s.documentId,
      documentTitle: s.documentTitle,
      sectionName: s.sectionName,
      updatedAt: s.updatedAt,
    })),
  };
  const inputJson = JSON.stringify(inputPayload, null, 2);

  const run = await runSkill({
    slug: 'suivitess-detect-cross-doc-duplicates',
    userId,
    userEmail: userEmail ?? null,
    sourceKind: 'duplicate-detection',
    sourceTitle: `Detect cross-doc duplicates (${capped.length} subjects)`,
    inputContent: inputJson,
    buildContext: () => `## Contexte\n\n\`\`\`json\n${inputJson}\n\`\`\``,
    maxTokens: 4000,
  });

  const parsed = parseDuplicateDetectionOutput(run.outputText);
  const looksTruncated =
    parsed.length === 0
    && typeof run.outputText === 'string'
    && run.outputText.length > 2000
    && !/\]\s*\}\s*```?\s*$/.test(run.outputText.trimEnd());

  // 5) Safety net : drop groups that violate the cross-doc rule.
  const docMap = new Map<string, string>();
  for (const s of capped) docMap.set(s.id, s.documentId);
  const safe = dropSameDocGroups(parsed, docMap);

  return {
    logId: run.logId,
    groups: safe,
    subjects: subjectMap,
    subjectCount: capped.length,
    truncated: looksTruncated || undefined,
  };
}

// ────────────────────────────────────────────────────────────────────
// applyDuplicateLinks — materialize the user-accepted groups.
// ────────────────────────────────────────────────────────────────────

/** For each accepted group, create one cross-link per duplicate
 *  pointing at the parent subject. Records the applied links in
 *  `suivitess_duplicate_detection_runs` for undo. */
export async function applyDuplicateLinks(
  userId: number,
  acceptedGroups: Array<{ parentId: string; duplicateIds: string[] }>,
  logId: number | null,
): Promise<ApplyDuplicateResult> {
  const result: ApplyDuplicateResult = {
    groupsApplied: 0,
    linksCreated: 0,
    errors: [],
    runId: null,
  };
  if (!Array.isArray(acceptedGroups) || acceptedGroups.length === 0) {
    return result;
  }

  const applied: AppliedGroupRecord[] = [];

  for (const group of acceptedGroups) {
    const parentId = (group.parentId || '').trim();
    const duplicateIds = Array.isArray(group.duplicateIds)
      ? group.duplicateIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (!parentId || duplicateIds.length === 0) continue;

    // Validate the parent belongs to the user.
    const parent = await db.getSubjectWithDocId(parentId);
    if (!parent) {
      result.errors.push({ subjectId: parentId, error: 'Sujet parent introuvable' });
      continue;
    }
    const parentDocAllowed = await userCanAccessDocument(userId, parent.document_id);
    if (!parentDocAllowed) {
      result.errors.push({ subjectId: parentId, error: 'Accès refusé au sujet parent' });
      continue;
    }

    const groupLinks: AppliedLink[] = [];
    for (const dupId of duplicateIds) {
      if (dupId === parentId) continue;
      try {
        const dup = await db.getSubjectWithDocId(dupId);
        if (!dup) {
          result.errors.push({ subjectId: dupId, error: 'Sujet doublon introuvable' });
          continue;
        }
        const dupDocAllowed = await userCanAccessDocument(userId, dup.document_id);
        if (!dupDocAllowed) {
          result.errors.push({ subjectId: dupId, error: 'Accès refusé au sujet doublon' });
          continue;
        }
        // Create the cross-link : the duplicate's CANONICAL section gets
        // a link back to the parent's canonical id. So the parent now
        // appears in the duplicate's section as a "lié depuis" card.
        const link = await db.createSubjectCrossLink(parentId, dup.section_id);
        if (!link) {
          result.errors.push({ subjectId: dupId, error: 'Lien non créé (même section que le parent)' });
          continue;
        }
        groupLinks.push({ parentId, duplicateId: dupId, linkId: link.id });
        result.linksCreated++;
      } catch (err) {
        result.errors.push({ subjectId: dupId, error: (err as Error).message });
      }
    }

    if (groupLinks.length > 0) {
      applied.push({ parentId, duplicates: groupLinks });
      result.groupsApplied++;
    }
  }

  if (applied.length > 0) {
    try {
      const r = await db.pool.query<{ id: string }>(
        `INSERT INTO suivitess_duplicate_detection_runs (user_id, ai_log_id, applied_groups)
         VALUES ($1, $2, $3::jsonb) RETURNING id`,
        [userId, logId ?? null, JSON.stringify(applied)],
      );
      result.runId = r.rows[0]?.id ?? null;
    } catch (err) {
      console.warn('[duplicate-detection] failed to persist run:', (err as Error).message);
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────
// revertDuplicateRun — delete every link the apply created.
// ────────────────────────────────────────────────────────────────────

export async function revertDuplicateRun(
  userId: number,
  runId: string,
): Promise<{ linksRemoved: number }> {
  const r = await db.pool.query<{ id: string; applied_groups: AppliedGroupRecord[]; reverted_at: Date | null }>(
    `SELECT id, applied_groups, reverted_at
       FROM suivitess_duplicate_detection_runs
      WHERE id = $1 AND user_id = $2`,
    [runId, userId],
  );
  if (r.rowCount === 0) {
    throw new Error('Détection introuvable');
  }
  if (r.rows[0].reverted_at) {
    throw new Error('Cette détection a déjà été annulée');
  }
  const groups = r.rows[0].applied_groups ?? [];
  let linksRemoved = 0;
  for (const g of groups) {
    for (const link of g.duplicates ?? []) {
      try {
        const ok = await db.deleteSubjectCrossLink(link.linkId);
        if (ok) linksRemoved++;
      } catch (err) {
        console.warn('[duplicate-detection] failed to remove link:',
          link.linkId, (err as Error).message);
      }
    }
  }
  await db.pool.query(
    'UPDATE suivitess_duplicate_detection_runs SET reverted_at = NOW() WHERE id = $1',
    [runId],
  );
  return { linksRemoved };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Light document-access check — the user must own the doc OR it must
 *  appear in the visibility-filtered list from `getAllDocuments`. */
async function userCanAccessDocument(userId: number, documentId: string): Promise<boolean> {
  // Reuse the same visibility rules as `getAllDocuments` by re-running
  // the access filter. Cheap : one indexed query per call site, and
  // apply is rare (only on user click).
  const r = await db.pool.query<{ id: string }>(
    `SELECT d.id FROM suivitess_documents d
       LEFT JOIN resource_sharing rs ON rs.resource_type = 'suivitess' AND rs.resource_id = d.id
       LEFT JOIN resource_shares rsh ON rsh.resource_type = 'suivitess' AND rsh.resource_id = d.id AND rsh.shared_with_user_id = $1
      WHERE d.id = $2
        AND (rs.id IS NULL OR rs.owner_id = $1 OR rs.visibility = 'public' OR rsh.id IS NOT NULL)
      LIMIT 1`,
    [userId, documentId],
  );
  return (r.rowCount ?? 0) > 0;
}
