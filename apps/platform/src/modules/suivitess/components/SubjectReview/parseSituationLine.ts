// Pure parser for one line of a subject's `situation` field — kept
// in its own module so it can be unit-tested in a node environment
// without pulling in the React component, its CSS module, or any
// of its dependencies.
//
// Parsed parts :
//   - `level`        : indentation depth (2 spaces per level, capped
//                      at 3 so the renderer always has a bullet)
//   - `text`         : the line content, stripped of `[!]` and `~~`
//   - `strikethrough`: true when the original line was wrapped in
//                      `~~…~~`
//   - `editedByAi`   : true when the original line carried the `[!]`
//                      marker (emitted by the suivitess T3 import skill
//                      — see `suivitess-append-situation`). The marker
//                      now lives at END of line (the synthesize prompt
//                      moved it there so a leading `[!]` doesn't shift
//                      the visual indentation). We still accept a
//                      leading `[!]` defensively for legacy rows.
//
// Order of parsing matters :
//   1. capture leading whitespace → `level`
//   2. strip optional leading `[!]` (legacy / defensive)
//   3. strip optional trailing `[!]` (new canonical position)
//   4. unwrap surrounding `~~…~~`
//
// On a closure line the storage shape is either `~~text~~ [!]`
// (current, marker at end) or the legacy `[!]~~text~~` (no space,
// marker at start) — both are accepted.

const BULLETS_COUNT = 4;

export interface ParsedSituationLine {
  level: number;
  text: string;
  strikethrough: boolean;
  editedByAi: boolean;
}

export function parseSituationLine(line: string): ParsedSituationLine {
  const match = line.match(/^(\s*)(.*)/);
  if (!match) return { level: 0, text: line, strikethrough: false, editedByAi: false };

  const spaces = match[1].length;
  const level = Math.min(Math.floor(spaces / 2), BULLETS_COUNT - 1);
  let text = match[2];
  let editedByAi = false;
  let strikethrough = false;

  // Step 2 — legacy leading marker (kept for back-compat with very old
  // rows that escaped the May 2026 backfill).
  if (text.startsWith('[!]')) {
    editedByAi = true;
    text = text.slice(3);
    if (text.startsWith(' ')) text = text.slice(1);
  }
  // Step 3 — current canonical marker position : end of line. A space
  // between the content and `[!]` is optional (the synth prompt emits
  // ` [!]` with one space ; the regex backfill produced the same shape).
  if (text.endsWith(' [!]')) {
    editedByAi = true;
    text = text.slice(0, -4);
  } else if (text.endsWith('[!]')) {
    editedByAi = true;
    text = text.slice(0, -3);
  }
  if (text.startsWith('~~') && text.endsWith('~~') && text.length > 4) {
    strikethrough = true;
    text = text.slice(2, -2);
  }

  return { level, text, strikethrough, editedByAi };
}
