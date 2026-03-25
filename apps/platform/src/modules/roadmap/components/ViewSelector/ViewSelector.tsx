import type { ViewMode } from '../../types';
import styles from './ViewSelector.module.css';

interface ViewSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function ViewSelector({ viewMode, onViewModeChange }: ViewSelectorProps) {
  return (
    <div className={styles.controls}>
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
