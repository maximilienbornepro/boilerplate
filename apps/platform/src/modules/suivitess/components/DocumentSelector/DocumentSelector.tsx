import { useState, useEffect } from 'react';
import { ModuleHeader, Card, Modal, FormField, ConfirmModal, Button, ToastContainer, LoadingSpinner, SharingModal, VisibilityPicker } from '@boilerplate/shared/components';
import type { ToastData, Visibility } from '@boilerplate/shared/components';
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
  const [newDescription, setNewDescription] = useState('');
  const [newVisibility, setNewVisibility] = useState<Visibility>('private');
  const [creating, setCreating] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({ show: false, doc: null });
  const [deleting, setDeleting] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [sharingDoc, setSharingDoc] = useState<Document | null>(null);

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

  // Auto-open create modal if URL has ?create=1 (from Dashboard)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      setShowCreateForm(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('create');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const handleCreateDocument = async () => {
    if (!newTitle.trim()) return;

    setCreating(true);
    try {
      const newDoc = await api.createDocument(newTitle.trim(), newDescription.trim() || undefined, newVisibility);
      setDocuments(prev => [...prev, newDoc]);
      setShowCreateForm(false);
      setNewTitle('');
      setNewDescription('');
      setNewVisibility('private');
      addToast({ type: 'success', message: `Review "${newDoc.title}" créée avec succès` });
      onSelect(newDoc);
    } catch (err) {
      console.error('Failed to create document:', err);
      addToast({ type: 'error', message: 'Erreur lors de la création du document' });
    } finally {
      setCreating(false);
    }
  };

  const handleEditClick = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    setEditingDoc(doc);
    setEditTitle(doc.title);
    setEditDescription(doc.description ?? '');
  };

  const handleEditSave = async () => {
    if (!editingDoc || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      const updated = await api.updateDocument(editingDoc.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
      });
      setDocuments(prev => prev.map(d => d.id === updated.id ? updated : d));
      setEditingDoc(null);
      addToast({ type: 'success', message: 'Review modifiée' });
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la modification' });
    } finally {
      setSavingEdit(false);
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
        {/* Chrome Extension Banner */}
        <div className={styles.extensionBanner}>
          <div className={styles.extensionIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <div className={styles.extensionText}>
            <strong>Extension Chrome disponible</strong>
            <span>Importez vos mails Outlook et messages Slack directement dans vos reviews</span>
          </div>
          <a
            href="https://github.com/maximilienbornepro/boilerplate/tree/main/apps/platform/extensions/suivitess-importer"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.extensionLink}
          >
            Installer
          </a>
        </div>

        {documents.length === 0 ? (
          <Card className={styles.emptyCard}>
            <div className={styles.emptyContent}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <p className={styles.emptyTitle}>Aucune review</p>
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
                  {doc.description && <span className="shared-card__subtitle">{doc.description}</span>}
                </div>
                <button
                  className="shared-card__edit-btn"
                  onClick={(e) => handleEditClick(e, doc)}
                  title="Modifier"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  className="shared-card__edit-btn"
                  onClick={(e) => { e.stopPropagation(); setSharingDoc(doc); }}
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
          <Modal title="Créer une nouvelle review" onClose={() => { setShowCreateForm(false); setNewTitle(''); setNewDescription(''); setNewVisibility('private'); }}>
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
              <FormField label="Description">
                <textarea
                  placeholder="Description optionnelle"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                />
              </FormField>
              <FormField label="Visibilité">
                <VisibilityPicker value={newVisibility} onChange={setNewVisibility} />
              </FormField>
              <div className={styles.modalActions}>
                <Button variant="secondary" onClick={() => { setShowCreateForm(false); setNewTitle(''); setNewDescription(''); setNewVisibility('private'); }}>
                  Annuler
                </Button>
                <Button variant="primary" onClick={handleCreateDocument} disabled={!newTitle.trim() || creating}>
                  {creating ? 'Création...' : 'Créer'}
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {/* Edit document modal */}
        {editingDoc && (
          <Modal title="Modifier la review" onClose={() => setEditingDoc(null)}>
            <div className={styles.modalBody}>
              <FormField label="Nom de la review" required>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEditSave()}
                  autoFocus
                />
              </FormField>
              <FormField label="Description">
                <textarea
                  placeholder="Description optionnelle"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                />
              </FormField>
              <div className={styles.modalActions}>
                <Button variant="secondary" onClick={() => setEditingDoc(null)}>
                  Annuler
                </Button>
                <Button variant="primary" onClick={handleEditSave} disabled={!editTitle.trim() || savingEdit}>
                  {savingEdit ? 'Modification...' : 'Modifier'}
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

      {sharingDoc && (
        <SharingModal
          resourceType="suivitess"
          resourceId={sharingDoc.id}
          resourceName={sharingDoc.title}
          onClose={() => setSharingDoc(null)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}
