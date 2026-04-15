import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import { runSanityCheck, applySanityMoves, type SanityMoveRecommendation } from '../../services/api';
import styles from './SanityCheckModal.module.css';

interface Props {
  boardId: string;
  onClose: () => void;
  onApplied: () => void;
  /** Called with a {type, message} toast payload — plug into the page's toast system. */
  onToast?: (toast: { type: 'success' | 'error' | 'warning'; message: string }) => void;
}

export function SanityCheckModal({ boardId, onClose, onApplied, onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [recommendations, setRecommendations] = useState<SanityMoveRecommendation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setLoading(true);
    runSanityCheck(boardId)
      .then(res => {
        setSummary(res.summary);
        setRecommendations(res.recommendations);
        setSelected(new Set(res.recommendations.map(r => r.taskId)));
      })
      .catch((err: Error) => {
        setError(err.message || 'Analyse échouée');
      })
      .finally(() => setLoading(false));
  }, [boardId]);

  const toggle = (taskId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === recommendations.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(recommendations.map(r => r.taskId)));
    }
  };

  const grouped = useMemo(() => {
    const byPriority: Record<'high' | 'medium' | 'low', SanityMoveRecommendation[]> = {
      high: [], medium: [], low: [],
    };
    for (const r of recommendations) byPriority[r.priority].push(r);
    return byPriority;
  }, [recommendations]);

  const handleApply = async () => {
    const moves = recommendations
      .filter(r => selected.has(r.taskId))
      .map(r => ({
        taskId: r.taskId,
        startCol: r.recommended.startCol,
        endCol: r.recommended.endCol,
        row: r.recommended.row,
      }));
    if (moves.length === 0) return;

    setApplying(true);
    try {
      const res = await applySanityMoves(boardId, moves);
      onToast?.({ type: 'success', message: `${res.applied} déplacement${res.applied > 1 ? 's' : ''} appliqué${res.applied > 1 ? 's' : ''}` });
      onApplied();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Échec de l\'application';
      setError(message);
      onToast?.({ type: 'error', message });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal title="✨ Vérification IA du board" onClose={onClose} size="xl">
      <div className={styles.content}>
        {loading ? (
          <div className={styles.loading}>
            <LoadingSpinner message="L'IA analyse votre board…" />
          </div>
        ) : error ? (
          <div className={styles.error}>
            <strong>Analyse impossible</strong>
            <p>{error}</p>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>Fermer</Button>
            </div>
          </div>
        ) : recommendations.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Tout semble bien positionné ✓</p>
            <p className={styles.emptyHint}>{summary || 'L\'IA n\'a détecté aucun ajustement nécessaire sur ce board.'}</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onClose}>D'accord</Button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.summary}>{summary}</div>

            <div className={styles.toolbar}>
              <button type="button" className={styles.linkBtn} onClick={toggleAll}>
                {selected.size === recommendations.length ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
              <span className={styles.counter}>
                {selected.size} / {recommendations.length} sélectionnée{recommendations.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className={styles.list}>
              {(['high', 'medium', 'low'] as const).map(priority => {
                const group = grouped[priority];
                if (group.length === 0) return null;
                return (
                  <div key={priority} className={styles.group}>
                    <div className={`${styles.groupHeader} ${styles[`priority_${priority}`]}`}>
                      {priority === 'high' ? 'Priorité haute' : priority === 'medium' ? 'Priorité moyenne' : 'Rangement'}
                      <span className={styles.groupCount}>{group.length}</span>
                    </div>
                    {group.map(r => (
                      <label key={r.taskId} className={`${styles.item} ${selected.has(r.taskId) ? styles.itemSelected : ''}`}>
                        <input
                          type="checkbox"
                          checked={selected.has(r.taskId)}
                          onChange={() => toggle(r.taskId)}
                        />
                        <div className={styles.itemBody}>
                          <div className={styles.itemTitle}>{r.taskTitle}</div>
                          <p className={styles.itemReason}>{r.reasoning}</p>
                          <div className={styles.move}>
                            <span className={styles.movePos}>
                              col {r.current.startCol}-{r.current.endCol} · ligne {r.current.row}
                            </span>
                            <span className={styles.moveArrow}>→</span>
                            <span className={`${styles.movePos} ${styles.movePosNew}`}>
                              col {r.recommended.startCol}-{r.recommended.endCol} · ligne {r.recommended.row}
                            </span>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose} disabled={applying}>Annuler</Button>
              <Button variant="primary" onClick={handleApply} disabled={applying || selected.size === 0}>
                {applying ? 'Application…' : `Appliquer la sélection (${selected.size})`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
