import { useState, useEffect } from 'react';
import { ModuleHeader, ConfirmModal, Card, Button, ToastContainer, LoadingSpinner } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import type { CVAdaptationListItem } from '../../types';
import { getAdaptations, deleteAdaptation } from '../../services/api';
import './AdaptationsListPage.css';

interface AdaptationsListPageProps {
  cvId: number;
  cvName: string;
  onAdapt: () => void;
  onView: (adaptationId: number) => void;
  onBack: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdaptationsListPage({
  cvId,
  cvName,
  onAdapt,
  onView,
  onBack,
}: AdaptationsListPageProps) {
  const [adaptations, setAdaptations] = useState<CVAdaptationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CVAdaptationListItem | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...toast, id: Date.now().toString() }]);
  };

  useEffect(() => {
    loadAdaptations();
  }, [cvId]);

  const loadAdaptations = async () => {
    setLoading(true);
    try {
      const list = await getAdaptations(cvId);
      setAdaptations(list);
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors du chargement' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const name = confirmDelete.name || formatDate(confirmDelete.createdAt);
    setDeletingId(confirmDelete.id);
    setConfirmDelete(null);
    try {
      await deleteAdaptation(confirmDelete.id);
      setAdaptations(prev => prev.filter(a => a.id !== confirmDelete.id));
      addToast({ type: 'success', message: `"${name}" supprimé` });
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la suppression' });
    } finally {
      setDeletingId(null);
    }
  };

  const subtitle = loading
    ? ''
    : `${adaptations.length} adaptation${adaptations.length !== 1 ? 's' : ''}`;

  return (
    <>
      <ModuleHeader
        title={cvName}
        subtitle={subtitle}
        onBack={onBack}
      >
        <button className="module-header-btn module-header-btn-primary" onClick={onAdapt}>
          + Nouvelle adaptation
        </button>
      </ModuleHeader>

      <div className="apl-page">
        {loading ? (
          <LoadingSpinner message="Chargement..." />
        ) : adaptations.length === 0 ? (
          <Card className="apl-empty-card">
            <div className="apl-empty-content">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <path d="M9 13h6M9 17h4" />
              </svg>
              <p className="apl-empty-title">Aucune adaptation pour ce CV</p>
              <p className="apl-empty-hint">Adaptez ce CV à une offre d'emploi pour générer une version optimisée ATS</p>
              <Button variant="primary" onClick={onAdapt}>
                Analyser une offre
              </Button>
            </div>
          </Card>
        ) : (
          <div className="apl-list">
            {adaptations.map(adaptation => (
              <Card
                key={adaptation.id}
                variant="interactive"
                onClick={() => onView(adaptation.id)}
                className="apl-doc-card"
              >
                <div className="shared-card__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M9 13h6M9 17h4" />
                  </svg>
                </div>
                <div className="shared-card__content">
                  <span className="shared-card__title">
                    {adaptation.name || 'Adaptation sans titre'}
                  </span>
                </div>
                <button
                  className="shared-card__edit-btn"
                  onClick={(e) => { e.stopPropagation(); onView(adaptation.id); }}
                  title="Modifier"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  className="shared-card__delete-btn"
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(adaptation); }}
                  disabled={deletingId === adaptation.id}
                  title="Supprimer"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
                <div className="shared-card__arrow">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Supprimer cette adaptation ?"
          message={`L'adaptation du ${formatDate(confirmDelete.createdAt)} sera supprimée. Le CV original reste intact.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
          confirmLabel="Supprimer"
          danger
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}
