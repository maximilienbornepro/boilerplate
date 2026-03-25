import { useState, useEffect } from 'react';
import * as api from '../../services/api';
import type { SnapshotInfo, DocumentWithSections } from '../../types';
import styles from './HistoryPanel.module.css';

interface Props {
  documentId: string;
  onClose: () => void;
  onRestore: () => void;
}

export function HistoryPanel({ documentId, onClose, onRestore }: Props) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<DocumentWithSections | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const history = await api.getDocumentHistory(documentId);
        setSnapshots(history);
      } catch (err) {
        console.error('Failed to load history:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [documentId]);

  const handlePreview = async (snapshotId: number) => {
    if (previewId === snapshotId) {
      setPreviewId(null);
      setPreviewData(null);
      return;
    }
    try {
      const snapshot = await api.getSnapshot(snapshotId);
      setPreviewId(snapshotId);
      setPreviewData(snapshot.data);
    } catch (err) {
      console.error('Failed to load preview:', err);
    }
  };

  const handleRestore = async (snapshotId: number) => {
    const snapshot = snapshots.find(s => s.id === snapshotId);
    if (!snapshot) return;

    const date = new Date(snapshot.created_at).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (!window.confirm(`Restaurer la version du ${date} ?\n\nLe contenu actuel sera sauvegardé dans l'historique avant la restauration.`)) {
      return;
    }

    setRestoring(snapshotId);
    try {
      await api.restoreSnapshot(snapshotId);
      onRestore();
      onClose();
    } catch (err) {
      console.error('Failed to restore:', err);
      alert('Erreur lors de la restauration');
    } finally {
      setRestoring(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday = date.toDateString() === today.toDateString();
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
      return `Aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (isYesterday) {
      return `Hier à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Render structured preview of snapshot data
  const renderPreview = (data: DocumentWithSections) => {
    return (
      <div className={styles.previewStructured}>
        {data.sections.map((section, sIdx) => (
          <div key={section.id || sIdx} className={styles.previewSection}>
            <div className={styles.previewSectionName}>{section.name}</div>
            {section.subjects.map((subject, subIdx) => (
              <div key={subject.id || subIdx} className={styles.previewSubject}>
                <div className={styles.previewSubjectHeader}>
                  <span className={styles.previewSubjectTitle}>{subject.title}</span>
                  <span className={styles.previewSubjectStatus}>{subject.status}</span>
                </div>
                {subject.situation && (
                  <div className={styles.previewSubjectSituation}>
                    {subject.situation.split('\n').map((line, i) => (
                      <div key={i}>{line || '\u00A0'}</div>
                    ))}
                  </div>
                )}
                {subject.responsibility && (
                  <div className={styles.previewSubjectResponsibility}>
                    Responsable: {subject.responsibility}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Historique</h2>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>Chargement...</div>
          ) : snapshots.length === 0 ? (
            <div className={styles.empty}>
              Aucun historique disponible.
              <br />
              <span className={styles.hint}>Un snapshot est créé automatiquement une fois par jour lors de la première modification.</span>
            </div>
          ) : (
            <div className={styles.list}>
              {snapshots.map(snapshot => (
                <div key={snapshot.id} className={styles.item}>
                  <div className={styles.itemHeader}>
                    <span className={styles.date}>{formatDate(snapshot.created_at)}</span>
                    <div className={styles.actions}>
                      <button
                        className={styles.previewBtn}
                        onClick={() => handlePreview(snapshot.id)}
                      >
                        {previewId === snapshot.id ? 'Masquer' : 'Voir'}
                      </button>
                      <button
                        className={styles.restoreBtn}
                        onClick={() => handleRestore(snapshot.id)}
                        disabled={restoring !== null}
                      >
                        {restoring === snapshot.id ? 'Restauration...' : 'Restaurer'}
                      </button>
                    </div>
                  </div>
                  {previewId === snapshot.id && previewData && (
                    <div className={styles.preview}>
                      {renderPreview(previewData)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
