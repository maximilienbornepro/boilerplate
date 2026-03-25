import { useState, useEffect } from 'react';
import type { Document } from '../../types';
import * as api from '../../services/api';
import styles from './DocumentSelector.module.css';

interface DocumentSelectorProps {
  onSelect: (doc: Document) => void;
}

interface DeleteConfirmState {
  show: boolean;
  doc: Document | null;
}

export function DocumentSelector({ onSelect }: DocumentSelectorProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({ show: false, doc: null });
  const [deleting, setDeleting] = useState(false);

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
      // New API only requires title - no markdown content
      const newDoc = await api.createDocument(newTitle.trim());
      setDocuments(prev => [...prev, newDoc]);
      setShowCreateForm(false);
      setNewTitle('');
      onSelect(newDoc);
    } catch (err) {
      console.error('Failed to create document:', err);
      setError('Erreur lors de la création du document');
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

    setDeleting(true);
    try {
      await api.deleteDocument(deleteConfirm.doc.id);
      setDocuments(prev => prev.filter(d => d.id !== deleteConfirm.doc!.id));
      setDeleteConfirm({ show: false, doc: null });
    } catch (err) {
      console.error('Failed to delete document:', err);
      setError('Erreur lors de la suppression du document');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Chargement des documents...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Choisir un document</h2>
        <p className={styles.subtitle}>
          Selectionnez le document a mettre a jour
        </p>
      </div>

      <div className={styles.grid}>
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={styles.card}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(doc)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(doc)}
          >
            <div className={styles.cardIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div className={styles.cardContent}>
              <span className={styles.cardTitle}>{doc.title}</span>
            </div>
            <button
              className={styles.deleteBtn}
              onClick={(e) => handleDeleteClick(e, doc)}
              title="Supprimer ce document"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

        {/* Create new document button */}
        <button
          className={`${styles.card} ${styles.createCard}`}
          onClick={() => setShowCreateForm(true)}
        >
          <div className={styles.cardIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div className={styles.cardContent}>
            <span className={styles.cardTitle}>Nouvelle review</span>
          </div>
        </button>
      </div>

      {/* Create document modal */}
      {showCreateForm && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h3>Créer une nouvelle review</h3>
            <input
              type="text"
              className={styles.input}
              placeholder="Nom de la review (ex: Hebdo Interne)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateDocument()}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => {
                  setShowCreateForm(false);
                  setNewTitle('');
                }}
              >
                Annuler
              </button>
              <button
                className={styles.createBtn}
                onClick={handleCreateDocument}
                disabled={!newTitle.trim() || creating}
              >
                {creating ? 'Création...' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm.show && deleteConfirm.doc && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h3>Supprimer le document</h3>
            <p className={styles.deleteWarning}>
              Êtes-vous sûr de vouloir supprimer "{deleteConfirm.doc.title}" ?
              <br />
              <span className={styles.deleteHint}>Cette action est irréversible.</span>
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setDeleteConfirm({ show: false, doc: null })}
                disabled={deleting}
              >
                Annuler
              </button>
              <button
                className={styles.deleteBtnConfirm}
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {documents.length === 0 && !showCreateForm && (
        <div className={styles.empty}>
          <p>Aucun document configuré</p>
          <p className={styles.emptyHint}>
            Cliquez sur "Nouvelle review" pour créer votre première review
          </p>
        </div>
      )}
    </div>
  );
}
