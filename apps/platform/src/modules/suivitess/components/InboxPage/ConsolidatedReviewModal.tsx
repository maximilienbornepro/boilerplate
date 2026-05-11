// Modal that surfaces the cross-source consolidation result.
//
// Each card represents one consolidated subject. The user accepts/
// rejects per card or all at once. Apply walks
// applyConsolidatedInbox(logId, accepted) which the backend turns
// into apply-routing calls + flips every contributing inbox row.

import { useState } from 'react';
import { Modal, ModalBody, ModalActions, Button, Badge, Card, LoadingSpinner } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { ConsolidatedSubject } from '../../services/api';
import styles from './ConsolidatedReviewModal.module.css';

export interface ConsolidatedReviewModalProps {
  logId: number | null;
  consolidated: ConsolidatedSubject[];
  rowCount: number;
  /** Notified when validation has completed and the inbox should
   *  refresh. Receives the apply summary so the parent can toast. */
  onDone: (summary: api.ApplyConsolidatedResponse) => void;
  onClose: () => void;
}

/** Stable identity for a consolidated subject inside this modal —
 *  the backend doesn't assign ids, so we derive one from its content. */
function keyForConsolidated(c: ConsolidatedSubject, idx: number): string {
  const merged = c.mergedFrom.map(m => `${m.rowId}:${m.proposalIndex}`).join('|');
  return `${idx}::${merged}`;
}

export function ConsolidatedReviewModal({
  logId,
  consolidated,
  rowCount,
  onDone,
  onClose,
}: ConsolidatedReviewModalProps) {
  // Per-card decision : 'accepted' | 'rejected' | undefined. We default
  // to undefined so "Tout accepter" still has work to do.
  const [decisions, setDecisions] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setOne = (key: string, decision: 'accepted' | 'rejected') => {
    setDecisions(prev => ({ ...prev, [key]: decision }));
  };

  const acceptAndApply = async (acceptedOnly: ConsolidatedSubject[]) => {
    if (acceptedOnly.length === 0) {
      onClose();
      return;
    }
    setApplying(true);
    setErr(null);
    try {
      const summary = await api.applyConsolidatedInbox(logId, acceptedOnly);
      onDone(summary);
    } catch (e) {
      setErr((e as Error).message || 'Erreur lors de l\'application');
      setApplying(false);
    }
  };

  const handleApplyDecisions = async () => {
    const accepted = consolidated.filter((c, i) =>
      decisions[keyForConsolidated(c, i)] === 'accepted',
    );
    await acceptAndApply(accepted);
  };

  const handleAcceptAll = async () => {
    await acceptAndApply(consolidated);
  };

  const sourcesSet = new Set<string>();
  for (const c of consolidated) {
    for (const m of c.mergedFrom) sourcesSet.add(m.rowId);
  }
  // No fusion = every consolidated entry has a single source. Useful
  // info to surface so the user understands why the modal looks
  // identical to the original inbox list.
  const fusionCount = consolidated.filter(c => c.mergedFrom.length >= 2).length;
  const noFusion = fusionCount === 0;

  const acceptedCount = consolidated.filter((c, i) =>
    decisions[keyForConsolidated(c, i)] === 'accepted',
  ).length;

  const title = (
    <span>
      Consolidation IA
      {' · '}
      <span className={styles.titleMuted}>
        {consolidated.length} sujet{consolidated.length > 1 ? 's' : ''} consolidé{consolidated.length > 1 ? 's' : ''}
        {' depuis '}
        {sourcesSet.size} ligne{sourcesSet.size > 1 ? 's' : ''} sur {rowCount}
      </span>
    </span>
  );

  return (
    <Modal title={title} onClose={onClose} size="xl">
      <ModalBody>
        {err && <div className={styles.errorBanner}>{err}</div>}
        {!applying && (
          <div className={styles.materializeBanner}>
            Cliquer <strong>Appliquer</strong> matérialise ces sujets
            dans une nouvelle ligne d'inbox. Tu valideras ensuite chaque
            sujet un par un comme une importation classique. Rien n'est
            encore créé dans tes suivitess.
          </div>
        )}
        {noFusion && !applying && (
          <div className={styles.noFusionBanner}>
            L'IA n'a trouvé aucune redondance entre les sources. Les
            sujets ci-dessous reprennent les propositions originales —
            tu peux quand même les valider en bloc d'ici si tu veux,
            sinon ferme et utilise le flow par ligne.
          </div>
        )}
        {!noFusion && !applying && (
          <div className={styles.fusionBanner}>
            {fusionCount} sujet{fusionCount > 1 ? 's' : ''} fusionné{fusionCount > 1 ? 's' : ''} sur {consolidated.length} —
            les autres sont conservés tels quels.
          </div>
        )}
        {applying ? (
          <LoadingSpinner message="Application des sujets consolidés…" />
        ) : (
          <div className={styles.list}>
            {consolidated.map((c, i) => {
              const key = keyForConsolidated(c, i);
              const decision = decisions[key];
              return (
                <Card key={key} variant="default" className={styles.card}>
                  <div className={styles.cardHead}>
                    <div className={styles.titleBlock}>
                      <h3 className={styles.subjectTitle}>{c.title}</h3>
                      <p className={styles.reasoning}>{c.reasoning}</p>
                    </div>
                    <div className={styles.cardActions}>
                      <Button
                        variant={decision === 'accepted' ? 'primary' : 'secondary'}
                        onClick={() => setOne(key, 'accepted')}
                      >
                        ✓ Accepter
                      </Button>
                      <Button
                        variant={decision === 'rejected' ? 'danger' : 'secondary'}
                        onClick={() => setOne(key, 'rejected')}
                      >
                        ✗ Rejeter
                      </Button>
                    </div>
                  </div>

                  <div className={styles.targetLine}>
                    {c.subjectAction === 'update-existing-subject' ? (
                      <Badge type="info">Enrichit un sujet existant</Badge>
                    ) : (
                      <Badge type="success">Nouveau sujet</Badge>
                    )}
                    {c.suggestedNewReviewTitle && (
                      <Badge type="warning">Nouvelle review : {c.suggestedNewReviewTitle}</Badge>
                    )}
                    {c.suggestedNewSectionName && (
                      <Badge type="warning">Nouvelle section : {c.suggestedNewSectionName}</Badge>
                    )}
                  </div>

                  {c.situation && (
                    <p className={styles.situation}>{c.situation}</p>
                  )}

                  <div className={styles.sources}>
                    <span className={styles.sourcesLabel}>
                      Sources fusionnées ({c.mergedFrom.length}) :
                    </span>
                    {c.mergedFrom.map((m, mi) => {
                      // Tooltip carries the external source id (Fathom
                      // call_id / outlook digest key) so two chips
                      // labelled "Daily TV 06/05" are visually
                      // disambiguated on hover.
                      const tooltipParts: string[] = [];
                      if (m.sourceId) tooltipParts.push(`source #${m.sourceId}`);
                      tooltipParts.push(`prop #${m.proposalIndex}`);
                      tooltipParts.push(`row ${m.rowId.slice(0, 8)}`);
                      return (
                        <Badge type="accent" key={`${key}-src-${mi}`}>
                          <a
                            href={logId != null ? `/ai-logs/${logId}` : '#'}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.sourceLink}
                            title={tooltipParts.join(' · ')}
                            onClick={(e) => { if (logId == null) e.preventDefault(); }}
                          >
                            {m.sourceTitle || m.rowId.slice(0, 8)}
                            <span className={styles.sourceMeta}>
                              {' '}#{m.proposalIndex}
                              {m.sourceId && ` · ${m.sourceId.slice(0, 12)}`}
                            </span>
                          </a>
                        </Badge>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </ModalBody>
      <ModalActions>
        <Button variant="secondary" onClick={onClose} disabled={applying}>Fermer</Button>
        <Button
          variant="secondary"
          onClick={handleApplyDecisions}
          disabled={applying || acceptedCount === 0}
        >
          Appliquer les acceptés ({acceptedCount})
        </Button>
        <Button variant="primary" onClick={handleAcceptAll} disabled={applying}>
          Tout accepter
        </Button>
      </ModalActions>
    </Modal>
  );
}

export default ConsolidatedReviewModal;
