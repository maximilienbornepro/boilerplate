import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout, Button, LoadingSpinner, Toast, useGatewayUser } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { AssistantFlow } from '../ai-improve-assistant/App';
import styles from './AiEvals.module.css';

// Admin-only full-page eval viewer. Three core widgets :
//   - Dataset sidebar (list of datasets + "new dataset" button)
//   - Items table (input preview, expected, source_log link)
//   - Experiments table (per-row : per-score avg + cost/latency, with delta
//     vs baseline experiment when available).

interface SkillMeta {
  slug: string;
  name: string;
  description: string;
}

interface Dataset {
  id: number;
  name: string;
  skill_slug: string;
  description: string | null;
  created_at: string;
  item_count?: number;
}

interface DatasetItem {
  id: number;
  dataset_id: number;
  source_log_id: number | null;
  input_content: string;
  expected_output: unknown;
  expected_notes: string | null;
  position: number;
}

interface Experiment {
  id: number;
  dataset_id: number;
  name: string;
  skill_version_hash: string;
  model: string | null;
  status: 'pending' | 'running' | 'done' | 'error';
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  created_at: string;
  /** Runs already completed (rows in ai_eval_experiment_runs). */
  runs_done?: number;
  /** Total items in the dataset at this moment. */
  item_count?: number;
}

interface ExperimentReport {
  experiment: Experiment;
  items: Array<{
    item_id: number;
    input_preview: string;
    log_id: number;
    output_preview: string;
    duration_ms: number | null;
    cost_usd: number | null;
    error: string | null;
    scores: Array<{ name: string; kind: string; value: number; rationale: string | null }>;
  }>;
  baseline: Experiment | null;
  baselineItems?: ExperimentReport['items'];
  summary: {
    avgByScore: Record<string, { avg: number; count: number }>;
    totalCostUsd: number;
    totalDurationMs: number;
    itemCount: number;
  };
}

interface DatasetDetail {
  dataset: Dataset;
  items: DatasetItem[];
  experiments: Experiment[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatCost(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return '—';
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export default function AiEvalsApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useGatewayUser();
  const { datasetId: routeDatasetId } = useParams<{ datasetId?: string }>();

  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const [selectedExpId, setSelectedExpId] = useState<number | null>(null);
  const [expReport, setExpReport] = useState<ExperimentReport | null>(null);
  const [loadingExp, setLoadingExp] = useState(false);

  const [creatingDataset, setCreatingDataset] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState('');
  const [newDatasetSkill, setNewDatasetSkill] = useState('');
  const [newDatasetDesc, setNewDatasetDesc] = useState('');

  const [toasts, setToasts] = useState<ToastData[]>([]);
  const addToast = useCallback((t: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...t, id: String(Date.now()) + Math.random() }]);
  }, []);
  const dismissToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  const go = useCallback((path: string) => {
    if (onNavigate) onNavigate(path);
    else navigate(path);
  }, [navigate, onNavigate]);

  // Load datasets + skills list.
  const loadDatasets = useCallback(async () => {
    setLoadingList(true);
    try {
      const [dsRes, skRes] = await Promise.all([
        fetch('/ai-skills/api/datasets', { credentials: 'include' }),
        fetch('/ai-skills/api', { credentials: 'include' }),
      ]);
      if (dsRes.ok) setDatasets(await dsRes.json());
      if (skRes.ok) setSkills(await skRes.json());
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally { setLoadingList(false); }
  }, [addToast]);

  useEffect(() => { loadDatasets(); }, [loadDatasets]);

  // Reusable detail loader (used on route change AND after the assistant
  // closes — so items added via /ai-improve-assistant show up immediately).
  const reloadDetail = useCallback(async () => {
    if (!routeDatasetId) { setDetail(null); return; }
    setLoadingDetail(true);
    try {
      const r = await fetch(`/ai-skills/api/datasets/${routeDatasetId}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: DatasetDetail = await r.json();
      setDetail(d);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setLoadingDetail(false);
    }
  }, [routeDatasetId, addToast]);

  // Load detail when route id changes.
  useEffect(() => {
    setExpReport(null);
    setSelectedExpId(null);
    reloadDetail();
  }, [reloadDetail]);

  // Auto-refresh experiment detail while running.
  useEffect(() => {
    if (!selectedExpId) return;
    let cancelled = false;
    const tick = async () => {
      const r = await fetch(`/ai-skills/api/experiments/${selectedExpId}`, { credentials: 'include' });
      if (!r.ok) return;
      const report: ExperimentReport = await r.json();
      if (cancelled) return;
      setExpReport(report);
      if (report.experiment.status === 'running' || report.experiment.status === 'pending') {
        setTimeout(tick, 2000);
      }
    };
    setLoadingExp(true);
    tick().finally(() => { if (!cancelled) setLoadingExp(false); });
    return () => { cancelled = true; };
  }, [selectedExpId]);

  // Auto-refresh the dataset detail (table of experiments) while at least one
  // experiment is running/pending — so progress cells stay live without the
  // user clicking "Détails" on each row.
  useEffect(() => {
    if (!detail) return;
    const anyActive = detail.experiments.some(e => e.status === 'running' || e.status === 'pending');
    if (!anyActive) return;
    let cancelled = false;
    const datasetId = detail.dataset.id;
    const tick = async () => {
      const r = await fetch(`/ai-skills/api/datasets/${datasetId}`, { credentials: 'include' });
      if (!r.ok) return;
      const d: DatasetDetail = await r.json();
      if (cancelled) return;
      setDetail(d);
      const stillActive = d.experiments.some(e => e.status === 'running' || e.status === 'pending');
      if (stillActive) setTimeout(tick, 2000);
    };
    const handle = setTimeout(tick, 2000);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [detail]);

  // ── Guards ──
  if (authLoading) {
    return (
      <Layout appId="ai-evals" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem' }}><LoadingSpinner message="Chargement..." /></div>
      </Layout>
    );
  }
  if (!user?.isAdmin) {
    return (
      <Layout appId="ai-evals" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>403</h1>
          <p>Cette page est réservée aux administrateurs.</p>
          <Button variant="secondary" onClick={() => go('/')}>Retour</Button>
        </div>
      </Layout>
    );
  }

  const createDataset = async () => {
    if (!newDatasetName.trim() || !newDatasetSkill) return;
    try {
      const res = await fetch('/ai-skills/api/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newDatasetName,
          skillSlug: newDatasetSkill,
          description: newDatasetDesc || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const ds: Dataset = await res.json();
      setCreatingDataset(false);
      setNewDatasetName(''); setNewDatasetSkill(''); setNewDatasetDesc('');
      await loadDatasets();
      go(`/ai-evals/${ds.id}`);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    }
  };

  const launchExperiment = async () => {
    if (!detail) return;
    try {
      const name = `run-${new Date().toISOString().slice(0, 16)}`;
      const res = await fetch('/ai-skills/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ datasetId: detail.dataset.id, name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const exp: Experiment = await res.json();
      addToast({ type: 'success', message: `Experiment #${exp.id} lancé — suivi en live` });
      setSelectedExpId(exp.id);
      // Reload the dataset detail to show the new experiment row.
      const r = await fetch(`/ai-skills/api/datasets/${detail.dataset.id}`, { credentials: 'include' });
      if (r.ok) setDetail(await r.json());
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    }
  };

  return (
    <Layout appId="ai-evals" variant="full-width" onNavigate={onNavigate}>
      <div className={styles.root}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2 className={styles.sidebarTitle}>$ ai-evals</h2>
            <button className={styles.createBtn} onClick={() => setCreatingDataset(v => !v)}>
              {creatingDataset ? '× annuler' : '＋ dataset'}
            </button>
          </div>

          {creatingDataset && (
            <div className={styles.form} style={{ padding: 'var(--spacing-sm) var(--spacing-md)', borderBottom: '1px solid var(--border-color)' }}>
              <input className={styles.input} placeholder="Nom du dataset" value={newDatasetName} onChange={e => setNewDatasetName(e.target.value)} />
              <select className={styles.select} value={newDatasetSkill} onChange={e => setNewDatasetSkill(e.target.value)}>
                <option value="">— Skill cible —</option>
                {skills.filter(s => !s.slug.startsWith('llm-judge')).map(s => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
              <input className={styles.input} placeholder="Description (optionnel)" value={newDatasetDesc} onChange={e => setNewDatasetDesc(e.target.value)} />
              <Button variant="primary" onClick={createDataset} disabled={!newDatasetName.trim() || !newDatasetSkill}>Créer</Button>
            </div>
          )}

          {loadingList ? (
            <LoadingSpinner message="…" />
          ) : datasets.length === 0 ? (
            <p className={styles.empty}>Aucun dataset. Crée un dataset pour y ajouter des items (via la page /ai-logs ou directement ici).</p>
          ) : (
            <ul className={styles.list}>
              {datasets.map(d => {
                const active = detail?.dataset.id === d.id;
                return (
                  <li key={d.id}>
                    <button className={`${styles.listItem} ${active ? styles.listItemActive : ''}`} onClick={() => go(`/ai-evals/${d.id}`)}>
                      <div className={styles.listItemName}>{d.name}</div>
                      <div className={styles.listItemMeta}>
                        <span>{d.skill_slug}</span>
                        <span>{d.item_count ?? 0} items</span>
                        <span>{formatDate(d.created_at)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className={styles.main}>
          {loadingDetail ? (
            <div className={styles.mainPadded}><LoadingSpinner message="Chargement…" /></div>
          ) : !detail ? (
            <div className={styles.mainPadded}>
              <p className={styles.placeholder}>← Sélectionne un dataset ou crée-en un.</p>
              <p className={styles.placeholderHint}>
                Un dataset est une liste d'inputs (avec éventuellement l'output attendu annoté). Lance une « experiment » pour rejouer le skill courant sur tous les items et comparer les scores à une baseline.
              </p>
            </div>
          ) : (
            <div className={styles.detail}>
              <header className={styles.detailHeader}>
                <div>
                  <div className={styles.detailCrumb}>ai-evals › <strong>{detail.dataset.name}</strong></div>
                  <h1 className={styles.detailTitle}>{detail.dataset.name}</h1>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>
                    Skill : <code>{detail.dataset.skill_slug}</code> · {detail.items.length} items · {detail.experiments.length} experiments
                  </div>
                </div>
                <div className={styles.detailActions}>
                  <Button variant="secondary" onClick={() => setAssistantOpen(true)}>
                    🚀 Améliorer
                  </Button>
                  <Button variant="primary" onClick={launchExperiment} disabled={detail.items.length === 0}>
                    ▶ Lancer une experiment
                  </Button>
                </div>
              </header>

              {/* Items table */}
              <section className={styles.section}>
                <header className={styles.sectionHeader}>
                  <div>
                    <h3 className={styles.sectionTitle}>📋 Items du dataset ({detail.items.length})</h3>
                    <p className={styles.sectionSubtitle}>
                      Ajout via /ai-logs (bouton « ➕ ajouter à un dataset »), via l'assistant /ai-improve-assistant (étape 5)
                      ou POST /datasets/:id/items. Clique sur une ligne pour voir l'input complet + l'output attendu + les notes.
                    </p>
                  </div>
                  <Button variant="secondary" onClick={reloadDetail} disabled={loadingDetail}>
                    {loadingDetail ? '…' : '🔄 Rafraîchir'}
                  </Button>
                </header>
                {detail.items.length === 0 ? (
                  <p className={styles.placeholderHint}>Aucun item encore. Depuis /ai-logs, ouvre un log pertinent puis clique « ➕ ajouter à un dataset » pour peupler ce dataset.</p>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ width: 30 }} />
                        <th style={{ width: 40 }}>#</th>
                        <th>Input (aperçu)</th>
                        <th style={{ width: 90 }}>Expected</th>
                        <th style={{ width: 120 }}>Notes</th>
                        <th style={{ width: 120 }}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map(it => {
                        const isExpanded = expandedItemId === it.id;
                        const toggle = () => setExpandedItemId(prev => prev === it.id ? null : it.id);
                        return (
                          <Fragment key={it.id}>
                            <tr onClick={toggle} style={{ cursor: 'pointer' }} title="Cliquer pour voir le détail complet">
                              <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{isExpanded ? '▾' : '▸'}</td>
                              <td>{it.position}</td>
                              <td><div className={styles.preview}>{it.input_content.slice(0, 200)}{it.input_content.length > 200 ? '…' : ''}</div></td>
                              <td style={{ color: it.expected_output ? 'var(--success, #4caf50)' : 'var(--text-secondary)' }}>
                                {it.expected_output ? '✓ défini' : '— vide'}
                              </td>
                              <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                {it.expected_notes ? (it.expected_notes.length > 30 ? it.expected_notes.slice(0, 30) + '…' : it.expected_notes) : '—'}
                              </td>
                              <td>
                                {it.source_log_id
                                  ? <a href={`/ai-logs/${it.source_log_id}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>log #{it.source_log_id}</a>
                                  : 'ad-hoc'}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={6} style={{
                                  background: 'var(--bg-secondary, rgba(128,128,128,0.05))',
                                  padding: 'var(--spacing-sm) var(--spacing-md)',
                                  borderLeft: '3px solid var(--accent-primary)',
                                }}>
                                  <DatasetItemDetail item={it} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>

              {/* Experiments table */}
              <section className={styles.section}>
                <header className={styles.sectionHeader}>
                  <div>
                    <h3 className={styles.sectionTitle}>🧪 Experiments ({detail.experiments.length})</h3>
                    <p className={styles.sectionSubtitle}>
                      Chaque ligne = un run du skill sur tout le dataset. Une experiment qui tourne met à jour sa progression toutes les 2 s.
                    </p>
                  </div>
                </header>
                {detail.experiments.length === 0 ? (
                  <p className={styles.placeholderHint}>Aucune experiment lancée.</p>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Progression</th>
                        <th>Skill version</th>
                        <th>Model</th>
                        <th>Créé</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.experiments.map(e => (
                        <tr key={e.id}>
                          <td>{e.name}</td>
                          <td>
                            <span className={`${styles.statusPill} ${e.status === 'done' ? styles.statusPillDone : e.status === 'error' ? styles.statusPillError : e.status === 'running' ? styles.statusPillRunning : ''}`}>
                              {e.status}
                            </span>
                          </td>
                          <td><ProgressCell experiment={e} /></td>
                          <td><code>{e.skill_version_hash.slice(0, 7)}</code></td>
                          <td>{e.model ?? '—'}</td>
                          <td>{formatDate(e.created_at)}</td>
                          <td className={styles.tableRight}>
                            <Button variant="secondary" onClick={() => setSelectedExpId(e.id)}>Détails</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* Experiment detail */}
              {selectedExpId && (
                <section className={styles.section}>
                  <header className={styles.sectionHeader}>
                    <div>
                      <h3 className={styles.sectionTitle}>
                        🔬 Experiment #{selectedExpId}
                        {expReport?.experiment.status === 'running' && ' (en cours…)'}
                      </h3>
                      {expReport?.baseline && (
                        <p className={styles.sectionSubtitle}>Baseline : experiment #{expReport.baseline.id} — <code>{expReport.baseline.skill_version_hash.slice(0, 7)}</code></p>
                      )}
                    </div>
                    <div className={styles.detailActions}>
                      <Button variant="secondary" onClick={() => setSelectedExpId(null)}>Fermer</Button>
                    </div>
                  </header>

                  {loadingExp && !expReport ? (
                    <LoadingSpinner message="…" />
                  ) : expReport ? (
                    <>
                      {/* Summary row */}
                      <div style={{ display: 'flex', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                        <SummaryCell label="Items" value={String(expReport.summary.itemCount)} />
                        <SummaryCell label="Coût total" value={formatCost(expReport.summary.totalCostUsd)} />
                        <SummaryCell label="Durée cumulée" value={`${Math.round(expReport.summary.totalDurationMs / 1000)}s`} />
                        {Object.entries(expReport.summary.avgByScore).map(([key, s]) => (
                          <SummaryCell key={key} label={key} value={s.avg.toFixed(2)} sub={`n=${s.count}`} />
                        ))}
                      </div>

                      {/* Items × scores matrix */}
                      <ExperimentItemsTable report={expReport} />
                    </>
                  ) : null}
                </section>
              )}
            </div>
          )}
        </main>
      </div>

      <div style={{ position: 'fixed', top: 60, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1000 }}>
        {toasts.map(t => (
          <Toast key={t.id} toast={t} onClose={() => dismissToast(t.id)} />
        ))}
      </div>

      <AssistantFlow
        open={assistantOpen}
        onClose={() => {
          setAssistantOpen(false);
          // The assistant persists its state (skillSlug, logId, datasetId,
          // itemId, …) in localStorage under `assistant:improve-skill`.
          // If the user created/picked a DIFFERENT dataset inside the
          // assistant (step 4) than the one currently displayed, the items
          // they added went there — so we redirect to that dataset so
          // their work is actually visible.
          let redirected = false;
          try {
            const raw = localStorage.getItem('assistant:improve-skill');
            if (raw) {
              const parsed = JSON.parse(raw) as { datasetId?: number | null };
              const targetId = parsed.datasetId;
              if (targetId != null && String(targetId) !== routeDatasetId) {
                go(`/ai-evals/${targetId}`);
                redirected = true;
              }
            }
          } catch { /* best-effort */ }
          if (!redirected) reloadDetail();
        }}
        initialSkillSlug={detail?.dataset.skill_slug ?? null}
      />
    </Layout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function DatasetItemDetail({ item }: { item: DatasetItem }) {
  // Expected output : pretty-JSON if it parses, fall back to raw text, or
  // show an explicit "non défini" state. Same pattern as /ai-logs.
  const expectedPretty: string = (() => {
    if (item.expected_output == null) return '';
    if (typeof item.expected_output === 'string') return item.expected_output;
    try { return JSON.stringify(item.expected_output, null, 2); }
    catch { return String(item.expected_output); }
  })();

  const paneStyle: React.CSSProperties = {
    margin: 0,
    padding: 'var(--spacing-xs)',
    maxHeight: 320,
    overflow: 'auto',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text-primary)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.4,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
      {/* Item metadata row. */}
      <div style={{ display: 'flex', gap: 'var(--spacing-md)', fontSize: 11, color: 'var(--text-secondary)' }}>
        <span>Item #{item.position} · id <code>{item.id}</code></span>
        {item.source_log_id && (
          <span>Source : <a href={`/ai-logs/${item.source_log_id}`} target="_blank" rel="noreferrer">log #{item.source_log_id}</a></span>
        )}
        <span>Input : {item.input_content.length.toLocaleString()} chars</span>
      </div>

      {/* Input content (full). */}
      <div>
        <div style={labelStyle}>📥 Input complet</div>
        <pre style={paneStyle}>{item.input_content || '(vide)'}</pre>
      </div>

      {/* Expected output (if any). */}
      <div>
        <div style={labelStyle}>
          🎯 Output attendu {expectedPretty ? `(${expectedPretty.length.toLocaleString()} chars)` : ''}
        </div>
        {expectedPretty ? (
          <pre style={paneStyle}>{expectedPretty}</pre>
        ) : (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            Non défini. Sans output attendu, le juge IA notera seulement la cohérence générale (pas la fidélité exacte à une vérité terrain).
          </p>
        )}
      </div>

      {/* Notes (if any). */}
      {item.expected_notes && (
        <div>
          <div style={labelStyle}>📝 Notes</div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {item.expected_notes}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressCell({ experiment }: { experiment: Experiment }) {
  const done = experiment.runs_done ?? 0;
  const total = experiment.item_count ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (experiment.status === 'done') {
    return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>✓ {done}/{total}</span>;
  }
  if (experiment.status === 'error') {
    return <span style={{ fontSize: 11, color: 'var(--error)' }}>✕ {done}/{total} — {experiment.error ?? 'erreur'}</span>;
  }
  if (experiment.status === 'pending') {
    return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>⏳ en attente de démarrage</span>;
  }

  // running
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
        <span>{done} / {total} items</span>
        <span>{pct}%</span>
      </div>
      <div style={{
        width: '100%', height: 4,
        background: 'var(--border-color)',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: 'var(--accent-primary)',
          transition: 'width 0.3s',
        }} />
      </div>
    </div>
  );
}

function SummaryCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', minWidth: 120 }}>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--accent-primary)', fontWeight: 600, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  );
}

function ExperimentItemsTable({ report }: { report: ExperimentReport }) {
  // Aggregate score columns : union of all score keys across current items.
  const scoreKeys = Array.from(new Set(
    report.items.flatMap(it => it.scores.map(s => `${s.kind}:${s.name}`)),
  )).sort();

  // Build baseline lookup for delta computation.
  const baselineByItem = new Map<number, ExperimentReport['items'][number]>();
  (report.baselineItems ?? []).forEach(it => baselineByItem.set(it.item_id, it));

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Output (aperçu)</th>
            <th>Durée</th>
            <th>Coût</th>
            {scoreKeys.map(k => <th key={k} style={{ textAlign: 'center' }}>{k}</th>)}
            <th>Log</th>
          </tr>
        </thead>
        <tbody>
          {report.items.map(it => {
            const base = baselineByItem.get(it.item_id);
            return (
              <tr key={it.item_id}>
                <td>#{it.item_id}</td>
                <td><div className={styles.preview}>{it.output_preview || '—'}</div></td>
                <td>{it.duration_ms != null ? `${it.duration_ms} ms` : '—'}</td>
                <td>{formatCost(it.cost_usd)}</td>
                {scoreKeys.map(k => {
                  const [kind, name] = k.split(':');
                  const sc = it.scores.find(s => s.kind === kind && s.name === name);
                  const baseSc = base?.scores.find(s => s.kind === kind && s.name === name);
                  const delta = sc && baseSc ? sc.value - baseSc.value : null;
                  return (
                    <td key={k} className={styles.scoreCell}>
                      {sc ? sc.value.toFixed(2) : '—'}
                      {delta != null && delta !== 0 && (
                        <span className={`${styles.scoreDelta} ${delta > 0 ? styles.scoreDeltaUp : styles.scoreDeltaDown}`}>
                          {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td><a href={`/ai-logs/${it.log_id}`} target="_blank" rel="noreferrer">#{it.log_id}</a></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
