// Wraps a subject card. When the user has an active mark on a DIFFERENT
// subject, this component :
//   - renders a translucent overlay over the wrapped content that
//     blocks pointer events (so the user can't edit this subject
//     without first deciding what to do with the active mark)
//   - shows a small banner "Le micro est sur 'X'. Cliquer pour activer ici"
//   - pops a ConfirmModal automatically the FIRST time this card
//     scrolls into view (≥ 50 % visible) so the user is alerted as
//     soon as they navigate down to a subject they're not currently
//     marking.
//
// If the user confirms the modal → setMark(thisSubject), overlay
// vanishes, edits unblock.
// If the user cancels → overlay stays (clicking it reopens the modal).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmModal } from '@boilerplate/shared/components';
import type { ActiveMarkController } from './useActiveSubjectMark';
import styles from './MarkSwitchGuard.module.css';

interface Props {
  controller: ActiveMarkController;
  subjectId: string;
  subjectTitle: string;
  children: ReactNode;
}

export function MarkSwitchGuard({ controller, subjectId, subjectTitle, children }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // True after the modal has been shown for THIS (subject, current
  // mark) tuple — prevents re-popping every time the card scrolls in
  // and out of view. Reset whenever the active mark moves elsewhere.
  const alertedRef = useRef(false);

  const otherActive =
    controller.isCurrentlyMarking
    && controller.active != null
    && controller.active.subjectId !== subjectId;

  // Reset alert state when the active mark moves OFF (or onto this
  // subject) — next time another subject becomes marked, this card
  // re-alerts on scroll.
  useEffect(() => {
    if (!otherActive) {
      alertedRef.current = false;
      setModalOpen(false);
    }
  }, [otherActive]);

  // Auto-pop the modal the first time this card is mostly visible
  // while another subject is being marked.
  useEffect(() => {
    if (!otherActive) return;
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            if (!alertedRef.current) {
              alertedRef.current = true;
              setModalOpen(true);
            }
          }
        }
      },
      { threshold: [0.5] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [otherActive, subjectId]);

  const handleConfirm = async () => {
    setModalOpen(false);
    try { await controller.setMark(subjectId); }
    catch { /* hook already swallows — no toast wanted here */ }
  };

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      {children}
      {otherActive && (
        <button
          type="button"
          className={styles.blocker}
          onClick={() => setModalOpen(true)}
          aria-label={`Le micro est sur « ${controller.active?.subjectTitle ?? '?'} ». Cliquer pour basculer ici.`}
        >
          <span className={styles.blockerCard}>
            <span className={styles.blockerHead}>
              <span className={styles.dot} aria-hidden /> Micro actif sur un autre sujet
            </span>
            <span className={styles.blockerBody}>
              « {controller.active?.subjectTitle ?? '?'} »
            </span>
            <span className={styles.blockerCta}>Cliquer pour activer le micro ici</span>
          </span>
        </button>
      )}
      {modalOpen && (
        <ConfirmModal
          title="Tu es passé à un autre sujet"
          message={
            `Le micro est actuellement sur « ${controller.active?.subjectTitle ?? '?'} ». `
            + `Pour éditer « ${subjectTitle} », active le micro sur ce sujet d'abord.`
          }
          confirmLabel="Activer le micro ici"
          cancelLabel="Plus tard"
          onConfirm={handleConfirm}
          onCancel={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
