// Pure helpers turning `suivitess_subject_marks` rows into a
// timeline aligned to a Fathom/Otter call window.
//
// Strictly additive : when no marks fall inside the call window,
// `buildMarksTimeline()` returns an empty array and the T1
// pipeline injects no ground-truth section, behaving exactly like
// before the marks feature shipped.

export interface RawMarkInput {
  /** Server-stamped click timestamp (ISO 8601 UTC). */
  clickedAt: string;
  /** null = the user clicked "stop marking" (off-topic from now). */
  subjectId: string | null;
  /** Denormalised for the prompt + verification UI. May be null when
   *  the subject has been deleted since the click. */
  subjectTitle: string | null;
}

export interface TimelineSegment {
  /** Seconds offset from the call's recordedAt — inclusive lower bound. */
  fromSeconds: number;
  /** Seconds offset from the call's recordedAt — exclusive upper bound. */
  toSeconds: number;
  subjectId: string;
  subjectTitle: string | null;
}

/** Fathom / Otter call metadata we need to align marks. */
export interface CallWindow {
  recordedAt: Date;
  durationSeconds: number;
}

/**
 * Convert marks to a list of `{from, to, subjectId, subjectTitle}`
 * segments. Marks outside the call window are dropped silently.
 *
 * Rules :
 *   - Marks are sorted by clickedAt ascending.
 *   - A mark with `subjectId` opens a segment.
 *   - The segment closes on the NEXT mark (any kind) or at the end
 *     of the call window if no further mark exists.
 *   - A mark with `subjectId = null` is a "stop" : it closes the
 *     previous segment without opening a new one.
 *   - Marks before recordedAt or after recordedAt+duration are
 *     filtered out (clearly clicked outside the call).
 *   - Pre-first-mark and post-stop portions are NOT emitted as
 *     segments — the T1 pipeline will run its standard free
 *     extraction on those parts.
 *
 * Pure : same input → same output, zero side-effect.
 */
export function buildMarksTimeline(
  marks: RawMarkInput[],
  call: CallWindow,
): TimelineSegment[] {
  const start = call.recordedAt.getTime();
  const end = start + call.durationSeconds * 1000;

  // Filter to in-window + sort ASC. We compute offsets in seconds
  // (rounded to integer) since the prompt renders MM:SS — sub-second
  // precision is cosmetic noise.
  const inWindow = marks
    .map(m => ({ ...m, ts: new Date(m.clickedAt).getTime() }))
    .filter(m => !isNaN(m.ts) && m.ts >= start && m.ts <= end)
    .sort((a, b) => a.ts - b.ts)
    .map(m => ({
      offsetSec: Math.max(0, Math.round((m.ts - start) / 1000)),
      subjectId: m.subjectId,
      subjectTitle: m.subjectTitle,
    }));

  const segments: TimelineSegment[] = [];
  for (let i = 0; i < inWindow.length; i++) {
    const cur = inWindow[i];
    if (cur.subjectId == null) continue; // "stop" mark, no segment opens
    // Close at the next mark of any kind (subject or stop), or at
    // the end of the call window.
    const next = inWindow[i + 1];
    const toSec = next
      ? next.offsetSec
      : Math.round(call.durationSeconds);
    if (toSec <= cur.offsetSec) continue; // zero-length, skip
    segments.push({
      fromSeconds: cur.offsetSec,
      toSeconds: toSec,
      subjectId: cur.subjectId,
      subjectTitle: cur.subjectTitle,
    });
  }
  return segments;
}

/** Format seconds as `MM:SS` (or `HH:MM:SS` when ≥ 1 hour). Pure. */
export function fmtOffset(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/**
 * Render the timeline as a markdown block ready to drop into the T1
 * extraction prompt. Empty input → empty string : the caller
 * concatenates unconditionally and the prompt simply omits the
 * section when no marks apply (additive behaviour).
 */
export function renderMarksGroundTruth(segments: TimelineSegment[]): string {
  if (segments.length === 0) return '';
  const lines = segments
    .map(seg => {
      const range = `${fmtOffset(seg.fromSeconds)} → ${fmtOffset(seg.toSeconds)}`;
      const title = seg.subjectTitle?.trim() || '(titre indisponible)';
      return `- ${range} : sujet « ${title} » (id: ${seg.subjectId})`;
    })
    .join('\n');
  return `\n\n## Marqueurs utilisateur (ground truth, optionnels)\n\nL'utilisateur a indiqué pendant l'enregistrement quels passages\nappartiennent à des sujets précis du document. Ces marqueurs sont\n**fiables et doivent guider l'extraction** :\n\n${lines}\n\nRÈGLES additives :\n- Pour chaque sujet que tu extrais d'un passage couvert par un\n  marqueur, mets \`mappedToExistingSubjectId\` égal à l'id indiqué.\n- Tu PEUX créer plusieurs sujets fils (règles de gestion, cas\n  d'usage) à l'intérieur d'une plage marquée — ils sont tous\n  rattachés au même \`mappedToExistingSubjectId\`.\n- Les portions de transcription HORS de toute plage marquée se\n  traitent normalement (extraction libre selon les règles\n  habituelles), comme si la section ground-truth n'existait pas.\n- Si un passage marqué ne discute manifestement PAS du sujet\n  indiqué (utilisateur a cliqué par erreur), priorise ce qui est\n  réellement dit, ignore le marqueur pour ce passage précis.`;
}
