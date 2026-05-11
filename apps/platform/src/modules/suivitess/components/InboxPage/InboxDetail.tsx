// Per-row detail panel : 3 sub-tabs.
//   1. Contenu source — re-fetched raw transcript / mail body / Slack messages
//   2. Décisions IA  — per-subject reasoning + target review/section/subject
//   3. Prompt + sortie — link to /ai-logs/<id>

import { useEffect, useState } from 'react';
import { Modal, Button, LoadingSpinner, Card, Badge, Tabs } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { InboxProposal } from '../../services/api';
import { countInboxProposalStats, formatStatsLine } from './inboxStats';
import styles from './InboxDetail.module.css';

interface FinalProposalShape {
  title?: string;
  reasoning?: string;
  action?: 'new-review' | 'existing-review';
  reviewId?: string | null;
  suggestedNewReviewTitle?: string | null;
  sectionAction?: 'new-section' | 'existing-section';
  sectionId?: string | null;
  suggestedNewSectionName?: string | null;
  subjectAction?: 'new-subject' | 'update-existing-subject';
  targetSubjectId?: string | null;
  rawQuotes?: string[];
}

interface Props {
  row: InboxProposal;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  onValidate: () => void;
}

export function InboxDetail({ row, onClose, onAccept, onReject, onValidate }: Props) {
  const [tab, setTab] = useState<'source' | 'decisions' | 'prompt'>('decisions');
  const [source, setSource] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);

  useEffect(() => {
    if (tab !== 'source' || source !== null) return;
    setLoadingSource(true);
    api.getInboxSourceContent(row.id)
      .then(r => setSource(r.content))
      .catch(() => setSource(''))
      .finally(() => setLoadingSource(false));
  }, [tab, row.id, source]);

  const proposals = (row.proposals ?? []) as FinalProposalShape[];
  const stats = countInboxProposalStats(row.proposals);
  const statsLine = formatStatsLine(stats);

  return (
    <Modal title={row.sourceTitle ?? row.sourceId} onClose={onClose} size="xl">
      <div className={styles.body}>
        <div className={styles.metaRow}>
          <span>{row.documentTitle ?? row.documentId}</span>
          <span>·</span>
          <span>{proposals.length} sujet{proposals.length > 1 ? 's' : ''}</span>
          <span>·</span>
          <span>analysé le {new Date(row.createdAt).toLocaleString('fr-FR')}</span>
          <span className={styles.statusSlot}>
            {row.status === 'pending'  && <Badge type="info">En attente</Badge>}
            {row.status === 'accepted' && <Badge type="success">Accepté</Badge>}
            {row.status === 'rejected' && <Badge type="error">Refusé</Badge>}
          </span>
        </div>
        {statsLine && <div className={styles.statsLine}>{statsLine}</div>}

        <Tabs
          value={tab}
          onChange={(v) => setTab(v as 'source' | 'decisions' | 'prompt')}
          tabs={[
            { value: 'source',    label: 'Contenu source' },
            { value: 'decisions', label: 'Décisions IA' },
            { value: 'prompt',    label: 'Prompt + sortie' },
          ]}
        />

        <div className={styles.tabBody}>
          {tab === 'source' && (
            loadingSource ? (
              <LoadingSpinner message="Récupération du contenu source…" />
            ) : (
              <pre className={styles.sourcePre}>{source || '(contenu indisponible — la source a peut-être été archivée)'}</pre>
            )
          )}

          {tab === 'decisions' && (
            <div className={styles.decisionList}>
              {proposals.length === 0 && (
                <div className={styles.empty}>Aucune décision (l'IA n'a rien extrait).</div>
              )}
              {proposals.map((p, i) => (
                <Card key={i} variant="default" className={styles.decisionCard}>
                  <div className={styles.decisionHead}>
                    <strong>#{i + 1} — {p.title ?? '(sans titre)'}</strong>
                  </div>
                  {p.reasoning && (
                    <p className={styles.reasoning}>
                      <span className={styles.reasoningLabel}>Raison IA :</span> {p.reasoning}
                    </p>
                  )}
                  <div className={styles.target}>
                    <span className={styles.targetLabel}>Cible :</span>
                    <span>
                      {p.action === 'existing-review' ? 'Review existante' : 'Nouvelle review'}
                      {p.suggestedNewReviewTitle && ` « ${p.suggestedNewReviewTitle} »`}
                      {' → '}
                      {p.sectionAction === 'existing-section' ? 'Section existante' : 'Nouvelle section'}
                      {p.suggestedNewSectionName && ` « ${p.suggestedNewSectionName} »`}
                      {' → '}
                      {p.subjectAction === 'new-subject' ? 'Nouveau sujet' : 'Mise à jour'}
                    </span>
                  </div>
                  {p.rawQuotes && p.rawQuotes.length > 0 && (
                    <details className={styles.quotes}>
                      <summary>Citations brutes utilisées ({p.rawQuotes.length})</summary>
                      <ul>
                        {p.rawQuotes.map((q, qi) => <li key={qi}>« {q} »</li>)}
                      </ul>
                    </details>
                  )}
                </Card>
              ))}
            </div>
          )}

          {tab === 'prompt' && (
            <div className={styles.promptTab}>
              {row.aiLogId ? (
                <>
                  <p>
                    Voir le prompt complet et la sortie brute :
                  </p>
                  <a
                    className={styles.aiLogLink}
                    href={`/ai-logs/${row.aiLogId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir /ai-logs/{row.aiLogId} ↗
                  </a>
                </>
              ) : (
                <p>Aucun log AI lié à cette proposition.</p>
              )}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {row.status === 'pending' && (
            <>
              <Button variant="primary" onClick={onValidate}>Ouvrir la modale de validation</Button>
              <Button variant="secondary" onClick={onAccept}>Marquer accepté</Button>
              <Button variant="secondary" onClick={onReject}>Refuser</Button>
            </>
          )}
          {row.status !== 'pending' && (
            <Button variant="secondary" onClick={onClose}>Fermer</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
