// ═══════════════════════════════════════════════════════════════════════
// Code-level deduplication of new-subject proposals from a single
// pipeline run. Belt-and-suspenders companion to the prompt-level
// "self-dedup" rule shipped on every skill that emits new subjects.
//
// Why this exists : the prompts already tell the model "scan your own
// new-subject decisions, fuse near-duplicates" — but when two facets
// of the same theme come from different parts of the source, the model
// occasionally still emits two cards with near-identical titles. This
// is the deterministic safety net.
//
// What "near-duplicate" means here : the two titles match after
// normalization (lowercase, accent-fold, strip punctuation, drop short
// French stop-words). Conservative on purpose — won't merge legit pairs
// like "Slider 6 ans" / "Slider 8 ans" because the digit differs.
// ═══════════════════════════════════════════════════════════════════════

import type { FinalDocumentProposal } from '../aiSkills/analyzeSourcePipeline.js';

const STOP_WORDS = new Set([
  'de', 'du', 'la', 'le', 'les', 'des', 'un', 'une',
  'sur', 'pour', 'a', 'au', 'aux', 'et', 'en', 'l', 'd', 's',
  'the', 'of', 'for', 'on', 'to', 'in', 'and',
]);

/** Returns a comparison key for two titles. Two strings sharing the
 *  same key are treated as the same topic. */
export function normalizeTitleForCompare(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = String(raw).toLowerCase();
  // Fold accents : é → e, à → a, ç → c, etc.
  s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  // Replace non-alphanum with single spaces.
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return '';
  // Drop short / structural stop-words.
  const tokens = s.split(' ').filter(t => t.length > 0 && !STOP_WORDS.has(t));
  return tokens.join(' ');
}

/** Helper : extract the user-visible title from a proposal, regardless
 *  of action. Returns `null` for `enrich` (which references an
 *  existing subject — never deduped). */
function getProposalTitle(p: FinalDocumentProposal): string | null {
  if (p.action === 'create_subject') return p.title ?? null;
  if (p.action === 'create_section') return p.subjects?.[0]?.title ?? null;
  return null; // enrich
}

function uniqueByIdentity<T>(arr: T[]): T[] {
  return arr.filter((item, i) => arr.indexOf(item) === i);
}

function joinUniqueLines(...parts: Array<string | undefined | null>): string {
  return parts
    .filter((s): s is string => !!s && s.trim().length > 0)
    .map(s => s.trim())
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .join('\n');
}

export interface DedupResult {
  deduped: FinalDocumentProposal[];
  /** For each entry in `deduped`, the index in the *input* array of the
   *  proposal that was the survivor of its merge group. Lets callers
   *  re-align parallel arrays (e.g. multi-source `consolidationByProposal`)
   *  after dedup without rebuilding from scratch. */
  survivorOriginalIndices: number[];
  mergedCount: number;
}

/**
 * Collapses near-duplicate `create_subject` / `create_section`
 * proposals. `enrich` proposals pass through untouched.
 *
 * Two passes :
 *  1. **Subject-title dedup** — proposals with the same normalized
 *     subject title are merged (the first survives, others'
 *     situations are appended).
 *  2. **Section-name dedup** — `create_section` proposals with the
 *     same normalized section name are merged (their `subjects[]`
 *     are concatenated, also deduped).
 *
 * Returns `{ deduped, mergedCount }` — `mergedCount` aggregates both
 * passes so callers can log a single number when the safety net fires.
 */
/** Internal entry that ties a proposal to its index in the original
 *  `proposals` argument — preserved through both passes so the final
 *  `survivorOriginalIndices` array stays aligned. */
type Indexed = { proposal: FinalDocumentProposal; originalIndex: number };

export function dedupNearDuplicateDocumentProposals(
  proposals: FinalDocumentProposal[],
): DedupResult {
  // Pass 1 : subject-title dedup
  const groups = new Map<string, Indexed[]>();
  const passthrough: Indexed[] = [];

  proposals.forEach((proposal, originalIndex) => {
    const entry: Indexed = { proposal, originalIndex };
    const title = getProposalTitle(proposal);
    const key = normalizeTitleForCompare(title);
    if (!key) {
      passthrough.push(entry);
      return;
    }
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  });

  const afterPass1: Indexed[] = [...passthrough];
  let mergedCount = 0;

  for (const list of groups.values()) {
    if (list.length === 1) {
      afterPass1.push(list[0]);
      continue;
    }
    afterPass1.push({
      proposal: mergeProposalGroup(list.map(e => e.proposal)),
      originalIndex: list[0].originalIndex,
    });
    mergedCount += list.length - 1;
  }

  // Pass 2 : section-name dedup on `create_section` proposals
  const sectionGroups = new Map<string, Indexed[]>();
  const sectionPassthrough: Indexed[] = [];

  for (const entry of afterPass1) {
    if (entry.proposal.action !== 'create_section') {
      sectionPassthrough.push(entry);
      continue;
    }
    const key = normalizeTitleForCompare(entry.proposal.sectionName ?? '');
    if (!key) {
      sectionPassthrough.push(entry);
      continue;
    }
    const bucket = sectionGroups.get(key);
    if (bucket) bucket.push(entry);
    else sectionGroups.set(key, [entry]);
  }

  const finalEntries: Indexed[] = [...sectionPassthrough];
  for (const list of sectionGroups.values()) {
    if (list.length === 1) {
      finalEntries.push(list[0]);
      continue;
    }
    finalEntries.push({
      proposal: mergeSectionGroup(list.map(e => e.proposal)),
      originalIndex: list[0].originalIndex,
    });
    mergedCount += list.length - 1;
  }

  return {
    deduped: finalEntries.map(e => e.proposal),
    survivorOriginalIndices: finalEntries.map(e => e.originalIndex),
    mergedCount,
  };
}

/** Merge multiple `create_section` proposals that share the same
 *  normalized section name. Concatenates their subjects (deduped by
 *  normalized title) into a single section. */
function mergeSectionGroup(list: FinalDocumentProposal[]): FinalDocumentProposal {
  const survivor = list[0];
  const tail = list.slice(1);
  if (survivor.action !== 'create_section') return survivor;

  // Concatenate subjects across all sections, deduped by title.
  const seen = new Set<string>();
  const allSubjects: NonNullable<FinalDocumentProposal['subjects']> = [];
  for (const p of list) {
    if (p.action !== 'create_section' || !p.subjects) continue;
    for (const s of p.subjects) {
      const key = normalizeTitleForCompare(s.title);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      allSubjects.push(s);
    }
  }

  const allRawQuotes = uniqueByIdentity(list.flatMap(p => p.sourceRawQuotes ?? []));
  const allEntities = uniqueByIdentity(list.flatMap(p => p.sourceEntities ?? []));
  const allParticipants = uniqueByIdentity(list.flatMap(p => p.sourceParticipants ?? []));

  return {
    ...survivor,
    subjects: allSubjects,
    sourceRawQuotes: allRawQuotes,
    sourceEntities: allEntities,
    sourceParticipants: allParticipants,
    reason: `${survivor.reason ?? ''} (fusionné avec ${tail.length} section${tail.length > 1 ? 's' : ''} au nom quasi-identique)`.trim(),
  };
}

/** Merge a group of proposals sharing the same normalized title.
 *  The first item is the survivor; others' `situation` is appended,
 *  source-context arrays are unioned. */
function mergeProposalGroup(list: FinalDocumentProposal[]): FinalDocumentProposal {
  const survivor = list[0];
  const tail = list.slice(1);

  const allRawQuotes = uniqueByIdentity(list.flatMap(p => p.sourceRawQuotes ?? []));
  const allEntities = uniqueByIdentity(list.flatMap(p => p.sourceEntities ?? []));
  const allParticipants = uniqueByIdentity(list.flatMap(p => p.sourceParticipants ?? []));

  const mergeMarker = ` (fusionné avec ${tail.length} proposition${tail.length > 1 ? 's' : ''} au titre quasi-identique)`;
  const reason = `${survivor.reason ?? ''}${mergeMarker}`.trim();

  if (survivor.action === 'create_subject') {
    const tailSituations = tail.map(p => p.action === 'create_subject' ? p.situation : null);
    return {
      ...survivor,
      situation: joinUniqueLines(survivor.situation, ...tailSituations),
      sourceRawQuotes: allRawQuotes,
      sourceEntities: allEntities,
      sourceParticipants: allParticipants,
      reason,
    };
  }

  if (survivor.action === 'create_section' && survivor.subjects?.[0]) {
    const tailSituations = tail.map(p => {
      if (p.action === 'create_section') return p.subjects?.[0]?.situation ?? null;
      if (p.action === 'create_subject') return p.situation ?? null;
      return null;
    });
    return {
      ...survivor,
      subjects: [{
        ...survivor.subjects[0],
        situation: joinUniqueLines(survivor.subjects[0].situation, ...tailSituations),
      }],
      sourceRawQuotes: allRawQuotes,
      sourceEntities: allEntities,
      sourceParticipants: allParticipants,
      reason,
    };
  }

  return survivor;
}
