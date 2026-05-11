// Reusable filter dropdown that mirrors the Roadmap "Mois" view selector
// (button with chevron + popover menu) but uses a NEUTRAL border instead
// of the module's accent color, so it can sit next to other filters
// without screaming "I'm the active picker".
//
// Co-located here because only InboxPage uses it for now ; promote to
// `packages/shared` if a second module needs the same UI.

import { useEffect, useRef, useState } from 'react';
import styles from './FilterDropdown.module.css';

export interface FilterDropdownOption<T extends string> {
  value: T;
  label: string;
}

interface FilterDropdownProps<T extends string> {
  /** Currently selected value (use empty string for "show all" sentinel). */
  value: T;
  /** Called when the user picks an entry. */
  onChange: (value: T) => void;
  /** All choices, including the "all" sentinel. */
  options: ReadonlyArray<FilterDropdownOption<T>>;
  /** Optional aria-label for the trigger button. */
  ariaLabel?: string;
}

export function FilterDropdown<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];

  return (
    <div className={styles.root} ref={ref}>
      <button
        type="button"
        className={styles.btn}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles.label}>{current?.label ?? ''}</span>
        <svg
          width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <ul className={styles.menu} role="listbox">
          {options.map(o => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`${styles.item} ${o.value === value ? styles.itemActive : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
