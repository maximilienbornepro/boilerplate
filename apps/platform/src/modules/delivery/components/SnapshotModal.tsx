import { useState, useEffect } from 'react';
import { Modal, ModalBody, ModalActions, Button } from '@boilerplate/shared/components';
import styles from './SnapshotModal.module.css';
import {
  fetchSnapshots,
  fetchSnapshotDetail,
  restoreSnapshot,
} from '../services/api';
import type { SnapshotSummary, SnapshotDetail } from '../services/api';

interface SnapshotModalProps {
  incrementId: string;
  onRestore: () => Promise<void> | void;
  onClose: () => void;
}

export function SnapshotModal({ incrementId, onRestore, onClose }: SnapshotModalProps) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    loadSnapshots();
  }, [incrementId]);

  const loadSnapshots = async () => {
    try {
      setIsLoading(true);
      const data = await fetchSnapshots(incrementId);
      setSnapshots(data);
    } catch (error) {
      console.error('Failed to load snapshots:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectSnapshot = async (snapshotId: number) => {
    try {
      const detail = await fetchSnapshotDetail(snapshotId);
      setSelectedSnapshot(detail);
      setShowConfirm(false);
    } catch (error) {
      console.error('Failed to load snapshot detail:', error);
    }
  };

  const handleRestore = async () => {
    if (!selectedSnapshot) return;

    try {
      setIsRestoring(true);
      await restoreSnapshot(selectedSnapshot.id);
      await onRestore();
      onClose();
    } catch (error) {
      console.error('Failed to restore snapshot:', error);
    } finally {
      setIsRestoring(false);
      setShowConfirm(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  const getDayLabelFull = (createdAt: string): string => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const snapshot = new Date(createdAt);
    snapshot.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - snapshot.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    return `Il y a ${diffDays} jours`;
  };

  return (
    <Modal title="Historique des versions" onClose={onClose} size="lg">
      <ModalBody>
        <div className={styles.content}>
          {isLoading ? (
            <div className={styles.loading}>Chargement...</div>
          ) : snapshots.length === 0 ? (
            <div className={styles.empty}>
              Aucun historique disponible.
              <br />
              <span className={styles.hint}>Les snapshots sont créés automatiquement chaque jour.</span>
            </div>
          ) : (
            <div className={styles.layout}>
              <div className={styles.snapshotList}>
                {snapshots.map((snapshot) => {
                  const isAiSnapshot = snapshot.label.includes('rangement IA');
                  return (
                    <div
                      key={snapshot.id}
                      className={`${styles.snapshotItem} ${selectedSnapshot?.id === snapshot.id ? styles.selected : ''} ${isAiSnapshot ? styles.aiSnapshot : ''}`}
                      onClick={() => handleSelectSnapshot(snapshot.id)}
                    >
                      <div className={styles.snapshotLabel}>
                        {isAiSnapshot && <span className={styles.aiTag}>↩ IA</span>}
                        {snapshot.label}
                      </div>
                      <div className={styles.snapshotInfo}>
                        <div className={styles.snapshotDate}>{formatDate(snapshot.createdAt)}</div>
                        <div className={styles.snapshotMeta}>
                          {snapshot.taskCount} positions | {snapshot.hiddenCount} masqués
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedSnapshot && (
                <div className={styles.preview}>
                  <h4>{getDayLabelFull(selectedSnapshot.createdAt)}</h4>
                  <div className={styles.previewDetails}>
                    <div className={styles.previewRow}>
                      <span>Positions:</span>
                      <strong>{selectedSnapshot.snapshotData.taskPositions.length}</strong>
                    </div>
                    <div className={styles.previewRow}>
                      <span>Tickets masques:</span>
                      <strong>{selectedSnapshot.snapshotData.incrementState.hiddenTaskIds.length}</strong>
                    </div>
                    <div className={styles.previewRow}>
                      <span>Fige:</span>
                      <strong>{selectedSnapshot.snapshotData.incrementState.isFrozen ? 'Oui' : 'Non'}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ModalBody>
      <ModalActions>
        {!showConfirm && (
          <>
            <Button variant="secondary" onClick={onClose}>Fermer</Button>
            {selectedSnapshot && (
              <Button variant="primary" onClick={() => setShowConfirm(true)} disabled={isRestoring}>
                Restaurer cette version
              </Button>
            )}
          </>
        )}
        {showConfirm && (
          <div className={styles.confirmGroup}>
            <span className={styles.confirmText}>Confirmer la restauration?</span>
            <Button variant="secondary" onClick={() => setShowConfirm(false)}>Non</Button>
            <Button variant="primary" onClick={handleRestore} disabled={isRestoring}>
              {isRestoring ? 'Restauration...' : 'Oui, restaurer'}
            </Button>
          </div>
        )}
      </ModalActions>
    </Modal>
  );
}
