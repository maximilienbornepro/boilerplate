import { useState } from 'react';
import styles from './AiReviewWizard.module.css';
import { InlineSlotDropdown } from './InlineSlotDropdown';
import type { ReviewableDecision, WizardLabels } from './types';

export interface DecisionCardProps<TPayload> {
  decision: ReviewableDecision<TPayload>;
  labels: Pick<WizardLabels, 'skip' | 'disagree' | 'commit' | 'reasoningLead'>;
  onSkip: () => void;
  onDisagree: () => void;
  onCommit: () => Promise<void>;
  /** Disables all actions while another tile is committing — prevents
   *  double-submits across a batch. */
  disabled?: boolean;
}

/** Single decision card — header (title + status + mode tag) + the
 *  "statement" sentences with inline dropdown slots + AI reasoning +
 *  action bar (Skip / Disagree / Commit).
 *
 *  Stateless except for the commit spinner. Consumers control every
 *  data flow through {@link ReviewableDecision} + callbacks. */
export function DecisionCard<TPayload>({
  decision,
  labels,
  onSkip,
  onDisagree,
  onCommit,
  disabled = false,
}: DecisionCardProps<TPayload>) {
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    setError(null);
    setCommitting(true);
    try {
      await onCommit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la validation');
    } finally {
      setCommitting(false);
    }
  };

  const modeTagClass = decision.modeTag
    ? decision.modeTag.variant === 'update'
      ? `${styles.modeTag} ${styles.modeTagUpdate}`
      : decision.modeTag.variant === 'create'
        ? `${styles.modeTag} ${styles.modeTagCreate}`
        : styles.modeTag
    : '';

  return (
    <div
      className={styles.decisionCard}
      style={decision.status ? { ['--status-color' as string]: decision.status.color } : undefined}
    >
      <div className={styles.decisionHeader}>
        <span className={styles.decisionTitle}>{decision.title}</span>
        {decision.modeTag && (
          <span className={modeTagClass}>{decision.modeTag.label}</span>
        )}
        {decision.status && (
          <span
            className={styles.statusTag}
            style={{ ['--status-color' as string]: decision.status.color }}
          >
            <span className={styles.statusDot} aria-hidden="true" />
            <span className={styles.statusLabel}>{decision.status.label}</span>
          </span>
        )}
      </div>

      <div className={styles.decisionStatement}>
        {decision.statementLines.map((line, idx) => (
          <div key={idx} className={styles.decisionStatementLine}>
            <span className={styles.decisionStatementText}>{line.text}</span>
            {line.slot && (
              <>
                {' '}
                <InlineSlotDropdown slot={line.slot} />
              </>
            )}
          </div>
        ))}
      </div>

      {decision.reasoning && (
        <p className={styles.decisionReason}>
          <strong className={styles.decisionReasonLead}>{labels.reasoningLead}</strong>
          {' '}
          {decision.reasoning}
        </p>
      )}

      {error && (
        <p className={styles.decisionError} role="alert">
          {error}
        </p>
      )}

      <div className={styles.decisionActions}>
        <button
          type="button"
          className={styles.actionBtn}
          disabled={disabled || committing}
          onClick={onSkip}
        >
          {labels.skip}
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionBtnDisagree}`}
          disabled={disabled || committing}
          onClick={onDisagree}
        >
          {labels.disagree}
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
          disabled={disabled || committing}
          onClick={handleCommit}
        >
          {committing ? '⏳ …' : labels.commit}
        </button>
      </div>
    </div>
  );
}
