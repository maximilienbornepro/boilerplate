import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout, Button, LoadingSpinner, Toast, useGatewayUser } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import styles from './AiLogs.module.css';

// Full-page AI-logs viewer. Two columns : left = chronological list of all
// logs, right = detail of the selected log with the full prompt, raw output,
// proposals + inline replay against an editable input.
//
// Admin only — the route is gated both on the nav (Layout) and here.

interface LogListItem {
  id: number;
  user_id: number | null;
  user_email: string | null;
  skill_slug: string;
  source_kind: string | null;
  source_title: string | null;
  document_id: string | null;
  proposals_count: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

interface LogDetail extends LogListItem {
  input_content: string;
  full_prompt: string;
  ai_output_raw: string;
  proposals_json: unknown;
}

interface ReplayResult {
  logId: number | null;
  output: string;
  proposals: unknown;
  error: string | null;
}

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function AiLogsApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useGatewayUser();
  const { logId: routeLogId } = useParams<{ logId?: string }>();

  const [logs, setLogs] = useState<LogListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterSkill, setFilterSkill] = useState<string>('');

  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  // Replay state
  const [replayInput, setReplayInput] = useState('');
  const [replayPrompt, setReplayPrompt] = useState('');
  const [editPromptMode, setEditPromptMode] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);

  const [toasts, setToasts] = useState<ToastData[]>([]);
  const addToast = (t: Omit<ToastData, 'id'>) => setToasts(prev => [...prev, { ...t, id: String(Date.now()) + Math.random() }]);
  const dismissToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  const go = useCallback((path: string) => {
    if (onNavigate) onNavigate(path);
    else navigate(path);
  }, [navigate, onNavigate]);

  // ── Load list ──
  const fetchPage = useCallback(async (offset: number): Promise<LogListItem[]> => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (filterSkill) params.set('skill', filterSkill);
    const res = await fetch(`/ai-skills/api/logs/list?${params.toString()}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Chargement impossible');
    return res.json();
  }, [filterSkill]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const page = await fetchPage(0);
      setLogs(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally { setLoadingList(false); }
  }, [fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await fetchPage(logs.length);
      setLogs(prev => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally { setLoadingMore(false); }
  };

  useEffect(() => { loadList(); }, [loadList]);

  // ── Load detail when route id changes ──
  useEffect(() => {
    if (!routeLogId) {
      setDetail(null);
      setReplayResult(null);
      return;
    }
    setLoadingDetail(true);
    setDetailError('');
    setReplayResult(null);
    fetch(`/ai-skills/api/logs/${routeLogId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: LogDetail) => {
        setDetail(d);
        setReplayInput(d.input_content ?? '');
        setReplayPrompt(d.full_prompt ?? '');
        setEditPromptMode(false);
      })
      .catch(err => setDetailError(err instanceof Error ? err.message : 'Erreur'))
      .finally(() => setLoadingDetail(false));
  }, [routeLogId]);

  const uniqueSkills = Array.from(new Set(logs.map(l => l.skill_slug)));

  // ── Guards ──
  if (authLoading) {
    return (
      <Layout appId="ai-logs" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem' }}><LoadingSpinner message="Chargement..." /></div>
      </Layout>
    );
  }
  if (!user?.isAdmin) {
    return (
      <Layout appId="ai-logs" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>403</h1>
          <p>Cette page est réservée aux administrateurs.</p>
          <Button variant="secondary" onClick={() => go('/')}>Retour</Button>
        </div>
      </Layout>
    );
  }

  const runReplay = async () => {
    if (!detail) return;
    setReplaying(true);
    try {
      const res = await fetch(`/ai-skills/api/logs/${detail.id}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          inputContent: replayInput,
          ...(editPromptMode ? { fullPrompt: replayPrompt } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const data: ReplayResult = await res.json();
      setReplayResult(data);
      if (data.logId) {
        addToast({
          type: 'success',
          message: `Replay enregistré — log #${data.logId}`,
        });
        // Reload the list so the new log appears at the top.
        loadList();
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur replay' });
    } finally {
      setReplaying(false);
    }
  };

  return (
    <Layout appId="ai-logs" variant="full-width" onNavigate={onNavigate}>
      <div className={styles.root}>
        {/* ── Sidebar : log list ── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2 className={styles.sidebarTitle}>$ ai-logs</h2>
            <div className={styles.sidebarCount}>{logs.length} entrée(s){hasMore ? '+' : ''}</div>
          </div>

          {uniqueSkills.length > 0 && (
            <div className={styles.filterRow}>
              <button
                className={`${styles.filterPill} ${filterSkill === '' ? styles.filterPillActive : ''}`}
                onClick={() => setFilterSkill('')}
              >tous</button>
              {uniqueSkills.map(slug => (
                <button
                  key={slug}
                  className={`${styles.filterPill} ${filterSkill === slug ? styles.filterPillActive : ''}`}
                  onClick={() => setFilterSkill(slug)}
                  title={slug}
                >{slug.split('-').slice(1).join('-') || slug}</button>
              ))}
            </div>
          )}

          {loadingList ? (
            <LoadingSpinner message="Chargement…" />
          ) : logs.length === 0 ? (
            <p className={styles.empty}>Aucun log enregistré.</p>
          ) : (
            <ul className={styles.list}>
              {logs.map(l => {
                const active = detail?.id === l.id;
                return (
                  <li key={l.id}>
                    <button
                      className={`${styles.listItem} ${active ? styles.listItemActive : ''}`}
                      onClick={() => go(`/ai-logs/${l.id}`)}
                    >
                      <div className={styles.listItemTop}>
                        <span className={styles.listItemId}>#{l.id}</span>
                        <span className={styles.listItemSkill}>{l.skill_slug}</span>
                      </div>
                      <div className={styles.listItemTitle}>
                        {l.source_title || <em>(sans titre)</em>}
                      </div>
                      <div className={styles.listItemMeta}>
                        <span>{formatDate(l.created_at)}</span>
                        {l.error ? (
                          <span className={styles.listItemError}>× erreur</span>
                        ) : (
                          <span className={styles.listItemOk}>{l.proposals_count} prop.</span>
                        )}
                        {l.duration_ms != null && <span>{l.duration_ms} ms</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
              {hasMore && (
                <li className={styles.loadMoreRow}>
                  <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? '…' : 'Charger plus'}
                  </Button>
                </li>
              )}
            </ul>
          )}
        </aside>

        {/* ── Main : detail panel ── */}
        <main className={styles.main}>
          {loadingDetail ? (
            <div className={styles.mainPadded}><LoadingSpinner message="Chargement du log…" /></div>
          ) : detailError ? (
            <div className={styles.mainPadded}>
              <p className={styles.error}>{detailError}</p>
              <Button variant="secondary" onClick={() => go('/ai-logs')}>Retour à la liste</Button>
            </div>
          ) : !detail ? (
            <div className={styles.mainPadded}>
              <p className={styles.placeholder}>
                ← Sélectionne un log dans la colonne de gauche pour voir son détail complet.
              </p>
              <p className={styles.placeholderHint}>
                Chaque analyse IA du projet (transcription, email, Slack, reformulation, delivery) y est
                loggée avec son input brut, son prompt complet, la réponse du modèle, les propositions
                parsées et la durée.
              </p>
            </div>
          ) : (
            <LogDetailView
              detail={detail}
              replayInput={replayInput}
              setReplayInput={setReplayInput}
              replayPrompt={replayPrompt}
              setReplayPrompt={setReplayPrompt}
              editPromptMode={editPromptMode}
              setEditPromptMode={setEditPromptMode}
              replaying={replaying}
              replayResult={replayResult}
              onReplay={runReplay}
              onOpenReplay={(id) => go(`/ai-logs/${id}`)}
            />
          )}
        </main>
      </div>

      <div className={styles.toastStack}>
        {toasts.map(t => (
          <Toast key={t.id} toast={t} onClose={() => dismissToast(t.id)} />
        ))}
      </div>
    </Layout>
  );
}

// ========== Detail view component ==========

interface DetailProps {
  detail: LogDetail;
  replayInput: string;
  setReplayInput: (v: string) => void;
  replayPrompt: string;
  setReplayPrompt: (v: string) => void;
  editPromptMode: boolean;
  setEditPromptMode: (v: boolean) => void;
  replaying: boolean;
  replayResult: ReplayResult | null;
  onReplay: () => void;
  onOpenReplay: (id: number) => void;
}

function LogDetailView({
  detail, replayInput, setReplayInput,
  replayPrompt, setReplayPrompt,
  editPromptMode, setEditPromptMode,
  replaying, replayResult, onReplay, onOpenReplay,
}: DetailProps) {
  const copy = (text: string) => { navigator.clipboard?.writeText(text); };
  const url = `${window.location.origin}/ai-logs/${detail.id}`;

  return (
    <div className={styles.detail}>
      <header className={styles.detailHeader}>
        <div>
          <div className={styles.detailCrumb}>ai-logs › <strong>#{detail.id}</strong></div>
          <h1 className={styles.detailTitle}>{detail.source_title || '(sans titre)'}</h1>
          <div className={styles.detailMeta}>
            <span className={styles.metaPill}>{detail.skill_slug}</span>
            {detail.source_kind && <span className={styles.metaPill}>{detail.source_kind}</span>}
            {detail.error ? (
              <span className={`${styles.metaPill} ${styles.metaPillError}`}>× erreur</span>
            ) : (
              <span className={`${styles.metaPill} ${styles.metaPillOk}`}>{detail.proposals_count} proposition(s)</span>
            )}
            {detail.duration_ms != null && <span className={styles.metaPill}>{detail.duration_ms} ms</span>}
          </div>
        </div>
        <div className={styles.detailActions}>
          <Button variant="secondary" onClick={() => copy(url)}>📋 Copier le lien</Button>
        </div>
      </header>

      <section className={styles.detailMetaGrid}>
        <MetaRow label="log id" value={`#${detail.id}`} />
        <MetaRow label="créé le" value={new Date(detail.created_at).toLocaleString('fr-FR')} />
        <MetaRow label="user" value={detail.user_email || (detail.user_id ? `#${detail.user_id}` : '—')} />
        {detail.document_id && <MetaRow label="document" value={detail.document_id} />}
        <MetaRow label="url" value={url} mono />
        {detail.error && <MetaRow label="erreur" value={detail.error} error />}
      </section>

      {/* ── Input brut (editable for replay) ── */}
      <Section
        title="📥 Input brut (envoyé au modèle)"
        subtitle="Tu peux modifier cet input puis cliquer sur « Rejouer » pour tester."
        toolbar={<Button variant="secondary" onClick={() => copy(detail.input_content)}>Copier</Button>}
      >
        <textarea
          className={styles.codeTextarea}
          value={replayInput}
          onChange={e => setReplayInput(e.target.value)}
          spellCheck={false}
        />
      </Section>

      {/* ── Full prompt (skill + exec context) ── */}
      <Section
        title="🧠 Prompt complet envoyé au modèle"
        subtitle={editPromptMode
          ? 'Mode override — le prompt ci-dessous sera envoyé TEL QUEL (bypass skill/template).'
          : 'Par défaut, le replay reconstruit le prompt à partir du skill courant + ton input. Active le mode override pour tout remplacer.'}
        toolbar={
          <>
            <Button variant="secondary" onClick={() => copy(detail.full_prompt)}>Copier</Button>
            <Button
              variant={editPromptMode ? 'primary' : 'secondary'}
              onClick={() => setEditPromptMode(!editPromptMode)}
            >
              {editPromptMode ? '✓ Override actif' : 'Éditer le prompt'}
            </Button>
          </>
        }
      >
        {editPromptMode ? (
          <textarea
            className={styles.codeTextarea}
            value={replayPrompt}
            onChange={e => setReplayPrompt(e.target.value)}
            spellCheck={false}
            style={{ minHeight: 360 }}
          />
        ) : (
          <pre className={styles.codeBlock}>{detail.full_prompt}</pre>
        )}
      </Section>

      {/* ── AI output ── */}
      <Section
        title="📤 Réponse brute du modèle"
        toolbar={<Button variant="secondary" onClick={() => copy(detail.ai_output_raw)}>Copier</Button>}
      >
        <pre className={styles.codeBlock}>{detail.ai_output_raw || '(vide)'}</pre>
      </Section>

      {/* ── Parsed proposals ── */}
      <Section
        title="📦 Propositions parsées"
        toolbar={<Button variant="secondary" onClick={() => copy(JSON.stringify(detail.proposals_json, null, 2))}>Copier JSON</Button>}
      >
        <pre className={styles.codeBlock}>{JSON.stringify(detail.proposals_json, null, 2)}</pre>
      </Section>

      {/* ── Replay ── */}
      <Section title="▶ Rejouer" subtitle="Relance le même skill avec l'input (et éventuellement le prompt) éditable ci-dessus. Le résultat est loggué comme une nouvelle entrée.">
        <div className={styles.replayBar}>
          <Button variant="primary" onClick={onReplay} disabled={replaying}>
            {replaying ? 'Rejeu en cours…' : '▶ Rejouer avec ces valeurs'}
          </Button>
          {replayResult?.logId != null && (
            <Button variant="secondary" onClick={() => onOpenReplay(replayResult.logId!)}>
              → Ouvrir le replay #{replayResult.logId}
            </Button>
          )}
        </div>

        {replayResult && (
          <div className={styles.replayResult}>
            {replayResult.error ? (
              <p className={styles.error}>{replayResult.error}</p>
            ) : null}
            <h4 className={styles.replaySubhead}>Réponse brute</h4>
            <pre className={styles.codeBlock}>{replayResult.output || '(vide)'}</pre>
            <h4 className={styles.replaySubhead}>Propositions parsées</h4>
            <pre className={styles.codeBlock}>{JSON.stringify(replayResult.proposals, null, 2)}</pre>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title, subtitle, toolbar, children,
}: { title: string; subtitle?: string; toolbar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h3 className={styles.sectionTitle}>{title}</h3>
          {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
        </div>
        {toolbar && <div className={styles.sectionToolbar}>{toolbar}</div>}
      </header>
      {children}
    </section>
  );
}

function MetaRow({ label, value, mono, error }: { label: string; value: string; mono?: boolean; error?: boolean }) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={`${styles.metaValue} ${mono ? styles.metaMono : ''} ${error ? styles.metaError : ''}`}>{value}</span>
    </div>
  );
}
