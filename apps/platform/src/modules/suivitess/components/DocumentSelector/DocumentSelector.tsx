import { useState, useEffect } from 'react';
import { ModuleHeader, Card, Modal, FormField, ConfirmModal, Button, ToastContainer, LoadingSpinner } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import type { Document } from '../../types';
import * as api from '../../services/api';
import styles from './DocumentSelector.module.css';

interface DocumentSelectorProps {
  onSelect: (doc: Document) => void;
  onNavigate?: (path: string) => void;
}

interface DeleteConfirmState {
  show: boolean;
  doc: Document | null;
}

export function DocumentSelector({ onSelect, onNavigate: _onNavigate }: DocumentSelectorProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({ show: false, doc: null });
  const [deleting, setDeleting] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...toast, id: Date.now().toString() }]);
  };

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const docs = await api.fetchDocuments();
        setDocuments(docs);
      } catch (err) {
        console.error('Failed to load documents:', err);
        setError('Impossible de charger les documents');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleCreateDocument = async () => {
    if (!newTitle.trim()) return;

    setCreating(true);
    try {
      const newDoc = await api.createDocument(newTitle.trim());
      setDocuments(prev => [...prev, newDoc]);
      setShowCreateForm(false);
      setNewTitle('');
      addToast({ type: 'success', message: `Review "${newDoc.title}" créée avec succès` });
      onSelect(newDoc);
    } catch (err) {
      console.error('Failed to create document:', err);
      addToast({ type: 'error', message: 'Erreur lors de la création du document' });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    setDeleteConfirm({ show: true, doc });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm.doc) return;
    const docTitle = deleteConfirm.doc.title;

    setDeleting(true);
    try {
      await api.deleteDocument(deleteConfirm.doc.id);
      setDocuments(prev => prev.filter(d => d.id !== deleteConfirm.doc!.id));
      setDeleteConfirm({ show: false, doc: null });
      addToast({ type: 'success', message: `"${docTitle}" supprimé` });
    } catch (err) {
      console.error('Failed to delete document:', err);
      addToast({ type: 'error', message: 'Erreur lors de la suppression' });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <>
        <ModuleHeader title="SuiviTess" />
        <div className={styles.container}>
          <LoadingSpinner message="Chargement des documents..." />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <ModuleHeader title="SuiviTess" />
        <div className={styles.container}>
          <Card className={styles.emptyCard}>
            <div className={styles.emptyContent}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <p className={styles.emptyTitle}>{error}</p>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Réessayer
              </Button>
            </div>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <ModuleHeader title="SuiviTess">
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={() => setShowCreateForm(true)}
        >
          + Nouvelle review
        </button>
      </ModuleHeader>

      <div className={styles.container}>
        {documents.length === 0 ? (
          <Card className={styles.emptyCard}>
            <div className={styles.emptyContent}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p className={styles.emptyTitle}>Aucun document</p>
              <p className={styles.emptyHint}>Créer votre première review pour commencer</p>
              <Button variant="primary" onClick={() => setShowCreateForm(true)}>
                + Nouvelle review
              </Button>
            </div>
          </Card>
        ) : (
          <div className={styles.list}>
            {documents.map((doc) => (
              <Card key={doc.id} variant="interactive" onClick={() => onSelect(doc)} className={styles.docCard}>
                <div className="shared-card__content">
                  <span className="shared-card__title">{doc.title}</span>
                </div>
                <button
                  className="shared-card__delete-btn"
                  onClick={(e) => handleDeleteClick(e, doc)}
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

        {/* Create document modal */}
        {showCreateForm && (
          <Modal title="Créer une nouvelle review" onClose={() => { setShowCreateForm(false); setNewTitle(''); }}>
            <div className={styles.modalBody}>
              <FormField label="Nom de la review" required>
                <input
                  type="text"
                  placeholder="Ex: Hebdo Interne"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateDocument()}
                  autoFocus
                />
              </FormField>
              <div className={styles.modalActions}>
                <Button variant="secondary" onClick={() => { setShowCreateForm(false); setNewTitle(''); }}>
                  Annuler
                </Button>
                <Button variant="primary" onClick={handleCreateDocument} disabled={!newTitle.trim() || creating}>
                  {creating ? 'Création...' : 'Créer'}
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {/* Delete confirmation modal */}
        {deleteConfirm.show && deleteConfirm.doc && (
          <ConfirmModal
            title="Supprimer le document"
            message={`Êtes-vous sûr de vouloir supprimer "${deleteConfirm.doc.title}" ? Cette action est irréversible.`}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setDeleteConfirm({ show: false, doc: null })}
            confirmLabel={deleting ? 'Suppression...' : 'Supprimer'}
            danger
          />
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}
