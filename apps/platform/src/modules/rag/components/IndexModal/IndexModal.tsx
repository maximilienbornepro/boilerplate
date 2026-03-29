import { useState, useEffect, useRef } from 'react';
import { Modal } from '@boilerplate/shared/components';
import type { ConfluenceSpace, IndexingStatus, IndexedDocument } from '../../types/index.js';
import {
  checkConfluenceConfigured,
  fetchAvailableSpaces,
  fetchSelectedSpaces,
  saveSelectedSpaces,
  triggerConfluenceIndexing,
  uploadDocument,
  fetchDocuments,
  deleteDocument,
} from '../../services/api.js';
import styles from './IndexModal.module.css';

interface Props {
  onClose: () => void;
  status: IndexingStatus | null;
}

type Tab = 'upload' | 'confluence';

export function IndexModal({ onClose, status }: Props) {
  const [tab, setTab] = useState<Tab>('upload');
  const [confluenceConfigured, setConfluenceConfigured] = useState(false);
  const [availableSpaces, setAvailableSpaces] = useState<ConfluenceSpace[]>([]);
  const [selectedSpaces, setSelectedSpaces] = useState<Set<string>>(new Set());
  const [documents, setDocuments] = useState<IndexedDocument[]>([]);
  const [isLoadingSpaces, setIsLoadingSpaces] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkConfluenceConfigured().then(setConfluenceConfigured);
    fetchDocuments().then(setDocuments).catch(console.error);
  }, []);

  useEffect(() => {
    if (tab === 'confluence' && confluenceConfigured) {
      loadSpaces();
    }
  }, [tab, confluenceConfigured]);

  async function loadSpaces() {
    setIsLoadingSpaces(true);
    setSpacesError(null);
    try {
      const [available, selected] = await Promise.all([
        fetchAvailableSpaces(),
        fetchSelectedSpaces(),
      ]);
      setAvailableSpaces(available);
      setSelectedSpaces(new Set(selected.map((s) => s.spaceKey)));
    } catch (err) {
      setSpacesError((err as Error).message || 'Erreur lors du chargement des espaces');
    } finally {
      setIsLoadingSpaces(false);
    }
  }

  function toggleSpace(key: string) {
    setSelectedSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSaveAndIndex() {
    const spaces = availableSpaces
      .filter((s) => selectedSpaces.has(s.key))
      .map((s) => ({ key: s.key, name: s.name }));
    await saveSelectedSpaces(spaces);
    await triggerConfluenceIndexing();
    onClose();
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const result = await uploadDocument(file);
      setUploadSuccess(`✓ Indexé — ${result.chunkCount} chunks extraits`);
      setDocuments(await fetchDocuments());
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDeleteDocument(id: number) {
    await deleteDocument(id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <Modal onClose={onClose} title="Indexer des contenus">
      <div className={styles.container}>
        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'upload' ? styles.active : ''}`}
            onClick={() => setTab('upload')}
          >
            Uploader un document
          </button>
          {confluenceConfigured && (
            <button
              className={`${styles.tab} ${tab === 'confluence' ? styles.active : ''}`}
              onClick={() => setTab('confluence')}
            >
              Confluence
              {status?.isIndexing && <span className={styles.indexingDot} />}
            </button>
          )}
        </div>

        {/* Upload tab */}
        {tab === 'upload' && (
          <div className={styles.panel}>
            <p className={styles.hint}>
              Formats supportés : PDF, Word (.docx), texte, markdown, JSON (Postman), CSV.
            </p>

            <div
              className={`${styles.uploadZone} ${isUploading ? styles.uploading : ''}`}
              onClick={() => !isUploading && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md,.json,.csv"
                onChange={handleFileUpload}
                className={styles.fileInput}
                disabled={isUploading}
              />
              {isUploading ? (
                <>
                  <span className={styles.uploadSpinner} />
                  <span className={styles.uploadLabel}>Indexation en cours…</span>
                </>
              ) : (
                <span className={styles.uploadLabel}>Cliquer ou glisser un fichier ici</span>
              )}
            </div>

            {uploadError && <p className={styles.error}>{uploadError}</p>}
            {uploadSuccess && <p className={styles.success}>{uploadSuccess}</p>}

            {documents.length > 0 && (
              <div className={styles.docList}>
                <span className={styles.docListTitle}>Documents indexés :</span>
                {documents.map((doc) => (
                  <div key={doc.id} className={styles.docItem}>
                    <span className={styles.docName}>{doc.name}</span>
                    <span className={styles.docMeta}>{doc.chunkCount} chunks</span>
                    <button
                      className={styles.docDelete}
                      onClick={() => handleDeleteDocument(doc.id)}
                      title="Supprimer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Confluence tab */}
        {tab === 'confluence' && (
          <div className={styles.panel}>
            {isLoadingSpaces ? (
              <p className={styles.hint}>Chargement des espaces…</p>
            ) : spacesError ? (
              <p className={styles.error}>{spacesError}</p>
            ) : (
              <>
                <p className={styles.hint}>
                  Sélectionnez les espaces Confluence à indexer.
                  {status?.lastIndexedAt && (
                    <span> Dernière indexation : {new Date(status.lastIndexedAt).toLocaleString('fr-FR')}</span>
                  )}
                </p>

                {status?.isIndexing && (
                  <div className={styles.indexingBanner}>Indexation en cours…</div>
                )}

                <div className={styles.spaceList}>
                  {availableSpaces.map((space) => (
                    <label key={space.key} className={styles.spaceItem}>
                      <input
                        type="checkbox"
                        checked={selectedSpaces.has(space.key)}
                        onChange={() => toggleSpace(space.key)}
                        disabled={status?.isIndexing}
                      />
                      <span className={styles.spaceKey}>[{space.key}]</span>
                      <span className={styles.spaceName}>{space.name}</span>
                    </label>
                  ))}
                </div>

                <div className={styles.actions}>
                  <button
                    className={styles.indexBtn}
                    onClick={handleSaveAndIndex}
                    disabled={selectedSpaces.size === 0 || status?.isIndexing}
                  >
                    Indexer les espaces sélectionnés
                  </button>
                </div>

                {!status?.pgvectorAvailable && (
                  <p className={styles.warning}>
                    pgvector non disponible — la recherche sémantique est désactivée.
                    Le contenu sera indexé sans embeddings.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
