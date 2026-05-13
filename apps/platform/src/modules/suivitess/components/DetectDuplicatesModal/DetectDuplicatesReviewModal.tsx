// Modal that surfaces the result of the cross-document duplicate
// detection. One card per group :
//   - confidence badge + reasoning
//   - N (2..5) subjects side-by-side with a "Parent" radio
//   - per-card "✓ Lier ces N sujets" / "✗ Ignorer" buttons
//   - footer : "Appliquer les acceptés (K)" / "Tout lier avec parent par
//     défaut" / "Fermer"
//
// When the user accepts (per-card or footer), the modal calls
// api.applyCrossDocDuplicates with the chosen parent + duplicates list.

import { useMemo, useState } from 'react';
import { Modal, ModalBody, ModalActions, Button, Badge, Card, LoadingSpinner, StatusTag } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { DetectDuplicatesResponse, DuplicateGroupApi, DuplicateSubjectApi } from '../../services/api';
import { getStatusOption } from '../../types';
import styles from './DetectDuplicatesReviewModal.module.css';

export interface DetectDuplicatesReviewModalProps {
  result: DetectDuplicatesResponse;
  /** Notified when the apply has completed. Receives the summary so the
   *  parent can toast with an "Annuler" affordance. */
  onDone: (summary: api.ApplyDuplicatesResponse) => void;
  onClose: () => void;
}

/** Pick the default parent : the subject with the most recent
 *  `updatedAt`. Pure function, easy to test. Falls back to the first
 *  subjectId when timestamps are missing. */
export function defaultParentFor(
  group: DuplicateGroupApi,
  subjects: Record<string, DuplicateSubjectApi>,
): string {
  let best: { id: string; ts: string } | null = null;
  for (const id of group.subjectIds) {
    const s = subjects[id];
    if (!s) continue;
    const ts = s.updatedAt || '';
    if (!best || ts > best.ts) best = { id, ts };
  }
  return best?.id ?? group.subjectIds[0];
}

/** Stable identity for a group inside the modal — derived from its
 *  ordered subjectIds. */
export function keyForGroup(g: DuplicateGroupApi): string {
  return g.subjectIds.join('|');
}

export function DetectDuplicatesReviewModal({
  result,
  onDone,
  onClose,
}: DetectDuplicatesReviewModalProps) {
  // Per-group parent selection. Defaults to the most-recent updatedAt.
  const [parents, setParents] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const g of result.groups) {
      out[keyForGroup(g)] = defaultParentFor(g, result.subjects);
    }
    return out;
  });
  // Per-group decision : 'accepted' | 'rejected' | undefined.
  const [decisions, setDecisions] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setParent = (groupKey: string, subjectId: string) => {
    setParents(prev => ({ ...prev, [groupKey]: subjectId }));
  };
  const setDecision = (groupKey: string, d: 'accepted' | 'rejected') => {
    setDecisions(prev => ({ ...prev, [groupKey]: d }));
  };

  const acceptedCount = useMemo(
    () => result.groups.filter(g => decisions[keyForGroup(g)] === 'accepted').length,
    [result.groups, decisions],
  );

  const apply = async (groupsToApply: DuplicateGroupApi[]) => {
    if (groupsToApply.length === 0) {
      onClose();
      return;
    }
    setApplying(true);
    setErr(null);
    try {
      const payload = groupsToApply.map(g => {
        const parentId = parents[keyForGroup(g)] ?? defaultParentFor(g, result.subjects);
        return {
          parentId,
          duplicateIds: g.subjectIds.filter(id => id !== parentId),
        };
      });
      const summary = await api.applyCrossDocDuplicates(result.logId, payload);
      onDone(summary);
    } catch (e) {
      setErr((e as Error).message || 'Erreur lors de l\'application');
      setApplying(false);
    }
  };

  const handleApplyAccepted = async () => {
    const accepted = result.groups.filter(g => decisions[keyForGroup(g)] === 'accepted');
    await apply(accepted);
  };

  const handleLinkAllDefaults = async () => {
    await apply(result.groups);
  };

  // Empty-state — the request succeeded but the AI found nothing.
  const empty = result.groups.length === 0;

  return (
    <Modal
      onClose={applying ? () => { /* swallow */ } : onClose}
      title={
        <span>
          Doublons détectés
          {!empty && (
            <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontWeight: 400 }}>
              · {result.groups.length} groupe{result.groups.length > 1 ? 's' : ''} sur {result.subjectCount} sujets
            </span>
          )}
        </span>
      }
      size="xl"
    >
      <ModalBody>
        {applying && <LoadingSpinner message="Création des liens cross-documents…" />}
        {!applying && (
          <>
            <p className={styles.banner}>
              {empty
                ? "L'IA n'a trouvé aucun groupe de doublons. Tu peux fermer."
                : `${result.groups.length} groupe${result.groups.length > 1 ? 's' : ''} de doublons détecté${result.groups.length > 1 ? 's' : ''}. Pour chacun, choisis le sujet parent (sera la version canonique) puis lie.`}
            </p>

            {err && <div className={styles.error}>{err}</div>}

            <div className={styles.groups}>
              {result.groups.map(group => {
                const groupKey = keyForGroup(group);
                const decision = decisions[groupKey];
                const parentId = parents[groupKey] ?? defaultParentFor(group, result.subjects);
                // Soft cap : render up to 5 inline ; surface the rest as a chip.
                const visibleIds = group.subjectIds.slice(0, 5);
                const overflowCount = Math.max(0, group.subjectIds.length - visibleIds.length);
                const N = group.subjectIds.length;
                return (
                  <Card key={groupKey} className={`${styles.groupCard} ${decision ? styles[decision] : ''}`}>
                    <div className={styles.groupHeader}>
                      <Badge type={group.confidence === 'high' ? 'success' : 'info'}>
                        {group.confidence === 'high' ? 'Confiance forte' : 'Confiance moyenne'}
                      </Badge>
                      <span className={styles.reasoning}>{group.reasoning}</span>
                    </div>

                    {/* Intra-doc duplicates surfaced by the AI but
                        dropped from the link operation : the cross-doc
                        link doesn't help when both copies live in the
                        same review. Surface them here so the user can
                        clean them up manually. */}
                    {group.droppedSameDoc && group.droppedSameDoc.length > 0 && (
                      <div className={styles.intraDocWarning}>
                        <strong>⚠ Doublons intra-doc à supprimer manuellement :</strong>
                        <ul className={styles.intraDocList}>
                          {group.droppedSameDoc.map(d => {
                            const docTitle =
                              result.subjects[d.subjectIds[0]]?.documentTitle ?? d.documentId;
                            const titles = d.subjectIds
                              .map(id => result.subjects[id]?.title)
                              .filter(Boolean) as string[];
                            return (
                              <li key={d.documentId}>
                                <strong>{docTitle}</strong> · {d.subjectIds.length} autre{d.subjectIds.length > 1 ? 's' : ''} sujet{d.subjectIds.length > 1 ? 's' : ''} identique{d.subjectIds.length > 1 ? 's' : ''}
                                {titles.length > 0 && (
                                  <span className={styles.intraDocTitles}> ({titles.join(', ').slice(0, 80)})</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    <div className={styles.subjectsRow}>
                      {visibleIds.map(sid => {
                        const s = result.subjects[sid];
                        if (!s) return null;
                        const isParent = parentId === sid;
                        return (
                          <label
                            key={sid}
                            className={`${styles.subjectCard} ${isParent ? styles.subjectParent : ''}`}
                          >
                            <div className={styles.subjectHeader}>
                              <input
                                type="radio"
                                name={`parent-${groupKey}`}
                                checked={isParent}
                                onChange={() => setParent(groupKey, sid)}
                                disabled={decision === 'rejected'}
                              />
                              <span className={styles.parentLabel}>Parent</span>
                              <span className={styles.subjectStatus}>
                                <StatusTag label={getStatusOption(s.status).label} color={getStatusOption(s.status).color} />
                              </span>
                            </div>
                            <div className={styles.subjectTitle}>{s.title}</div>
                            <div className={styles.subjectBreadcrumb}>
                              {s.documentTitle} <span aria-hidden="true">›</span> {s.sectionName}
                            </div>
                            {s.situationExcerpt && (
                              <div className={styles.subjectExcerpt}>{s.situationExcerpt}</div>
                            )}
                            <a
                              href={`/suivitess/${s.documentId}#${s.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.subjectLink}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Voir le sujet
                            </a>
                          </label>
                        );
                      })}
                      {overflowCount > 0 && (
                        <div className={styles.overflowChip}>+{overflowCount} autres</div>
                      )}
                    </div>

                    <div className={styles.groupActions}>
                      <Button
                        variant="primary"
onClick={() => setDecision(groupKey, 'accepted')}
                        disabled={decision === 'accepted'}
                      >
                        ✓ Lier ces {N} sujets
                      </Button>
                      <Button
                        variant="secondary"
onClick={() => setDecision(groupKey, 'rejected')}
                        disabled={decision === 'rejected'}
                      >
                        ✗ Ignorer
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </ModalBody>

      {!applying && (
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          {!empty && (
            <>
              <Button variant="secondary" onClick={handleLinkAllDefaults}>
                Tout lier avec parent par défaut
              </Button>
              <Button
                variant="primary"
                onClick={handleApplyAccepted}
                disabled={acceptedCount === 0}
              >
                Appliquer les acceptés ({acceptedCount})
              </Button>
            </>
          )}
        </ModalActions>
      )}
    </Modal>
  );
}

export default DetectDuplicatesReviewModal;
