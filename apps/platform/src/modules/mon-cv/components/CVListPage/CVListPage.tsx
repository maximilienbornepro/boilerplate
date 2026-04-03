import { useState, useEffect, useRef } from 'react';
import { ModuleHeader, Modal, ConfirmModal, Card, FormField, Button, ToastContainer, LoadingSpinner, Badge } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import type { CVListItem } from '../../types';
import { createEmptyCV } from '../../types';
import * as api from '../../services/api';
import './CVListPage.css';

interface CVListPageProps {
  onEdit: (cvId: number) => void;
  onAdapt: (cvId: number) => void;
  onAdaptations: (cvId: number) => void;
  onBack: () => void;
}

export function CVListPage({ onEdit, onAdapt, onAdaptations, onBack }: CVListPageProps) {
  const [cvs, setCvs] = useState<CVListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newCvName, setNewCvName] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<CVListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...toast, id: Date.now().toString() }]);
  };

  useEffect(() => {
    loadCVs();
  }, []);

  const loadCVs = async () => {
    setLoading(true);
    try {
      const list = await api.fetchAllCVs();
      setCvs(list);
      if (list.length === 0) setShowCreate(true);
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors du chargement' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const name = newCvName.trim() || 'Nouveau CV';
    setCreating(true);
    try {
      const created = await api.createCV(name, createEmptyCV(), false);
      setShowCreate(false);
      setNewCvName('');
      addToast({ type: 'success', message: `CV "${name}" créé` });
      onEdit(created.id);
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la création' });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, cv: CVListItem) => {
    e.stopPropagation();
    if (cv.isDefault) {
      addToast({ type: 'warning', message: 'Le CV par défaut ne peut pas être supprimé' });
      return;
    }
    setConfirmDelete(cv);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const name = confirmDelete.name;
    setDeleting(true);
    try {
      await api.deleteCV(confirmDelete.id);
      setCvs(prev => prev.filter(c => c.id !== confirmDelete.id));
      setConfirmDelete(null);
      addToast({ type: 'success', message: `"${name}" supprimé` });
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la suppression' });
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ModuleHeader
        title="Mes CV"
        subtitle={loading ? '' : `${cvs.length} CV${cvs.length > 1 ? 's' : ''}`}
        onBack={onBack}
      >
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={() => setShowCreate(true)}
        >
          + Nouveau CV
        </button>
      </ModuleHeader>

      <div className="cv-list-page">
        {loading ? (
          <LoadingSpinner message="Chargement..." />
        ) : cvs.length === 0 ? (
          <Card className="cv-list-empty-card">
            <div className="cv-list-empty-content">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p className="cv-list-empty-title">Aucun CV</p>
              <p className="cv-list-empty-hint">Créez votre premier CV pour commencer</p>
              <Button variant="primary" onClick={() => setShowCreate(true)}>
                + Nouveau CV
              </Button>
            </div>
          </Card>
        ) : (
          <div className="cv-list-items">
            {cvs.map(cv => (
              <Card
                key={cv.id}
                variant="interactive"
                onClick={() => onEdit(cv.id)}
                className="cv-list-doc-card"
              >
                <div className="shared-card__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <div className="shared-card__content">
                  <span className="shared-card__title">
                    {cv.name}
                  </span>
                  {cv.isDefault && (
                    <Badge type="accent">Par défaut</Badge>
                  )}
                </div>
                <button
                  className="shared-card__edit-btn"
                  onClick={(e) => { e.stopPropagation(); onEdit(cv.id); }}
                  title="Modifier"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  className="shared-card__delete-btn"
                  onClick={(e) => handleDeleteClick(e, cv)}
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

      {/* Create modal */}
      {showCreate && (
        <Modal title="Nouveau CV" onClose={() => { setShowCreate(false); setNewCvName(''); }}>
          <div className="cv-list-modal-body">
            <FormField label="Nom du CV" required>
              <input
                type="text"
                placeholder="Ex : CV Développeur, CV Manager..."
                value={newCvName}
                onChange={e => setNewCvName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') { setShowCreate(false); setNewCvName(''); }
                }}
                autoFocus
              />
            </FormField>
            <div className="cv-list-modal-actions">
              <Button variant="secondary" onClick={() => { setShowCreate(false); setNewCvName(''); }}>
                Annuler
              </Button>
              <Button variant="primary" onClick={handleCreate} disabled={creating}>
                {creating ? 'Création...' : 'Créer'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <ConfirmModal
          title={`Supprimer "${confirmDelete.name}" ?`}
          message="Ce CV et toutes ses adaptations seront supprimés définitivement."
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
          confirmLabel={deleting ? 'Suppression...' : 'Supprimer'}
          danger
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}
