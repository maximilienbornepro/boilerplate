import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout, LoadingSpinner, Toast, useGatewayUser } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import styles from './AiRouting.module.css';

// Full-page AI-routing comparison viewer.
//
// Two columns : left = chronological list of imports that have at least
// one persisted routing decision ; right = a three-column comparison
// table for the selected import (AI proposal | user decision | similar
// past RAG decisions).
//
// Admin only — the route is gated both on the nav (Layout) and here.

interface SidebarLog {
  logId: number;
  skillSlug: string;
  sourceKind: string | null;
  sourceTitle: string | null;
  createdAt: string;
  decisionsCount: number;
  overridesCount: number;
}

interface AiProposal {
  proposalIndex: number;
  subjectTitle: string;
  situationExcerpt: string | null;
  reviewAction: 'new-review' | 'existing-review' | null;
  reviewId: string | null;
  reviewTitle: string | null;
  sectionAction: 'new-section' | 'existing-section' | null;
  sectionId: string | null;
  sectionName: string | null;
  subjectAction: 'new-subject' | 'update-existing-subject' | null;
  targetSubjectId: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  reasoning: string | null;
}

interface UserDecision {
  memoryId: string;
  subjectTitle: string;
  targetDocumentId: string;
  targetDocumentTitle: string;
  targetSectionId: string | null;
  targetSectionName: string;
  targetSubjectAction: 'new-subject' | 'update-existing-subject';
  userOverrodeAi: boolean;
  createdAt: string;
}

interface SimilarPastDecision {
  id: string;
  subjectTitle: string;
  targetDocumentTitle: string;
  targetSectionName: string;
  targetSubjectAction: 'new-subject' | 'update-existing-subject';
  similarity: number;
  createdAt: string;
}

interface ComparisonRow {
  proposalIndex: number;
  ai: AiProposal;
  user: UserDecision | null;
  similarPastDecisions: SimilarPastDecision[];
  userOverrodeAi: boolean;
}

interface ComparisonResult {
  logId: number;
  skillSlug: string;
  sourceKind: string | null;
  sourceTitle: string | null;
  createdAt: string;
  totalProposals: number;
  totalCommitted: number;
  totalOverrides: number;
  rows: ComparisonRow[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function renderAction(action: string | null | undefined, label: string): string {
  if (!action) return '—';
  if (action === 'new-review' || action === 'new-section' || action === 'new-subject') return `＋ ${label}`;
  return label;
}

export default function AiRoutingApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useGatewayUser();
  const { logId: routeLogId } = useParams<{ logId?: string }>();

  const [sidebar, setSidebar] = useState<SidebarLog[]>([]);
  const [loadingSidebar, setLoadingSidebar] = useState(true);
  const [detail, setDetail] = useState<ComparisonResult | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [toasts, setToasts] = useState<ToastData[]>([]);
  const addToast = (t: Omit<ToastData, 'id'>) => setToasts(prev => [...prev, { ...t, id: String(Date.now()) + Math.random() }]);
  const dismissToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  const go = useCallback((path: string) => {
    if (onNavigate) onNavigate(path);
    else navigate(path);
  }, [navigate, onNavigate]);

  // ── Load sidebar ──
  useEffect(() => {
    let cancelled = false;
    setLoadingSidebar(true);
    fetch('/ai-skills/api/routing-comparisons', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Chargement impossible')))
      .then((list: SidebarLog[]) => { if (!cancelled) setSidebar(list); })
      .catch(err => { if (!cancelled) addToast({ type: 'error', message: err.message }); })
      .finally(() => { if (!cancelled) setLoadingSidebar(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Load detail on route change ──
  useEffect(() => {
    if (!routeLogId) { setDetail(null); return; }
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError('');
    fetch(`/ai-skills/api/logs/${routeLogId}/routing-comparison`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: ComparisonResult) => { if (!cancelled) setDetail(data); })
      .catch(err => { if (!cancelled) setDetailError(err.message); })
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [routeLogId]);

  // Auto-pick the first sidebar entry once loaded, unless the user
  // landed on a specific /ai-routing/:logId URL.
  useEffect(() => {
    if (routeLogId || sidebar.length === 0) return;
    go(`/ai-routing/${sidebar[0].logId}`);
  }, [routeLogId, sidebar, go]);

  const summaryStats = useMemo(() => {
    if (!detail) return null;
    const pct = detail.totalCommitted > 0
      ? Math.round((detail.totalOverrides / detail.totalCommitted) * 100)
      : 0;
    return { pct };
  }, [detail]);

  if (authLoading) return <Layout appId="ai-routing"><LoadingSpinner fullPage /></Layout>;
  if (!user?.isAdmin) {
    return (
      <Layout appId="ai-routing" onNavigate={onNavigate}>
        <div style={{ padding: 24 }}>
          <h2>Accès refusé</h2>
          <p>Cette page est réservée aux administrateurs.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout appId="ai-routing" variant="full-width" onNavigate={onNavigate}>
      <div className={styles.root}>
        {/* ── Sidebar : list of imports ── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2 className={styles.sidebarTitle}>$ ai-routing</h2>
            <span className={styles.sidebarCount}>{sidebar.length}</span>
          </div>
          {loadingSidebar ? (
            <LoadingSpinner message="Chargement…" />
          ) : sidebar.length === 0 ? (
            <p className={styles.empty}>
              Aucune décision enregistrée.<br />
              Lance un import Suivitess pour alimenter ce tableau.
            </p>
          ) : (
            <ul className={styles.list}>
              {sidebar.map(l => {
                const active = Number(routeLogId) === l.logId;
                const overridePct = l.decisionsCount > 0
                  ? Math.round((l.overridesCount / l.decisionsCount) * 100)
                  : 0;
                return (
                  <li key={l.logId}>
                    <button
                      className={`${styles.listItem} ${active ? styles.listItemActive : ''}`}
                      onClick={() => go(`/ai-routing/${l.logId}`)}
                    >
                      <div className={styles.listItemTop}>
                        <span className={styles.listItemId}>#{l.logId}</span>
                        <span className={styles.listItemSkill}>{l.skillSlug}</span>
                      </div>
                      <div className={styles.listItemTitle}>
                        {l.sourceTitle || <em>(sans titre)</em>}
                      </div>
                      <div className={styles.listItemMeta}>
                        <span>{formatDate(l.createdAt)}</span>
                        <span>{l.decisionsCount} décisions</span>
                        {l.overridesCount > 0 && (
                          <span className={styles.pill}>
                            ⚠ {l.overridesCount} override{l.overridesCount > 1 ? 's' : ''} ({overridePct}%)
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Main : comparison table ── */}
        <main className={styles.main}>
          {loadingDetail ? (
            <div className={styles.padded}><LoadingSpinner message="Calcul du comparatif…" /></div>
          ) : detailError ? (
            <div className={styles.padded}>
              <p className={styles.errorMsg}>{detailError}</p>
            </div>
          ) : !detail ? (
            <div className={styles.padded}>
              <p className={styles.empty}>
                Sélectionne un import dans la colonne de gauche pour voir
                le comparatif IA vs décisions utilisateur.
              </p>
            </div>
          ) : (
            <>
              <header className={styles.detailHeader}>
                <div>
                  <h3 className={styles.detailTitle}>
                    {detail.sourceTitle || <em>(sans titre)</em>}
                  </h3>
                  <div className={styles.detailMeta}>
                    <span>Log #{detail.logId}</span>
                    <span>Skill {detail.skillSlug}</span>
                    <span>{formatDate(detail.createdAt)}</span>
                  </div>
                </div>
                <div className={styles.summaryStats}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{detail.totalProposals}</span>
                    <span className={styles.statLabel}>propositions</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{detail.totalCommitted}</span>
                    <span className={styles.statLabel}>importées</span>
                  </div>
                  <div className={styles.stat} data-flavor={detail.totalOverrides > 0 ? 'warn' : undefined}>
                    <span className={styles.statValue}>{detail.totalOverrides}</span>
                    <span className={styles.statLabel}>
                      overrides{summaryStats ? ` (${summaryStats.pct}%)` : ''}
                    </span>
                  </div>
                </div>
              </header>

              <div className={styles.tableScroll}>
                <table className={styles.compareTable}>
                  <thead>
                    <tr>
                      <th className={styles.colIndex}>#</th>
                      <th className={styles.colAi}>🤖 Proposition IA</th>
                      <th className={styles.colUser}>👤 Ta décision</th>
                      <th className={styles.colRag}>🧠 Décisions passées similaires (RAG)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rows.map(row => (
                      <tr
                        key={row.proposalIndex}
                        className={row.userOverrodeAi ? styles.rowOverridden : undefined}
                      >
                        <td className={styles.colIndex}>{row.proposalIndex + 1}</td>

                        {/* AI proposal */}
                        <td className={styles.colAi}>
                          <div className={styles.subjectTitle}>{row.ai.subjectTitle}</div>
                          {row.ai.situationExcerpt && (
                            <div className={styles.situationExcerpt}>
                              {row.ai.situationExcerpt}
                            </div>
                          )}
                          <dl className={styles.fieldList}>
                            <dt>Review</dt>
                            <dd>{renderAction(row.ai.reviewAction, row.ai.reviewTitle ?? '?')}</dd>
                            <dt>Section</dt>
                            <dd>{renderAction(row.ai.sectionAction, row.ai.sectionName ?? '?')}</dd>
                            <dt>Sujet</dt>
                            <dd>{renderAction(row.ai.subjectAction, row.ai.subjectAction === 'update-existing-subject' ? 'Mise à jour d\'existant' : 'Nouveau sujet')}</dd>
                            {row.ai.confidence && (
                              <>
                                <dt>Confiance</dt>
                                <dd>
                                  <span className={`${styles.confPill} ${styles[`conf_${row.ai.confidence}`]}`}>
                                    {row.ai.confidence}
                                  </span>
                                </dd>
                              </>
                            )}
                          </dl>
                          {row.ai.reasoning && (
                            <details className={styles.reasoning}>
                              <summary>Raisonnement IA</summary>
                              <p>{row.ai.reasoning}</p>
                            </details>
                          )}
                        </td>

                        {/* User decision */}
                        <td className={styles.colUser}>
                          {row.user ? (
                            <>
                              <div className={styles.subjectTitle}>{row.user.subjectTitle}</div>
                              <dl className={styles.fieldList}>
                                <dt>Review</dt>
                                <dd>{row.user.targetDocumentTitle}</dd>
                                <dt>Section</dt>
                                <dd>{row.user.targetSectionName}</dd>
                                <dt>Sujet</dt>
                                <dd>{row.user.targetSubjectAction === 'update-existing-subject' ? 'Mise à jour d\'existant' : '＋ Nouveau sujet'}</dd>
                              </dl>
                              {row.userOverrodeAi && (
                                <div className={styles.overrideBadge}>
                                  ⚠ Tu as modifié la proposition IA
                                </div>
                              )}
                            </>
                          ) : (
                            <span className={styles.skipped}>— Non importé</span>
                          )}
                        </td>

                        {/* RAG similar past decisions */}
                        <td className={styles.colRag}>
                          {row.similarPastDecisions.length === 0 ? (
                            <span className={styles.skipped}>Aucune décision similaire</span>
                          ) : (
                            <ul className={styles.ragList}>
                              {row.similarPastDecisions.map(s => (
                                <li key={s.id}>
                                  <div className={styles.ragHeader}>
                                    <span className={styles.ragSimilarity}>
                                      {Math.round(s.similarity * 100)}%
                                    </span>
                                    <span className={styles.ragTitle}>{s.subjectTitle}</span>
                                  </div>
                                  <div className={styles.ragRouting}>
                                    {s.targetDocumentTitle} › {s.targetSectionName}
                                    {' '}({s.targetSubjectAction === 'update-existing-subject' ? 'maj' : 'nouveau'})
                                  </div>
                                  <div className={styles.ragDate}>
                                    {formatDate(s.createdAt)}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      </div>
      {toasts.map(t => <Toast key={t.id} toast={t} onClose={() => dismissToast(t.id)} />)}
    </Layout>
  );
}
