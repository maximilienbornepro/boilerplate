import { useState, useRef, useEffect } from 'react';
import styles from './AiReviewWizard.module.css';
import type { EditableSlot } from './types';

/** Inline pill + dropdown used mid-sentence in a StatementLine. Click
 *  the pill → menu opens → click an option → `onChange` fires.
 *
 *  This is a low-level primitive; most callers use it via
 *  {@link DecisionCard} which composes it into statement lines. */
export function InlineSlotDropdown({ slot }: { slot: EditableSlot }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Close on outside click — kept local so the component stays
  // self-contained and doesn't pull the shared `useClickOutside` in
  // unless callers want it.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const pillClass = slot.variant === 'new'
    ? styles.slotPillNew
    : styles.slotPillExisting;

  return (
    <span className={styles.slotContainer} ref={containerRef}>
      <button
        type="button"
        className={styles.slotButton}
        disabled={slot.disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className={styles.slotLabel}>
          <span className={pillClass}>{slot.currentValue}</span>
        </span>
        <svg className={styles.slotChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && slot.options.length > 0 && (
        <div className={styles.slotMenu} role="menu">
          {slot.options.map(opt => (
            <button
              key={opt.id}
              type="button"
              role="menuitem"
              className={opt.kind === 'create' ? styles.slotMenuItemCreate : styles.slotMenuItem}
              onClick={() => { slot.onChange(opt.id); setOpen(false); }}
            >
              <span>{opt.label}</span>
              {opt.badge && <span className={styles.slotMenuBadge}>{opt.badge}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
