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
//   - `editedByAi`   : true when the original line started with the
//                      `[!]` marker (emitted by the suivitess T3
//                      import skill — see `suivitess-append-situation`)
//
// Order of parsing matters :
//   1. capture leading whitespace → `level`
//   2. strip optional `[!]` prefix (with or without trailing space)
//   3. unwrap surrounding `~~…~~`
//
// On a closure line the storage shape is `[!]~~text~~` (no space
// between `[!]` and `~~`) — the optional space after `[!]` is only
// for the additive case `[!] text`.

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

  if (text.startsWith('[!]')) {
    editedByAi = true;
    text = text.slice(3);
    if (text.startsWith(' ')) text = text.slice(1);
  }
  if (text.startsWith('~~') && text.endsWith('~~') && text.length > 4) {
    strikethrough = true;
    text = text.slice(2, -2);
  }

  return { level, text, strikethrough, editedByAi };
}
