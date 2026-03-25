import type { ViewMode } from '../../types';
import styles from './ViewControls.module.css';

interface ViewControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  year: number;
  onYearChange: (direction: -1 | 1) => void;
}

export function ViewControls({
  viewMode,
  onViewModeChange,
  year,
  onYearChange,
}: ViewControlsProps) {
  return (
    <div className={styles.controls}>
      <div className={styles.yearNav}>
        <button className={styles.navBtn} onClick={() => onYearChange(-1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className={styles.yearLabel}>{year}</span>
        <button className={styles.navBtn} onClick={() => onYearChange(1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className={styles.selector}>
        <button
          className={`${styles.button} ${viewMode === 'month' ? styles.active : ''}`}
          onClick={() => onViewModeChange('month')}
        >
          Mois
        </button>
        <button
          className={`${styles.button} ${viewMode === 'quarter' ? styles.active : ''}`}
          onClick={() => onViewModeChange('quarter')}
        >
          Trim.
        </button>
        <button
          className={`${styles.button} ${viewMode === 'year' ? styles.active : ''}`}
          onClick={() => onViewModeChange('year')}
        >
          Annee
        </button>
      </div>
    </div>
  );
}
