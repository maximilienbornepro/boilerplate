// Sticky banner displayed at the top of a suivitess document while
// the user is "actively marking" a subject (i.e. the latest click
// targets a subject, not a stop). Surfaces the elapsed time since
// the click and a one-click "Arrêter" button.
//
// Strictly ornamental : never blocks the document, never appears
// when the marks layer is unused.

import { useEffect, useState } from 'react';
import type { ActiveMarkController } from './useActiveSubjectMark';
import styles from './MarkBanner.module.css';

interface Props {
  controller: ActiveMarkController;
}

function fmtElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function MarkBanner({ controller }: Props) {
  const { active, isCurrentlyMarking, setMark } = controller;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isCurrentlyMarking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isCurrentlyMarking]);

  if (!isCurrentlyMarking || !active?.clickedAt) return null;

  const elapsedSec = Math.floor((now - new Date(active.clickedAt).getTime()) / 1000);

  return (
    <div className={styles.banner} role="status">
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>
        En train de marquer : <strong>{active.subjectTitle ?? '(titre indisponible)'}</strong>
      </span>
      <span className={styles.elapsed}>depuis {fmtElapsed(elapsedSec)}</span>
      <button
        type="button"
        className={styles.stopBtn}
        onClick={() => void setMark(null)}
        title="Arrêter le marquage"
      >
        Arrêter
      </button>
    </div>
  );
}
