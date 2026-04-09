import { useEffect, useRef, useState } from 'react';
import type { ViewMode } from '../../types';
import styles from './ViewControls.module.css';

interface ViewControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  year: number;
  onYearChange: (direction: -1 | 1) => void;
  onToday: () => void;
}

const VIEW_LABELS: Record<ViewMode, string> = {
  month: 'Mois',
  quarter: 'Trimestre',
  year: 'Année',
};

const VIEW_OPTIONS: ViewMode[] = ['month', 'quarter', 'year'];

export function ViewControls({
  viewMode,
  onViewModeChange,
  year,
  onYearChange,
  onToday,
}: ViewControlsProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className={styles.controls}>
      {/* View mode filter (Mois / Trimestre / Année) */}
      <div className={styles.viewFilter} ref={dropdownRef}>
        <button
          type="button"
          className={styles.viewBtn}
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span className={styles.viewLabel}>{VIEW_LABELS[viewMode]}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {open && (
          <ul className={styles.viewMenu} role="listbox">
            {VIEW_OPTIONS.map((mode) => (
              <li key={mode}>
                <button
                  type="button"
                  className={`${styles.viewMenuItem}${viewMode === mode ? ` ${styles.viewMenuItemActive}` : ''}`}
                  onClick={() => {
                    onViewModeChange(mode);
                    setOpen(false);
                  }}
                  role="option"
                  aria-selected={viewMode === mode}
                >
                  {VIEW_LABELS[mode]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Year navigation: Aujourd'hui + < year > */}
      <div className={styles.yearNav}>
        <button type="button" className={styles.todayBtn} onClick={onToday}>
          Aujourd&apos;hui
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button type="button" className={styles.navBtn} onClick={() => onYearChange(-1)} aria-label="Année précédente">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className={styles.yearLabel}>{year}</span>
        <button type="button" className={styles.navBtn} onClick={() => onYearChange(1)} aria-label="Année suivante">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
