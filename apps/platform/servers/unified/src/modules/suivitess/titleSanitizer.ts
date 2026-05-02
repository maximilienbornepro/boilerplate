// ═══════════════════════════════════════════════════════════════════════
// Defensive cleanup for AI-proposed titles (subjects + section names +
// review names). The Tier 1/2 prompts already forbid ticket refs / email
// prefixes / "Tracking" labels in titles, but the model occasionally
// regresses — especially when the source material strongly anchors the
// pattern (a thread literally titled "Tracking TVFREE-2062 : …" leaks
// straight through).
//
// This sanitizer is the deterministic safety net : it strips the
// patterns we know we never want, while staying conservative enough to
// never butcher a legitimate title (numbers in "Slider 6 ans" stay,
// "Migration PostgreSQL" stays).
//
// Applied at the pipeline boundaries where AI output becomes a
// user-facing proposal — so the user only ever sees clean titles
// regardless of which skill produced them.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cleans up an AI-proposed title in place. Returns the original input if
 * sanitization would yield an empty string (defensive — better an ugly
 * title than no title at all).
 */
export function sanitizeProposedTitle(raw: string | null | undefined): string {
  if (raw == null) return '';
  let title = String(raw).trim();
  if (!title) return '';

  // 1. Strip stacked email prefixes : "Re: Re: Fwd: foo" → "foo".
  //    Keeps stripping while the pattern matches.
  title = title.replace(/^(?:\s*(?:re|rép|fwd|fw|tr)\s*:\s*)+/i, '');

  // 2. Strip "Tracking" / "Suivi" / "Suivi de" prefix labels (FR + EN),
  //    optionally followed by a separator. These get attached to a
  //    ticket ref in mails ("Tracking TVFREE-2062 : …") and read like
  //    duplicates of the SuiviTess concept once the ticket is gone.
  title = title.replace(/^(?:tracking|suivi(?:\s+de)?|follow[\s-]?up)\s*[:\-—]?\s*/i, '');

  // 3. Strip Jira-style ticket refs (TVFREE-2062, ABC-123, JIRA-1234).
  //    The 2+ uppercase letters hyphen digits pattern is very specific —
  //    it won't match natural language like "v16" or "C2".
  title = title.replace(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g, '');

  // 4. Strip GitHub-style refs (#1234) when they look like an issue ref
  //    (a `#` not preceded by a word char).
  title = title.replace(/(?:^|[^\w])#\d+\b/g, m => m.startsWith('#') ? '' : m[0]);

  // 5. Strip URLs (http://… / https://…) — they have no place in a title.
  title = title.replace(/\bhttps?:\/\/\S+/gi, '');

  // 6. Strip explicit version markers : "v16", "v1.24.1", "version 1.24.1".
  //    Conservative on the bare-letter form : it must be a lowercase `v`
  //    followed immediately by digits (so "TV" / "Samsung" / "2024" stay
  //    untouched). The case-sensitive flag avoids matching "V" of "VRAIE".
  title = title.replace(/\bv\d+(?:\.\d+)*\b/g, '');
  title = title.replace(/\bversion\s+\d+(?:\.\d+){0,3}\b/gi, '');

  // 7. Strip ISO + DD/MM dates : "2026-04-29", "29/04/2026", "29/04".
  title = title.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
  title = title.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '');

  // 8. Re-clean leftover separators around / inside the title, then
  //    collapse whitespace.
  // Drop opening/trailing colons, dashes, em-dashes, parens fragments left over.
  title = title.replace(/^[\s:\-—–·•|]+/, '');
  title = title.replace(/[\s:\-—–·•|]+$/, '');
  // Collapse double-separators left in the middle ("foo —  : bar" → "foo : bar").
  title = title.replace(/\s*([:\-—–·•|])\s*[:\-—–·•|]+\s*/g, ' $1 ');
  // Collapse whitespace.
  title = title.replace(/\s{2,}/g, ' ').trim();

  // 9. If everything was stripped (rare : a title that was 100% noise),
  //    return the raw input rather than an empty string. Better an ugly
  //    title in the UI than a mysterious blank.
  return title || String(raw).trim();
}

/**
 * Convenience for nullable title fields (`suggestedNewSectionName`,
 * `suggestedNewReviewTitle`). Returns `null` if the input is null/empty,
 * otherwise the sanitized title.
 */
export function sanitizeProposedTitleNullable(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  return sanitizeProposedTitle(raw);
}

// Exported for tests.
export const _internals = {
  TICKET_PATTERN: /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g,
  EMAIL_PREFIX_PATTERN: /^(?:\s*(?:re|rép|fwd|fw|tr)\s*:\s*)+/i,
  TRACKING_PREFIX_PATTERN: /^(?:tracking|suivi(?:\s+de)?|follow[\s-]?up)\s*[:\-—]?\s*/i,
};
