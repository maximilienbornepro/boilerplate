import { useEffect } from 'react';
import type { Planning } from '../../types';
import styles from './PlanningList.module.css';

interface PlanningListProps {
  plannings: Planning[];
  activePlanningId: string | null;
  onSelect: (planning: Planning) => void;
  onEdit: (planning: Planning) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function PlanningList({
  plannings,
  activePlanningId,
  onSelect,
  onEdit,
  onDelete,
  onAdd,
}: PlanningListProps) {

  // Auto-open form when there are no plannings
  useEffect(() => {
    if (plannings.length === 0) {
      onAdd();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannings.length]);

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {plannings.map((p) => (
          <div
            key={p.id}
            className={`${styles.card} ${p.id === activePlanningId ? styles.cardActive : ''}`}
            onClick={() => onSelect(p)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(p)}
          >
            <div className={styles.cardIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div className={styles.cardContent}>
              <span className={styles.cardName}>{p.name}</span>
              <span className={styles.cardDates}>{p.startDate} — {p.endDate}</span>
              {p.description && <span className={styles.cardDesc}>{p.description}</span>}
            </div>
            <button
              className={styles.editBtn}
              onClick={(e) => { e.stopPropagation(); onEdit(p); }}
              title="Modifier"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              className={`${styles.editBtn} ${styles.deleteBtn}`}
              onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
              title="Supprimer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
            <div className={styles.cardArrow}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
