import type { ViewMode } from '../../types';
import styles from './ViewSelector.module.css';

interface ViewSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  yearOffset?: number;
  onYearOffsetChange?: (offset: number) => void;
  currentYear?: number;
}

export function ViewSelector({
  viewMode,
  onViewModeChange,
  yearOffset = 0,
  onYearOffsetChange,
  currentYear,
}: ViewSelectorProps) {
  const displayYear = currentYear ?? (new Date().getFullYear() + yearOffset);

  return (
    <div className={styles.controls}>
      {onYearOffsetChange && (
        <div className={styles.yearNav}>
          <button className={styles.navBtn} onClick={() => onYearOffsetChange(yearOffset - 1)} title="Année précédente">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span className={styles.yearLabel}>{displayYear}</span>
          <button className={styles.navBtn} onClick={() => onYearOffsetChange(yearOffset + 1)} title="Année suivante">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      )}

      <select
        className="module-header-btn"
        value={viewMode}
        onChange={(e) => onViewModeChange(e.target.value as ViewMode)}
      >
        <option value="month">Mois</option>
        <option value="quarter">Trimestre</option>
        <option value="year">Année</option>
      </select>
    </div>
  );
}
