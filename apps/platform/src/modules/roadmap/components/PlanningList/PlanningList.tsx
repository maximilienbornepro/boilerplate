import { Card, Button } from '@boilerplate/shared/components';
import type { Planning } from '../../types';
import styles from './PlanningList.module.css';

interface PlanningListProps {
  plannings: Planning[];
  activePlanningId: string | null;
  onSelect: (planning: Planning) => void;
  onEdit?: (planning: Planning) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function PlanningList({
  plannings,
  activePlanningId,
  onSelect,
  onDelete,
  onAdd,
}: PlanningListProps) {
  return (
    <div className={styles.container}>
      {plannings.length === 0 ? (
        <Card className={styles.emptyCard}>
          <div className={styles.emptyContent}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className={styles.emptyTitle}>Aucune roadmap</p>
            <p className={styles.emptyHint}>Créer votre première roadmap pour commencer</p>
            <Button variant="primary" onClick={onAdd}>
              + Nouvelle roadmap
            </Button>
          </div>
        </Card>
      ) : (
        <div className={styles.list}>
          {plannings.map((p) => (
            <Card
              key={p.id}
              variant="interactive"
              selected={p.id === activePlanningId}
              onClick={() => onSelect(p)}
              className={styles.docCard}
            >
              <div className="shared-card__content">
                <span className="shared-card__title">{p.name}</span>
                {p.description && <span className="shared-card__subtitle">{p.description}</span>}
              </div>
              <button
                className="shared-card__delete-btn"
                onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                title="Supprimer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
              <div className="shared-card__arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
