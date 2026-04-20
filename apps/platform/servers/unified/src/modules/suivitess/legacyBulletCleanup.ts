// ═══════════════════════════════════════════════════════════════════════
// Pure transformation utility to clean up legacy bullet characters from
// existing suivitess_subjects.situation values.
//
// Context : before this cleanup, the AI writer skills (compose-situation,
// append-situation) prefixed list items with literal `•` characters.
// The SuiviTess editor (SubjectReview.parseLine in
// apps/platform/src/modules/suivitess/components/SubjectReview/) renders
// a bullet automatically based on each line's leading-whitespace depth
// (2 spaces = 1 level ; bullet glyph picked from `['•', '◦', '▪', '▸']`).
// When both happen, the user sees a double bullet (`• •`).
//
// Pure function, no side effects, no I/O — safe to unit-test in isolation.
// ═══════════════════════════════════════════════════════════════════════

const BULLET_CHARS = new Set(['•', '◦', '▪', '▸']);

/**
 * Clean a single line : strip the leading bullet glyph (if any) while
 * preserving the indentation. Tabs in leading whitespace are normalized
 * to 2 spaces (the editor counts raw chars and divides by 2, so tabs
 * render with no indent — broken).
 */
function cleanLine(line: string): string {
  // Split into (leading-ws) + rest
  const m = line.match(/^(\s*)(.*)$/);
  if (!m) return line;
  let leading = m[1];
  let rest = m[2];

  // Normalize tabs → 2 spaces. Tabs in the legacy format were our fault :
  // old prompts instructed `\t` per level, but the editor counts chars and
  // divides by 2 — a tab rendered as level 0 (no indent). Converting to 2
  // spaces per tab preserves the intended depth.
  leading = leading.replace(/\t/g, '  ');

  // Strip one leading unicode bullet glyph + its following space(s). We do
  // NOT strip `-` or `*` because those could be sentence-leading dashes or
  // emphasis markers — only the glyphs we know come from the AI writers.
  if (rest.length > 0 && BULLET_CHARS.has(rest[0])) {
    rest = rest.slice(1);
    // Consume the single space that typically follows the bullet.
    if (rest.startsWith(' ')) rest = rest.slice(1);
  }

  return leading + rest;
}

/**
 * Clean a full `situation` text : apply `cleanLine` to each line.
 * Idempotent — running it twice yields the same result as running it
 * once, so the cleanup script can be re-run safely.
 */
export function cleanSituation(situation: string | null | undefined): string {
  if (!situation) return '';
  return situation.split('\n').map(cleanLine).join('\n');
}

/** True when `cleanSituation(s) !== s` — i.e. at least one line had a
 *  leading bullet glyph or a tab. Used to skip already-clean rows in the
 *  cleanup endpoint so the preview only shows what's actually changing. */
export function situationNeedsCleaning(situation: string | null | undefined): boolean {
  if (!situation) return false;
  return cleanSituation(situation) !== situation;
}
