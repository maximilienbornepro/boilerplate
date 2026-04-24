import { useState, useMemo } from 'react';
import styles from './AiReviewWizard.module.css';
import { DecisionCard } from './DecisionCard';
import type { ReviewableDecision, WizardConfig, WizardLabels } from './types';

const DEFAULT_LABELS: WizardLabels = {
  tileCountLead: 'Sujet',
  tileRemaining: (remaining) => `${remaining} restants`,
  prev: 'Sujet précédent',
  next: 'Sujet suivant',
  skip: 'Ignorer',
  disagree: 'Je ne suis pas d\'accord',
  commit: 'Valider et passer au suivant',
  reasoningLead: 'Raison IA :',
  emptyState: 'Aucun élément à passer en revue.',
};

/** Single-tile review wizard for AI-generated decisions. Presents one
 *  {@link ReviewableDecision} at a time with a dot navigator, and
 *  auto-advances on skip / commit. Consumers bring decisions + the
 *  three handlers; the wizard owns pagination, progress display, and
 *  the commit spinner.
 *
 *  @see ReviewableDecision, WizardConfig
 *
 *  @example
 *  <AiReviewWizard
 *    decisions={proposals}
 *    onSkip={d => removeProposalLocally(d.id)}
 *    onDisagree={d => flagLog(d.logId, d.id)}
 *    onCommit={async d => api.commitDecision(d.payload)}
 *    onDone={closeModal}
 *  />
 */
export function AiReviewWizard<TPayload>({
  decisions,
  onSkip,
  onDisagree,
  onCommit,
  onDone,
  labels: labelOverrides,
}: WizardConfig<TPayload>) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const labels = useMemo<WizardLabels>(
    () => ({ ...DEFAULT_LABELS, ...labelOverrides }),
    [labelOverrides],
  );

  // Guard rails: the internal index can drift past the array length
  // when the consumer shrinks `decisions` on skip/commit. Clamp on
  // each render so we don't dereference a stale slot.
  const clampedIndex = Math.min(currentIndex, Math.max(decisions.length - 1, 0));
  const current = decisions[clampedIndex];
  const remaining = Math.max(0, decisions.length - clampedIndex);

  const advance = () => {
    if (clampedIndex >= decisions.length - 1) {
      onDone?.();
    } else {
      setCurrentIndex(clampedIndex + 1);
    }
  };

  const handleSkip = (decision: ReviewableDecision<TPayload>) => {
    onSkip(decision);
    advance();
  };
  const handleDisagree = (decision: ReviewableDecision<TPayload>) => {
    // Disagree does NOT auto-advance — consumers typically open an
    // inline editor or wizard to let the user fix the proposal, then
    // call `commit` themselves. The wizard stays on the current tile.
    onDisagree(decision);
  };
  const handleCommit = async (decision: ReviewableDecision<TPayload>) => {
    await onCommit(decision);
    advance();
  };

  if (decisions.length === 0) {
    return (
      <div className={styles.wizardRoot}>
        <p className={styles.emptyState}>{labels.emptyState}</p>
      </div>
    );
  }

  return (
    <div className={styles.wizardRoot}>
      <div className={styles.tileProgress}>
        <div className={styles.tileProgressHeader}>
          <strong className={styles.tileProgressPos}>
            {labels.tileCountLead} {clampedIndex + 1} sur {decisions.length}
          </strong>
          <span className={styles.tileProgressStats}>
            <span className={styles.tileProgressLeft}>{labels.tileRemaining(remaining)}</span>
          </span>
        </div>

        <div className={styles.tileDotsRow} role="tablist">
          <button
            type="button"
            className={styles.tileNavArrow}
            disabled={clampedIndex === 0}
            onClick={() => setCurrentIndex(Math.max(0, clampedIndex - 1))}
            title={labels.prev}
            aria-label={labels.prev}
          >
            ←
          </button>
          <div className={styles.tileDots}>
            {decisions.map((d, i) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={i === clampedIndex}
                className={`${styles.tileDot} ${i === clampedIndex ? styles.tileDotCurrent : ''}`}
                onClick={() => setCurrentIndex(i)}
                title={`${i + 1}. ${d.title}`}
              />
            ))}
          </div>
          <button
            type="button"
            className={styles.tileNavArrow}
            disabled={clampedIndex === decisions.length - 1}
            onClick={() => setCurrentIndex(Math.min(decisions.length - 1, clampedIndex + 1))}
            title={labels.next}
            aria-label={labels.next}
          >
            →
          </button>
        </div>
      </div>

      <DecisionCard
        decision={current}
        labels={labels}
        onSkip={() => handleSkip(current)}
        onDisagree={() => handleDisagree(current)}
        onCommit={() => handleCommit(current)}
      />
    </div>
  );
}
