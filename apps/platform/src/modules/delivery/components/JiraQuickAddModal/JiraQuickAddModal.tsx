import { useState } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import styles from './JiraQuickAddModal.module.css';

interface Props {
  boardId: string;
  /** Pre-selected increment/sprint id — the task joins this one. */
  incrementId?: string | null;
  onClose: () => void;
  /** Fires once the task is successfully created so the parent can refetch. */
  onAdded: (task: api.Task) => void;
}

/**
 * Quick-add modal : paste a Jira URL (or bare key) → preview → confirm
 * to add it to the current delivery board. Uses the existing Jira auth
 * context (OAuth or basic) ; fails gracefully if neither is configured.
 *
 * Kept intentionally small — no search, no browse. For broader imports,
 * use the "Importer des tâches" flow.
 */
export function JiraQuickAddModal({ boardId, incrementId, onClose, onAdded }: Props) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<api.JiraIssueFromUrl | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handlePreview = async () => {
    setError('');
    setPreview(null);
    if (!url.trim()) return;
    setLoadingPreview(true);
    try {
      const res = await api.fetchJiraIssueByUrl(url.trim());
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setCreating(true);
    setError('');
    try {
      const task = await api.createTaskFromJiraUrl(boardId, {
        url: url.trim(),
        incrementId: incrementId ?? undefined,
      });
      onAdded(task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer la tâche');
      setCreating(false);
    }
  };

  return (
    <Modal title="Ajouter un ticket Jira" onClose={onClose} size="md">
      <div className={styles.content}>
        <p className={styles.hint}>
          Colle une URL Jira (ou juste la clé : <code>TVSMART-2181</code>) — on utilise ta connexion
          Jira existante (OAuth ou token) pour récupérer les détails.
        </p>

        <div className={styles.inputRow}>
          <input
            type="text"
            className={styles.urlInput}
            placeholder="https://francetv.atlassian.net/browse/TVSMART-2181  ou  TVSMART-2181"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={loadingPreview || creating}
            onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !preview) handlePreview(); }}
            autoFocus
          />
          {!preview && (
            <Button variant="secondary" onClick={handlePreview} disabled={loadingPreview || !url.trim()}>
              {loadingPreview ? 'Chargement…' : 'Prévisualiser'}
            </Button>
          )}
        </div>

        {loadingPreview && (
          <div className={styles.loadingBox}>
            <LoadingSpinner message="Récupération du ticket…" />
          </div>
        )}

        {preview && (
          <div className={styles.preview}>
            <div className={styles.previewHead}>
              <span className={styles.previewKey}>{preview.key}</span>
              <span className={styles.previewType}>{preview.issueType}</span>
              <span className={styles.previewStatus}>{preview.status}</span>
              <span className={styles.previewAuth} title={preview.authMode === 'oauth' ? 'Récupéré via OAuth 2.0' : 'Récupéré via token Basic Auth'}>
                {preview.authMode === 'oauth' ? '🔐 OAuth' : '🔑 Token'}
              </span>
            </div>
            <h4 className={styles.previewSummary}>{preview.summary}</h4>
            <div className={styles.previewMeta}>
              {preview.assignee && <span>👤 {preview.assignee}</span>}
              {preview.storyPoints != null && <span>⚡ {preview.storyPoints} SP</span>}
              {preview.estimatedDays != null && <span>📆 {preview.estimatedDays} j</span>}
              {preview.fixVersion && <span>🎯 {preview.fixVersion}</span>}
              {preview.sprintName && <span>🏃 {preview.sprintName}</span>}
              {preview.priority && <span>⚑ {preview.priority}</span>}
            </div>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={creating}>Annuler</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={!preview || creating}>
            {creating ? 'Création…' : 'Ajouter au board'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
