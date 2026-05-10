// Pure helper that summarises a FinalReviewProposal[] (= what the
// auto-import scheduler stored in `suivitess_inbox_proposals.proposals`)
// into the counts the inbox UI surfaces on each card.
//
// The proposal shape mirrors `FinalReviewProposal` in the backend
// pipeline — but we keep this side decoupled with an unknown[] cast +
// optional fields so a stale inbox row from an older schema still
// renders cleanly without crashing.

export interface InboxProposalStats {
  /** subjectAction === 'new-subject'                 */
  newSubjects: number;
  /** subjectAction === 'update-existing-subject'     */
  updatedSubjects: number;
  /** distinct (review, suggestedNewSectionName)
   *  pairs where sectionAction === 'new-section'     */
  newSections: number;
  /** distinct suggestedNewReviewTitle values where
   *  action === 'new-review'                         */
  newReviews: number;
}

export function countInboxProposalStats(proposals: unknown): InboxProposalStats {
  const arr = Array.isArray(proposals) ? proposals : [];
  let newSubjects = 0;
  let updatedSubjects = 0;
  const newSectionKeys = new Set<string>();
  const newReviewTitles = new Set<string>();

  for (const raw of arr) {
    const p = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    if (p.subjectAction === 'new-subject') newSubjects++;
    else if (p.subjectAction === 'update-existing-subject') updatedSubjects++;

    if (p.sectionAction === 'new-section' && typeof p.suggestedNewSectionName === 'string') {
      // Dedup by (review-key + section-name) so two proposals routed
      // to the same new section count as ONE created section.
      const reviewKey = p.action === 'existing-review' && typeof p.reviewId === 'string'
        ? `existing::${p.reviewId}`
        : `new::${(typeof p.suggestedNewReviewTitle === 'string' ? p.suggestedNewReviewTitle : '').trim().toLowerCase()}`;
      const name = p.suggestedNewSectionName.trim().toLowerCase();
      if (name) newSectionKeys.add(`${reviewKey}::${name}`);
    }

    if (p.action === 'new-review' && typeof p.suggestedNewReviewTitle === 'string') {
      const t = p.suggestedNewReviewTitle.trim().toLowerCase();
      if (t) newReviewTitles.add(t);
    }
  }

  return {
    newSubjects,
    updatedSubjects,
    newSections: newSectionKeys.size,
    newReviews: newReviewTitles.size,
  };
}

/** Render a compact summary chip line, hiding 0-count buckets so the
 *  card stays readable when most proposals are simple. */
export function formatStatsLine(s: InboxProposalStats): string {
  const parts: string[] = [];
  if (s.newSubjects > 0)     parts.push(`${s.newSubjects} sujet${s.newSubjects > 1 ? 's' : ''} créé${s.newSubjects > 1 ? 's' : ''}`);
  if (s.updatedSubjects > 0) parts.push(`${s.updatedSubjects} mise${s.updatedSubjects > 1 ? 's' : ''} à jour`);
  if (s.newSections > 0)     parts.push(`${s.newSections} nouvelle${s.newSections > 1 ? 's' : ''} section${s.newSections > 1 ? 's' : ''}`);
  if (s.newReviews > 0)      parts.push(`${s.newReviews} nouvelle${s.newReviews > 1 ? 's' : ''} review${s.newReviews > 1 ? 's' : ''}`);
  return parts.join(' · ');
}
