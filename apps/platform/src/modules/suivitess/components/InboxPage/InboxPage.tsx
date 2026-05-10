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
import { Layout, ModuleHeader, LoadingSpinner, Button, Card, Badge, Tabs } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { InboxProposal, InboxStatus, AutoImportSource } from '../../services/api';
import { InboxDetail } from './InboxDetail';
import { BulkTranscriptionImportModal } from '../BulkTranscriptionImportModal/BulkTranscriptionImportModal';
import { countInboxProposalStats, formatStatsLine } from './inboxStats';
import styles from './InboxPage.module.css';

const SOURCE_LABELS: Record<AutoImportSource, string> = {
  fathom: '📞 Fathom', otter: '🦦 Otter', outlook: '📨 Outlook',
  gmail: '📧 Gmail', slack: '💬 Slack',
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
  const [openValidate, setOpenValidate] = useState<InboxProposal | null>(null);
  const [counts, setCounts] = useState({ pending: 0, accepted: 0, rejected: 0, all: 0 });

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
          <select value={filterSource} onChange={e => setFilterSource(e.target.value as AutoImportSource | '')}>
            <option value="">Toutes les sources</option>
            <option value="fathom">📞 Fathom</option>
            <option value="otter">🦦 Otter</option>
            <option value="outlook">📨 Outlook</option>
            <option value="gmail">📧 Gmail</option>
            <option value="slack">💬 Slack</option>
          </select>
          <select value={filterDoc} onChange={e => setFilterDoc(e.target.value)}>
            <option value="">Tous les documents</option>
            {documentOptions.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <Button variant="secondary" onClick={() => void load()}>↻</Button>
        </div>

        {loading ? (
          <LoadingSpinner message="Chargement…" />
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            <p>Aucune proposition à afficher.</p>
            <p className={styles.emptyHint}>
              Active l'import automatique depuis le menu <strong>Actions → Import auto → Réglages</strong>
              pour qu'il commence à analyser tes sources toutes les heures.
            </p>
          </div>
        ) : (
          <div className={styles.list}>
            {rows.map(row => {
              const stats = countInboxProposalStats(row.proposals);
              const line = formatStatsLine(stats);
              const statusBadge =
                row.status === 'pending' ? <Badge type="info">⏳ En attente</Badge> :
                row.status === 'accepted' ? <Badge type="success">✓ Accepté</Badge> :
                <Badge type="error">✗ Refusé</Badge>;
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
                      <Badge type="accent">{SOURCE_LABELS[row.sourceKind]}</Badge>
                      <span className={styles.itemTitle}>{row.sourceTitle ?? row.sourceId}</span>
                    </div>
                    <div className={styles.itemMeta}>
                      Doc : <strong>{row.documentTitle ?? row.documentId}</strong> · {row.proposals.length} proposition{row.proposals.length > 1 ? 's' : ''}
                      {' · '}analysé le {formatDate(row.createdAt)}
                      {row.reviewedAt && ` · revu le ${formatDate(row.reviewedAt)}`}
                    </div>
                    {line && <div className={styles.itemStats}>{line}</div>}
                  </div>
                  <div className={styles.itemActions} onClick={(e) => e.stopPropagation()}>
                    {row.status === 'pending' && (
                      <>
                        <Button variant="primary" onClick={() => setOpenValidate(row)}>Valider</Button>
                        <Button variant="secondary" onClick={() => handleReject(row)}>Refuser</Button>
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
          onReject={async () => { await handleReject(selected); setSelected(null); }}
          onValidate={() => { setOpenValidate(selected); setSelected(null); }}
        />
      )}

      {openValidate && (
        <BulkTranscriptionImportModal
          inboxProposalId={openValidate.id}
          inboxProposals={openValidate.proposals as never}
          inboxDocumentId={openValidate.documentId}
          onClose={async () => {
            // INBOX SEMANTICS — closing the modal counts as "I have
            // reviewed this row, get it out of pending". This handles
            // the per-row immediate-add path (where the user adds
            // each subject one-by-one then closes) and the bulk
            // Importer path. We always flip to accepted ; the user
            // can still hit "Reconsidérer" from the rejected/accepted
            // tab if they got it wrong.
            try { await api.acceptInboxProposal(openValidate.id); }
            catch { /* swallow — the user can re-validate via the UI */ }
            setOpenValidate(null);
            void load();
          }}
          onDone={async () => {
            // Bulk Importer path : same final state.
            try { await api.acceptInboxProposal(openValidate.id); }
            catch { /* swallow */ }
            setOpenValidate(null);
            void load();
          }}
        />
      )}
    </Layout>
  );
}
