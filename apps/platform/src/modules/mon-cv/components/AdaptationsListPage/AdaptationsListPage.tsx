import { useState, useEffect } from 'react';
import { ModuleHeader, ConfirmModal } from '@boilerplate/shared/components';
import type { CVAdaptationListItem } from '../../types';
import { getAdaptations, deleteAdaptation, downloadAdaptationPDF } from '../../services/api';
import './AdaptationsListPage.css';

interface AdaptationsListPageProps {
  cvId: number;
  cvName: string;
  onAdapt: () => void;
  onView: (adaptationId: number) => void;
  onBack: () => void;
}

function getScoreClass(score: number): string {
  if (score >= 75) return 'apl-score--good';
  if (score >= 50) return 'apl-score--medium';
  return 'apl-score--bad';
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
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CVAdaptationListItem | null>(null);

  useEffect(() => {
    loadAdaptations();
  }, [cvId]);

  const loadAdaptations = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await getAdaptations(cvId);
      setAdaptations(list);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    setConfirmDelete(null);
    try {
      await deleteAdaptation(confirmDelete.id);
      setAdaptations(prev => prev.filter(a => a.id !== confirmDelete.id));
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownloadPDF = async (adaptation: CVAdaptationListItem) => {
    setDownloadingId(adaptation.id);
    try {
      const name = adaptation.name || `CV_adapte_${new Date(adaptation.createdAt).toLocaleDateString('fr-FR').replace(/\//g, '-')}`;
      await downloadAdaptationPDF(adaptation.id, `${name}.pdf`);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du téléchargement PDF');
    } finally {
      setDownloadingId(null);
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
        {error && <div className="apl-error">{error}</div>}

        {loading ? (
          <div className="apl-loading">Chargement...</div>
        ) : adaptations.length === 0 ? (
          <div className="apl-empty">
            <div className="apl-empty__icon">📄</div>
            <p className="apl-empty__title">Aucune adaptation pour ce CV</p>
            <p className="apl-empty__text">
              Adaptez ce CV à une offre d'emploi pour générer une version optimisée ATS.
            </p>
            <button className="module-header-btn module-header-btn-primary" onClick={onAdapt}>
              Adapter ce CV
            </button>
          </div>
        ) : (
          <div className="apl-grid">
            {adaptations.map(adaptation => (
              <div key={adaptation.id} className="apl-card">
                <div className="apl-card__header">
                  <span className="apl-card__name">
                    {adaptation.name || 'Adaptation sans titre'}
                  </span>
                  <span className={`apl-score ${getScoreClass(adaptation.atsAfterOverall)}`}>
                    {adaptation.atsAfterOverall}%
                  </span>
                </div>

                <p className="apl-card__offer">
                  {adaptation.jobOfferPreview}
                  {adaptation.jobOfferPreview.length >= 120 && '…'}
                </p>

                <div className="apl-card__meta">
                  <span>+{adaptation.missionsAdded} mission{adaptation.missionsAdded !== 1 ? 's' : ''}</span>
                  <span className="apl-card__sep">·</span>
                  <span>{formatDate(adaptation.createdAt)}</span>
                </div>

                <div className="apl-card__actions">
                  <button
                    className="module-header-btn apl-card__btn"
                    onClick={() => onView(adaptation.id)}
                  >
                    Voir / Éditer
                  </button>
                  <button
                    className="module-header-btn apl-card__btn"
                    onClick={() => handleDownloadPDF(adaptation)}
                    disabled={downloadingId === adaptation.id}
                  >
                    {downloadingId === adaptation.id ? '…' : '↓ PDF'}
                  </button>
                  <button
                    className="module-header-btn apl-card__btn apl-card__btn--delete"
                    onClick={() => setConfirmDelete(adaptation)}
                    disabled={deletingId === adaptation.id}
                  >
                    {deletingId === adaptation.id ? '…' : '×'}
                  </button>
                </div>
              </div>
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
          variant="danger"
        />
      )}
    </>
  );
}
