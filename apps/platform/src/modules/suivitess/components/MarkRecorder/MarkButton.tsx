// Per-subject 🎙️ button. Three visual states :
//   - idle               : the user is NOT marking ANY subject
//   - active (this one)  : the user is currently marking THIS subject (red, pulsing)
//   - active (another)   : another subject is the one being marked (subtle)
//
// Click semantics :
//   - idle              → records a mark on this subject
//   - active (this one) → records a "stop" (subjectId = null)
//   - active (another)  → switches the active mark to THIS subject

import type { ActiveMarkController } from './useActiveSubjectMark';
import styles from './MarkButton.module.css';

interface Props {
  controller: ActiveMarkController;
  subjectId: string;
  /** When true, the button is still rendered but disabled — used
   *  while a save / patch is in flight on the same subject. */
  disabled?: boolean;
}

export function MarkButton({ controller, subjectId, disabled }: Props) {
  const { active, setMark } = controller;
  const isThisOne = active?.subjectId === subjectId;
  const someoneElse = !isThisOne && active?.subjectId != null;

  const handle = async () => {
    if (disabled) return;
    if (isThisOne) {
      // Already active on this subject → click again means "stop".
      await setMark(null);
    } else {
      // Idle OR another subject is active → switch to this one.
      await setMark(subjectId);
    }
  };

  const stateClass = isThisOne
    ? styles.active
    : someoneElse
      ? styles.dim
      : styles.idle;

  const tooltip = isThisOne
    ? 'On parle de ce sujet — clique pour arrêter'
    : someoneElse
      ? `Basculer le marquage sur ce sujet (actuellement : ${active?.subjectTitle ?? '?'})`
      : 'Marquer : on parle de ce sujet maintenant';

  return (
    <button
      type="button"
      className={`${styles.btn} ${stateClass}`}
      onClick={handle}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={isThisOne}
    >
      <span className={styles.icon} aria-hidden="true">🎙️</span>
      {isThisOne && <span className={styles.dot} aria-hidden="true" />}
    </button>
  );
}
