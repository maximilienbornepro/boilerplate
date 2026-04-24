import { useState } from 'react';
import { Card, Button, SharingModal, EmptyState } from '@boilerplate/shared/components';
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
  onEdit,
  onDelete,
  onAdd,
}: PlanningListProps) {
  const [sharingPlanning, setSharingPlanning] = useState<Planning | null>(null);
  return (
    <div className={styles.container}>
      {plannings.length === 0 ? (
        <EmptyState
          icon={
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          }
          title="Aucune roadmap"
          hint="Créer votre première roadmap pour commencer"
          action={
            <Button variant="primary" onClick={onAdd}>
              + Nouvelle roadmap
            </Button>
          }
        />
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
              {onEdit && (
                <button
                  className="shared-card__edit-btn"
                  onClick={(e) => { e.stopPropagation(); onEdit(p); }}
                  title="Modifier"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
              <button
                className="shared-card__edit-btn"
                onClick={(e) => { e.stopPropagation(); setSharingPlanning(p); }}
                title="Partager"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </button>
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
      {sharingPlanning && (
        <SharingModal
          resourceType="roadmap"
          resourceId={sharingPlanning.id}
          resourceName={sharingPlanning.name}
          onClose={() => setSharingPlanning(null)}
        />
      )}
    </div>
  );
}
