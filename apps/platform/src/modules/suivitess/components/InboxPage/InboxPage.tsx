// Inbox + history page for the auto-import feature.
//
// 4 tabs : Pending / Accepted / Rejected / All.
// Filters : source kind + document + date range.
//
// Click a row → opens detail panel (3 sub-tabs : source brute /
// décisions IA / prompt + sortie). For pending rows, an extra CTA
// "Ouvrir la modale de validation" reuses BulkTranscriptionImportModal
// in inboxRows mode.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, ModuleHeader, LoadingSpinner, Button, Card, Badge, Tabs, ConfirmModal } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { InboxProposal, InboxStatus, AutoImportSource, AnalyzedSubject, ConsolidatePendingResponse } from '../../services/api';
import { InboxDetail } from './InboxDetail';
import { BulkTranscriptionImportModal } from '../BulkTranscriptionImportModal/BulkTranscriptionImportModal';
import { ConsolidatedReviewModal } from './ConsolidatedReviewModal';
import { ConsolidationProgressModal } from './ConsolidationProgressModal';
import { countInboxProposalStats, formatStatsLine } from './inboxStats';
import { FilterDropdown } from './FilterDropdown';
import styles from './InboxPage.module.css';

// SOURCE_LABELS covers the regular AutoImportSource union plus the
// synthetic 'consolidation' kind we introduce when materializing a
// cross-source consolidation. We don't widen AutoImportSource itself
// (that would propagate everywhere) — instead the lookup falls back
// to `row.sourceKind` when the key is missing so the UI degrades
// gracefully.
const SOURCE_LABELS: Record<string, string> = {
  fathom: 'Fathom', otter: 'Otter', outlook: 'Outlook',
  gmail: 'Gmail', slack: 'Slack',
  consolidation: 'Consolidé',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

interface InboxPageProps {
  onNavigate?: (path: string) => void;
}

export function InboxPage({ onNavigate }: InboxPageProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<InboxStatus>('pending');
  const [rows, setRows] = useState<InboxProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState<'' | AutoImportSource>('');
  const [filterDoc, setFilterDoc] = useState<string>('');
  const [selected, setSelected] = useState<InboxProposal | null>(null);
  // When opening the validation modal, we may pre-strip auto-applied
  // proposals (subject updates require no human review per UX rule),
  // so the modal is fed only the remaining proposals — kept here so we
  // don't lose the original row id while navigating.
  const [openValidate, setOpenValidate] = useState<{ row: InboxProposal; manualProposals: AnalyzedSubject[] } | null>(null);
  // Reject is irreversible-ish (the source becomes invisible to the
  // cron — only "Reconsidérer" from the Refusées tab brings it back),
  // so confirm before flipping status.
  const [confirmReject, setConfirmReject] = useState<InboxProposal | null>(null);
  const [counts, setCounts] = useState({ pending: 0, accepted: 0, rejected: 0, all: 0 });
  // Cross-source consolidation : the modal opens with the AI's
  // dedup'd output. Held in client memory until the user accepts.
  const [consolidating, setConsolidating] = useState(false);
  const [consolidationResult, setConsolidationResult] = useState<ConsolidatePendingResponse | null>(null);
  // Toast surfaced after consolidation. `undoRunId` is set when the
  // apply produced a reversible run — the toast then renders an
  // inline "Annuler" affordance. Auto-clears after 30 s (longer than
  // an info-only toast since the user needs time to decide).
  const [consolidationToast, setConsolidationToast] = useState<
    { message: string; undoRunId?: string } | null
  >(null);

  const load = async () => {
    setLoading(true);
    try {
      const [data, all] = await Promise.all([
        api.listInbox({
          status: tab,
          source: filterSource || undefined,
          document: filterDoc || undefined,
        }),
        api.listInbox({ status: 'all' }),
      ]);
      setRows(data);
      setCounts({
        pending: all.filter(r => r.status === 'pending').length,
        accepted: all.filter(r => r.status === 'accepted').length,
        rejected: all.filter(r => r.status === 'rejected').length,
        all: all.length,
      });
    } catch {
      // empty state ok
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [tab, filterSource, filterDoc]);

  // Distinct documents for the filter dropdown (derived from rows).
  const documentOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.documentTitle) map.set(r.documentId, r.documentTitle);
    }
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [rows]);

  const handleAccept = async (row: InboxProposal) => {
    await api.acceptInboxProposal(row.id);
    void load();
  };
  const handleReject = async (row: InboxProposal) => {
    await api.rejectInboxProposal(row.id);
    void load();
  };
  const handleReconsider = async (row: InboxProposal) => {
    await api.reconsiderInboxProposal(row.id);
    void load();
  };

  /** "Valider" handler.
   *
   *  UX rule (explicit user request) : updates of existing subjects
   *  must be auto-applied without any user validation step. The user
   *  only validates **new subjects** and **new sections / reviews**.
   *
   *  So before opening the modal :
   *    1. Filter out every proposal whose `subjectAction === 'update-existing-subject'`
   *       AND that targets a real subject (`targetSubjectId` set).
   *    2. Apply those silently via the existing `apply-routing` endpoint.
   *    3. If nothing remains, accept the inbox row directly — no modal.
   *    4. Else, open the modal with only the remaining (manual) proposals.
   */
  const handleValidate = async (row: InboxProposal) => {
    const proposals = (row.proposals ?? []) as AnalyzedSubject[];
    const auto = proposals.filter(
      p => p.subjectAction === 'update-existing-subject' && !!p.targetSubjectId,
    );
    const manual = proposals.filter(
      p => !(p.subjectAction === 'update-existing-subject' && !!p.targetSubjectId),
    );

    if (auto.length > 0) {
      const payloads: api.ApplyRoutingSubject[] = auto.map(p => ({
        title: p.title,
        situation: p.situation,
        status: p.status,
        responsibility: p.responsibility,
        targetReviewId: p.reviewId,
        targetSectionId: p.sectionId,
        subjectAction: 'update-existing-subject',
        targetSubjectId: p.targetSubjectId,
        updatedSituation: p.updatedSituation,
        updatedStatus: p.updatedStatus,
        updatedResponsibility: p.updatedResponsibility,
        rawQuotes: p.sourceRawQuotes,
        entities: p.sourceEntities,
        participants: p.sourceParticipants,
        aiProposedReviewId: p.aiProposedReviewId,
        aiProposedReviewTitle: p.aiProposedReviewTitle,
      }));
      try {
        await api.applyRouting(row.sourceId, payloads, row.aiLogId, [row.sourceId]);
      } catch (err) {
        // Don't block manual validation if the silent apply fails — the
        // user can re-trigger via Reconsider on the row, or fix the
        // updates by hand. Surface the issue in console for now.
        // eslint-disable-next-line no-console
        console.error('[inbox] auto-apply of subject updates failed', err);
      }
    }

    if (manual.length === 0) {
      // Pure-update row : nothing left to validate.
      await handleAccept(row);
      return;
    }
    setOpenValidate({ row, manualProposals: manual });
  };

  // Number of pending rows matching the ACTIVE filters — gates the
  // visibility of the "Consolider" CTA. We count the currently-loaded
  // `rows` rather than querying again because the page already filters
  // by source/document at fetch time when `tab === 'pending'`.
  const visiblePendingCount = useMemo(
    () => (tab === 'pending' ? rows.length : rows.filter(r => r.status === 'pending').length),
    [rows, tab],
  );
  // Total proposal count across all currently-visible pending rows —
  // used to populate the loading modal subtitle so the user sees
  // exactly what's being consolidated.
  const visiblePendingProps = useMemo(() => {
    const pendingRows = tab === 'pending' ? rows : rows.filter(r => r.status === 'pending');
    return pendingRows.reduce((acc, r) => acc + (Array.isArray(r.proposals) ? r.proposals.length : 0), 0);
  }, [rows, tab]);

  const handleConsolidate = async () => {
    setConsolidating(true);
    setConsolidationToast(null);
    try {
      const r = await api.consolidatePendingInbox({
        sourceKind: filterSource || undefined,
        documentId: filterDoc || undefined,
      });
      // Always open the modal when the AI returned something. Even
      // when no fusion happened (every entry is a solo), the user
      // wants to SEE the AI's output — the modal renders a banner
      // for that case so expectations are set. Empty array stays a
      // discreet toast since there's literally nothing to show.
      if (r.consolidated.length === 0) {
        setConsolidationToast({
          message: r.truncated
            ? `La sortie de l'IA a été tronquée (trop de propositions pour un seul appel). Réessaie en filtrant par source ou par document pour réduire le scope.`
            : r.rowCount === 0
              ? 'Aucune ligne à consolider (filtres trop stricts ?)'
              : 'L\'IA n\'a renvoyé aucun sujet — voir les /ai-logs pour le détail',
        });
        setTimeout(() => setConsolidationToast(null), r.truncated ? 10000 : 6000);
        return;
      }
      setConsolidationResult(r);
    } catch (err) {
      setConsolidationToast({ message: `Erreur : ${(err as Error).message}` });
      setTimeout(() => setConsolidationToast(null), 6000);
    } finally {
      setConsolidating(false);
    }
  };

  return (
    <Layout appId="suivitess" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader
        title="Boîte de réception"
        subtitle={`${counts.pending} proposition${counts.pending > 1 ? 's' : ''} en attente`}
        onBack={() => navigate('/suivitess')}
      />

      <div className={styles.page}>
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as InboxStatus)}
          tabs={[
            { value: 'pending',  label: `En attente · ${counts.pending}` },
            { value: 'accepted', label: `Acceptées · ${counts.accepted}` },
            { value: 'rejected', label: `Refusées · ${counts.rejected}` },
            { value: 'all',      label: `Tout · ${counts.all}` },
          ]}
        />

        <div className={styles.filters}>
          <FilterDropdown<'' | AutoImportSource>
            value={filterSource}
            onChange={setFilterSource}
            ariaLabel="Filtrer par source"
            options={[
              { value: '',        label: 'Toutes les sources' },
              { value: 'fathom',  label: 'Fathom'  },
              { value: 'otter',   label: 'Otter'   },
              { value: 'outlook', label: 'Outlook' },
              { value: 'gmail',   label: 'Gmail'   },
              { value: 'slack',   label: 'Slack'   },
            ]}
          />
          <FilterDropdown<string>
            value={filterDoc}
            onChange={setFilterDoc}
            ariaLabel="Filtrer par document"
            options={[
              { value: '', label: 'Tous les documents' },
              ...documentOptions.map(d => ({ value: d.id, label: d.title })),
            ]}
          />
          <Button variant="secondary" onClick={() => void load()} aria-label="Rafraîchir">
            <span className={styles.refreshIcon} aria-hidden>↻</span>
          </Button>
          {visiblePendingCount >= 2 && (
            <Button
              variant="primary"
              onClick={() => void handleConsolidate()}
              disabled={consolidating}
            >
              Consolider {visiblePendingProps} propositions · {visiblePendingCount} sources
            </Button>
          )}
          {consolidationToast && (
            <span className={styles.consolidationToast}>
              {consolidationToast.message}
              {consolidationToast.undoRunId && (
                <>
                  {' '}
                  <Button
                    variant="secondary"
                    className={styles.undoButton}
                    onClick={async () => {
                      const runId = consolidationToast.undoRunId;
                      if (!runId) return;
                      try {
                        await api.revertConsolidationRun(runId);
                        await load();
                        setConsolidationToast({ message: 'Consolidation annulée' });
                        setTimeout(() => setConsolidationToast(null), 4000);
                      } catch (e) {
                        setConsolidationToast({ message: `Erreur : ${(e as Error).message}` });
                        setTimeout(() => setConsolidationToast(null), 6000);
                      }
                    }}
                  >
                    Annuler
                  </Button>
                </>
              )}
            </span>
          )}
        </div>

        {loading ? (
          <LoadingSpinner message="Chargement…" />
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            <p>Aucune proposition à afficher.</p>
            <p className={styles.emptyHint}>
              Active l'import automatique depuis <strong>Actions → Import auto → Réglages</strong>
              pour qu'il commence à analyser tes sources toutes les heures.
            </p>
          </div>
        ) : (
          <div className={styles.list}>
            {rows.map(row => {
              const stats = countInboxProposalStats(row.proposals);
              const line = formatStatsLine(stats);
              const statusBadge =
                row.status === 'pending' ? <Badge type="info">En attente</Badge> :
                row.status === 'accepted' ? <Badge type="success">Accepté</Badge> :
                <Badge type="error">Refusé</Badge>;
              return (
                <Card
                  key={row.id}
                  variant="interactive"
                  className={styles.item}
                  onClick={() => setSelected(row)}
                >
                  <div className={styles.itemBody}>
                    <div className={styles.itemHead}>
                      {statusBadge}
                      <Badge type="accent">{SOURCE_LABELS[row.sourceKind] ?? row.sourceKind}</Badge>
                      <span className={styles.itemTitle}>{row.sourceTitle ?? row.sourceId}</span>
                      {/* Source id (e.g. Fathom call_id) — disambiguates
                          rows that share a generic title like "Impromptu
                          Microsoft Teams Meeting". Always shown when the
                          title is present so the user can copy/grep it. */}
                      {row.sourceTitle && row.sourceTitle !== row.sourceId && (
                        <span className={styles.itemSourceId} title={row.sourceId}>
                          #{row.sourceId}
                        </span>
                      )}
                    </div>
                    <div className={styles.itemMeta}>
                      Doc : <strong>{row.documentTitle ?? row.documentId}</strong> · {row.proposals.length} proposition{row.proposals.length > 1 ? 's' : ''}
                      {row.sourceDate && (
                        <>
                          {' · '}<strong>{formatDate(row.sourceDate)}</strong>
                        </>
                      )}
                      {' · '}analysé le {formatDate(row.createdAt)}
                      {row.reviewedAt && ` · revu le ${formatDate(row.reviewedAt)}`}
                    </div>
                    {line && <div className={styles.itemStats}>{line}</div>}
                  </div>
                  <div className={styles.itemActions} onClick={(e) => e.stopPropagation()}>
                    {row.status === 'pending' && (
                      <>
                        <Button variant="primary" onClick={() => void handleValidate(row)}>Valider</Button>
                        <Button variant="secondary" onClick={() => setConfirmReject(row)}>Refuser</Button>
                      </>
                    )}
                    {row.status === 'rejected' && (
                      <Button variant="secondary" onClick={() => handleReconsider(row)}>Reconsidérer</Button>
                    )}
                    {row.status === 'accepted' && (
                      <Button variant="secondary" onClick={() => navigate(`/suivitess/${row.documentId}`)}>
                        Voir le doc
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => setSelected(row)}>Détail</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <InboxDetail
          row={selected}
          onClose={() => setSelected(null)}
          onAccept={async () => { await handleAccept(selected); setSelected(null); }}
          onReject={() => { const r = selected; setSelected(null); setConfirmReject(r); }}
          onValidate={() => { const r = selected; setSelected(null); void handleValidate(r); }}
        />
      )}

      {openValidate && (
        <BulkTranscriptionImportModal
          inboxProposalId={openValidate.row.id}
          inboxProposals={openValidate.manualProposals as never}
          inboxDocumentId={openValidate.row.documentId}
          onClose={() => {
            // INBOX SEMANTICS — closing the modal WITHOUT going through
            // the full validation flow must leave the row in pending,
            // so the user can re-open it later and finish the work
            // they started. Only `onDone` (the explicit "tout est créé"
            // signal from the modal) flips the row to accepted.
            // We still `load()` to pick up any partial inline-adds
            // that already happened during the session.
            setOpenValidate(null);
            void load();
          }}
          onDone={async () => {
            // Full validation flow completed (every requested element
            // was created) → flip the row to accepted so it leaves
            // pending. This is the only path that does so.
            const id = openValidate.row.id;
            try { await api.acceptInboxProposal(id); }
            catch { /* swallow */ }
            setOpenValidate(null);
            void load();
          }}
        />
      )}

      {consolidating && !consolidationResult && (
        <ConsolidationProgressModal
          subtitle={`${visiblePendingProps} propositions · ${visiblePendingCount} sources`}
        />
      )}

      {consolidationResult && (
        <ConsolidatedReviewModal
          logId={consolidationResult.logId}
          consolidated={consolidationResult.consolidated}
          rowCount={consolidationResult.rowCount}
          onClose={() => setConsolidationResult(null)}
          onDone={(summary) => {
            setConsolidationResult(null);
            // New model : apply just materializes a consolidated inbox
            // row. The user validates each subject one-by-one from
            // that new row through the regular Valider flow. Reload
            // so the new "Consolidé" row appears at the top of the
            // inbox (it has the freshest source_date).
            const msg = summary.newInboxRowId
              ? `${summary.proposalsCount} sujet${summary.proposalsCount > 1 ? 's' : ''} dans la nouvelle ligne · ${summary.rowsAccepted} ligne${summary.rowsAccepted > 1 ? 's' : ''} consolidée${summary.rowsAccepted > 1 ? 's' : ''}`
              : 'Aucun sujet à matérialiser';
            // Surface the run id when present so the toast can render
            // an inline "Annuler". 30 s dwell time — longer than the
            // info-only flavour, undo needs time to land.
            setConsolidationToast({
              message: msg,
              undoRunId: summary.runId ?? undefined,
            });
            setTimeout(() => setConsolidationToast(null), 30000);
            void load();
          }}
        />
      )}

      {confirmReject && (
        <ConfirmModal
          title="Refuser cette proposition ?"
          message={
            `« ${confirmReject.sourceTitle ?? confirmReject.sourceId} » ne sera plus ré-analysée par l'import automatique. `
            + `Tu pourras toujours la réactiver depuis l'onglet « Refusées » via « Reconsidérer ».`
          }
          confirmLabel="Refuser"
          cancelLabel="Annuler"
          danger
          onCancel={() => setConfirmReject(null)}
          onConfirm={async () => {
            const r = confirmReject;
            setConfirmReject(null);
            await handleReject(r);
          }}
        />
      )}
    </Layout>
  );
}
