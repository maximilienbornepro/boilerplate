import styles from './AiReviewWizard.module.css';

export interface ReviewStatsLineProps {
  /** Items already accepted / applied (Ex: "2 importés", "3 adaptées").
   *  Omit the field entirely (or pass `undefined`) to hide it. Shown
   *  in green-ish accent with a ✓ mark. */
  done?: number;
  /** Custom label for the `done` counter — receives the count so you
   *  can pluralise correctly. Default: `n => "${n} importé(s)"`. */
  doneLabel?: (count: number) => string;
  /** Items the user chose to skip / discard (Ex: "1 ignoré", "2
   *  rejetées"). Omit to hide. Shown muted with a lighter pill. */
  skipped?: number;
  skippedLabel?: (count: number) => string;
  /** Items still pending decision. Always shown — even at 0 because
   *  the "remaining" readout is the anchor the user checks most.
   *  Use the rightmost position so the number is visually anchored. */
  left: number;
  leftLabel?: (count: number) => string;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Unified "progress stats" line — the mini dashboard that sits next
 *  to "Sujet {n} sur {total}" in review wizards. Renders:
 *
 *    ✓ 2 importés   — 1 ignoré   — 23 restants
 *
 *  Only the `left` counter is mandatory. Pass `done` / `skipped` to
 *  show them (0 hides the optional ones, any positive int shows them).
 *  Labels are override-able per module so CV can show "3 adaptées —
 *  1 gardée originale — 5 à revoir" with the same visual treatment.
 *
 *  @example
 *  <TileProgress
 *    items={...}
 *    currentId={...}
 *    extraStats={<ReviewStatsLine done={doneCount} skipped={skippedCount} left={displayRows.length} />}
 *  /> */
export function ReviewStatsLine({
  done,
  doneLabel = (n) => plural(n, 'importé'),
  skipped,
  skippedLabel = (n) => plural(n, 'ignoré'),
  left,
  leftLabel = (n) => plural(n, 'restant'),
}: ReviewStatsLineProps) {
  return (
    <>
      {done !== undefined && done > 0 && (
        <span className={styles.reviewStatDone}>
          ✓ {doneLabel(done)}
        </span>
      )}
      {skipped !== undefined && skipped > 0 && (
        <span className={styles.reviewStatSkipped}>
          — {skippedLabel(skipped)}
        </span>
      )}
      <span className={styles.reviewStatLeft}>
        {(done !== undefined && done > 0) || (skipped !== undefined && skipped > 0) ? '— ' : ''}
        {leftLabel(left)}
      </span>
    </>
  );
}
