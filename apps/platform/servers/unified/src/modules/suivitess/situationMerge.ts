/**
 * Smart-merge helpers for `subject.situation` updates triggered by
 * the suivitess import pipeline (T3 append). Centralised here so the
 * commit path (`/transcription/apply-routing`) and any future caller
 * apply the SAME rules :
 *
 *  1. Strip a leading "— " (or "- ", "– ") on any "Mise à jour …"
 *     header line — both in the existing situation (legacy data
 *     hygiene) and in the incoming appendText (safety net against
 *     the LLM copying that style from the existing content).
 *
 *  2. If the existing situation already carries a date header for
 *     `today`, the incoming appendText's own header is dropped and
 *     its facts are appended UNDER the existing block. Net effect :
 *     N successive imports on the same day produce ONE header and
 *     N batches of facts, instead of N duplicate headers stacking
 *     up next to each other.
 *
 *  3. Otherwise, the appendText is appended after a blank line.
 *
 * The `today` argument is passed in (not computed here) so callers
 * use the same `DD/MM/YYYY` format as the skill prompt
 * (`suivitess-append-situation` → `today` field).
 */

/** Detects header lines that match either prompt phrasing :
 *
 *  - `Mise à jour automatique en date du DD/MM/YYYY :`  (current)
 *  - `Mise à jour du DD/MM[/YYYY] :`                    (legacy)
 *
 * Trailing colon is optional ; trailing whitespace is tolerated.
 * Used in `m` mode against a single line of the situation. */
const ANY_DATE_HEADER_RE = /^Mise à jour (?:automatique en date du|du)\s+[\d/]+\s*:?\s*$/;

/** Same shape as ANY_DATE_HEADER_RE but parameterised on a specific
 *  date — built per-call because `today` is a runtime value. */
function todayHeaderRe(today: string): RegExp {
  // Escape forward slashes for the regex literal embedding.
  const escaped = today.replace(/\//g, '\\/');
  return new RegExp(
    `^Mise à jour (?:automatique en date du|du)\\s+${escaped}(?:\\s*:)?\\s*$`,
    'm',
  );
}

/** Strip a leading dash (em-dash, en-dash, or hyphen) before "Mise à
 *  jour" headers in `s`. Multiline aware — hits every header in the
 *  text. Any other line content is left untouched. */
function stripLeadingDashOnHeaders(s: string): string {
  return s.replace(/^[ \t]*[—–-][ \t]+(Mise à jour)/gm, '$1');
}

/**
 * Merge an `appendText` from T3 into the live `currentSituation`,
 * preserving the same-day-single-header invariant.
 *
 * @param currentSituation - what the DB currently holds for the subject
 * @param appendText       - the T3 skill output (header + facts, or just facts)
 * @param today            - DD/MM/YYYY format used by the prompt's `today` field
 * @returns the new situation to persist
 */
export function mergeSituationAppend(
  currentSituation: string,
  appendText: string,
  today: string,
): string {
  const cleanCurrent = stripLeadingDashOnHeaders(currentSituation);
  const cleanAppend = stripLeadingDashOnHeaders(appendText);

  if (!cleanAppend.trim()) return cleanCurrent;

  if (todayHeaderRe(today).test(cleanCurrent)) {
    // A header already exists for today. Drop ANY header line from
    // the incoming append (today's or a stale snapshot's) and take
    // only the facts that follow.
    const lines = cleanAppend.split('\n');
    const headerIdx = lines.findIndex(l => ANY_DATE_HEADER_RE.test(l));
    const factsOnly = headerIdx >= 0
      ? lines.slice(headerIdx + 1).join('\n').replace(/^\n+/, '')
      : cleanAppend;
    if (!factsOnly.trim()) return cleanCurrent;
    return cleanCurrent.replace(/\s+$/, '') + '\n' + factsOnly;
  }

  if (!cleanCurrent.trim()) return cleanAppend;
  return cleanCurrent.replace(/\s+$/, '') + '\n\n' + cleanAppend;
}

/** Thin wrapper for the apply-routing path. Centralises the date
 *  format so callers don't redefine it inline. */
export function todayFrFr(): string {
  return new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
