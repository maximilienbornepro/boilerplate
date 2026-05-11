/**
 * Smart-merge helper for `subject.situation` updates triggered by
 * the suivitess import pipeline (T3 append). Centralised here so
 * every caller (apply-routing route, scheduler, cli cleanup) follows
 * the SAME rules :
 *
 *  1. The legacy `Mise à jour automatique en date du …` header is
 *     never emitted by the new T3 prompt. If for any reason such a
 *     line slips through `appendText`, we silently drop it (defense
 *     in depth).
 *
 *  2. `appendText` is parsed line-by-line :
 *     - Lines NOT wrapped in `~~…~~` are NET-NEW facts. They are
 *       appended at the end of `currentSituation` if (and only if)
 *       the same text (ignoring `[!]`, leading whitespace, and
 *       `~~…~~` wrappers) doesn't already appear in
 *       `currentSituation`. No duplicates.
 *     - Lines wrapped in `~~…~~` are CLOSURES. The merger finds
 *       the matching live line in `currentSituation` (same
 *       indentation level, same text content modulo `[!]` and `~~`)
 *       and REPLACES it with the new strikethrough version. If no
 *       match is found, the line is appended at the end.
 *
 *  3. Existing legacy `Mise à jour automatique en date du …` lines
 *     in `currentSituation` are LEFT in place — we don't rewrite
 *     history. They are simply ignored by the dedup/match logic.
 *
 * The `_today` argument is kept on the signature for backward
 * compatibility with all the existing callers (route, scheduler,
 * apply service) — they still pass it but it is a no-op now.
 */

/** Detects header lines that match either prompt phrasing :
 *
 *  - `Mise à jour automatique en date du DD/MM/YYYY :`  (current)
 *  - `Mise à jour du DD/MM[/YYYY] :`                    (legacy)
 *
 * Trailing colon is optional ; trailing whitespace is tolerated. */
const ANY_DATE_HEADER_RE = /^[ \t]*[—–-]?[ \t]*Mise à jour (?:automatique en date du|du)\s+[\d/]+\s*:?\s*$/;

/**
 * Strip the `[!]` marker, surrounding `~~…~~` wrappers, and any
 * leading whitespace, returning the comparable text content of a
 * line. Used by the dedup and the strikethrough-match logic.
 */
function lineKey(line: string): string {
  let s = line.replace(/^\s+/, '');
  // Drop a leading `[!]` (with or without trailing space).
  s = s.replace(/^\[!\]\s*/, '');
  // Unwrap surrounding `~~…~~` if present (line-level strikethrough).
  if (s.startsWith('~~') && s.endsWith('~~') && s.length > 4) {
    s = s.slice(2, -2);
  }
  return s.trim();
}

/**
 * Count leading spaces of a line — used to compare indentation
 * levels when matching a strikethrough closure to an existing
 * live line.
 */
function indentOf(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/** True if `line` is a strikethrough closure produced by the T3
 *  prompt (the `[!]` marker is optional in the regex — the merger
 *  must tolerate both forms even though the prompt always emits it). */
function isStrikethroughLine(line: string): boolean {
  const s = line.replace(/^\s+/, '').replace(/^\[!\]\s*/, '');
  return /^~~.+~~\s*$/.test(s);
}

/**
 * Merge an `appendText` from T3 into the live `currentSituation`.
 *
 * @param currentSituation - what the DB currently holds for the subject
 * @param appendText       - the T3 skill output (a list of lines, each
 *                           optionally prefixed by `[!]` and optionally
 *                           wrapped in `~~…~~`)
 * @param _today           - kept for backward compat (unused — see file
 *                           header)
 * @returns the new situation to persist
 */
export function mergeSituationAppend(
  currentSituation: string,
  appendText: string,
  _today?: string,
): string {
  if (!appendText || !appendText.trim()) return currentSituation;

  const currentLines = currentSituation.split('\n');
  const appendLines = appendText.split('\n');

  for (const raw of appendLines) {
    // Defense in depth — silently drop any legacy date header the
    // model might accidentally emit despite the new prompt rules.
    if (ANY_DATE_HEADER_RE.test(raw)) continue;

    // Blank line in appendText is meaningless for a merge — skip.
    if (!raw.trim()) continue;

    if (isStrikethroughLine(raw)) {
      // CLOSURE — find the matching live line in currentLines and
      // replace it. Match on (same indentation level, same text
      // content modulo `[!]` and `~~`). The text inside `~~…~~` of
      // the incoming line is the ORIGINAL line content the model is
      // closing.
      const target = lineKey(raw);
      const incomingIndent = indentOf(raw);
      const matchIdx = currentLines.findIndex(l => {
        return lineKey(l) === target
          && indentOf(l) === incomingIndent
          && !ANY_DATE_HEADER_RE.test(l);
      });
      if (matchIdx >= 0) {
        currentLines[matchIdx] = raw;
      } else {
        currentLines.push(raw);
      }
      continue;
    }

    // NET-NEW line — append at the end iff no existing line has
    // the same comparable text content. We don't enforce same
    // indentation for dedup — same text at a different level still
    // counts as a duplicate (the model picked one rank, we trust it).
    const key = lineKey(raw);
    const already = currentLines.some(l => lineKey(l) === key && !ANY_DATE_HEADER_RE.test(l));
    if (already) continue;
    currentLines.push(raw);
  }

  return currentLines.join('\n');
}

/** Thin wrapper preserved for legacy callers. Still produces the
 *  DD/MM/YYYY format used by the prompt's `today` field — but the
 *  merger no longer relies on it. */
export function todayFrFr(): string {
  return new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
