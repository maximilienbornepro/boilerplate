import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout, Button, LoadingSpinner, Toast, useGatewayUser } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { AssistantFlow } from '../ai-improve-assistant/App';
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
  // Phase 1 — enriched trace metadata
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  skill_version_hash: string | null;
  parent_log_id: number | null;
}

interface LogDetail extends LogListItem {
  input_content: string;
  full_prompt: string;
  ai_output_raw: string;
  proposals_json: unknown;
  provider: string | null;
}

function formatCost(cost: string | null): string {
  if (!cost) return '—';
  const n = parseFloat(cost);
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

interface ReplayResult {
  logId: number | null;
  output: string;
  proposals: unknown;
  error: string | null;
}

interface ScoreRow {
  id: number;
  log_id: number;
  score_name: string;
  score_value: string;
  scorer_kind: 'heuristic' | 'llm-judge' | 'human';
  scorer_id: string | null;
  rationale: string | null;
  annotator_user_id: number | null;
  created_at: string;
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
  const [assistantOpen, setAssistantOpen] = useState(false);

  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  // Replay state
  const [replayInput, setReplayInput] = useState('');
  const [replayPrompt, setReplayPrompt] = useState('');
  const [editPromptMode, setEditPromptMode] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);

  // Scores state (Phase 2)
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [rescoring, setRescoring] = useState(false);
  const [humanRationale, setHumanRationale] = useState('');

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
      setScores([]);
      return;
    }
    setLoadingDetail(true);
    setDetailError('');
    setReplayResult(null);
    setScores([]);
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
    // Load scores in parallel.
    fetch(`/ai-skills/api/logs/${routeLogId}/scores`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: ScoreRow[]) => setScores(rows))
      .catch(() => { /* silent */ });
  }, [routeLogId]);

  const refreshScores = useCallback(async () => {
    if (!routeLogId) return;
    const r = await fetch(`/ai-skills/api/logs/${routeLogId}/scores`, { credentials: 'include' });
    if (r.ok) setScores(await r.json());
  }, [routeLogId]);

  const submitHumanScore = async (value: -1 | 1) => {
    if (!detail) return;
    try {
      const r = await fetch(`/ai-skills/api/logs/${detail.id}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: 'thumbs', value, rationale: humanRationale || null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setHumanRationale('');
      await refreshScores();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    }
  };

  const deleteMyScore = async (scoreId: number) => {
    if (!detail) return;
    try {
      const r = await fetch(`/ai-skills/api/logs/${detail.id}/scores/${scoreId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await refreshScores();
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    }
  };

  const rescoreAuto = async () => {
    if (!detail) return;
    setRescoring(true);
    try {
      const r = await fetch(`/ai-skills/api/logs/${detail.id}/rescore`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setScores(await r.json());
      addToast({ type: 'success', message: 'Scorers auto relancés' });
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setRescoring(false);
    }
  };

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
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                title="Assistant d'amélioration de skill"
                style={{
                  padding: '3px 8px', fontSize: 11, fontFamily: 'var(--font-mono)',
                  background: 'var(--accent-primary)', color: '#000',
                  border: 'none', borderRadius: 2, cursor: 'pointer', fontWeight: 600,
                }}
              >🚀 Améliorer</button>
              <div className={styles.sidebarCount}>{logs.length}{hasMore ? '+' : ''}</div>
            </div>
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
                      style={l.error ? {
                        borderLeft: '3px solid var(--error, #f44336)',
                        background: 'rgba(244,67,54,0.08)',
                      } : undefined}
                      title={l.error ? `Erreur : ${l.error.slice(0, 200)}` : undefined}
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
                        {l.cost_usd && <span>{formatCost(l.cost_usd)}</span>}
                        {(l.input_tokens != null || l.output_tokens != null) && (
                          <span>{l.input_tokens ?? 0}/{l.output_tokens ?? 0} tk</span>
                        )}
                        {l.skill_version_hash && <span title={l.skill_version_hash}>v {l.skill_version_hash.slice(0, 7)}</span>}
                        {l.parent_log_id != null && <span title={`Replay de #${l.parent_log_id}`}>↳ #{l.parent_log_id}</span>}
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
              scores={scores}
              currentUserId={user.id}
              onThumbUp={() => submitHumanScore(1)}
              onThumbDown={() => submitHumanScore(-1)}
              onDeleteMyScore={deleteMyScore}
              onRescoreAuto={rescoreAuto}
              rescoring={rescoring}
              humanRationale={humanRationale}
              setHumanRationale={setHumanRationale}
            />
          )}
        </main>
      </div>

      <div className={styles.toastStack}>
        {toasts.map(t => (
          <Toast key={t.id} toast={t} onClose={() => dismissToast(t.id)} />
        ))}
      </div>

      <AssistantFlow
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        initialSkillSlug={detail?.skill_slug ?? (filterSkill || null)}
      />
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
  scores: ScoreRow[];
  currentUserId: number;
  onThumbUp: () => void;
  onThumbDown: () => void;
  onDeleteMyScore: (scoreId: number) => void;
  onRescoreAuto: () => void;
  rescoring: boolean;
  humanRationale: string;
  setHumanRationale: (v: string) => void;
}

function LogDetailView({
  detail, replayInput, setReplayInput,
  replayPrompt, setReplayPrompt,
  editPromptMode, setEditPromptMode,
  replaying, replayResult, onReplay, onOpenReplay,
  scores, currentUserId, onThumbUp, onThumbDown, onDeleteMyScore,
  onRescoreAuto, rescoring, humanRationale, setHumanRationale,
}: DetailProps) {
  const copy = (text: string) => { navigator.clipboard?.writeText(text); };
  const url = `${window.location.origin}/ai-logs/${detail.id}`;

  return (
    <div className={styles.detail}>
      {/* ── Prominent error banner : always visible above the header when
          the log has an error (either thrown at call time, or annotated
          by the pipeline on parse/empty failure). ── */}
      {detail.error && (
        <div style={{
          padding: 'var(--spacing-sm) var(--spacing-md)',
          marginBottom: 'var(--spacing-md)',
          background: 'rgba(244,67,54,0.1)',
          border: '1px solid var(--error, #f44336)',
          borderLeft: '4px solid var(--error, #f44336)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--error, #f44336)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-sm)',
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, fontFamily: 'inherit', fontSize: 'var(--font-size-md)' }}>
            ⚠ Erreur sur ce log
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)' }}>
            {detail.error}
          </div>
          {detail.parent_log_id != null && (
            <div style={{ marginTop: 6, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              Ce log est un enfant de <a href={`/ai-logs/${detail.parent_log_id}`}>#{detail.parent_log_id}</a> — remonte l'arbre pour voir l'étape d'origine.
            </div>
          )}
        </div>
      )}
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
          <AddToDatasetButton logId={detail.id} skillSlug={detail.skill_slug} />
        </div>
      </header>

      <section className={styles.detailMetaGrid}>
        <MetaRow label="log id" value={`#${detail.id}`} />
        <MetaRow label="créé le" value={new Date(detail.created_at).toLocaleString('fr-FR')} />
        <MetaRow label="user" value={detail.user_email || (detail.user_id ? `#${detail.user_id}` : '—')} />
        {detail.document_id && <MetaRow label="document" value={detail.document_id} />}
        <MetaRow label="url" value={url} mono />
        {detail.model && <MetaRow label="modèle" value={`${detail.provider ?? '?'} · ${detail.model}`} mono />}
        {(detail.input_tokens != null || detail.output_tokens != null) && (
          <MetaRow label="tokens" value={`${detail.input_tokens ?? 0} in · ${detail.output_tokens ?? 0} out`} mono />
        )}
        {detail.cost_usd && <MetaRow label="coût" value={formatCost(detail.cost_usd)} mono />}
        {detail.skill_version_hash && (
          <MetaRow label="skill version" value={`${detail.skill_version_hash.slice(0, 7)} — ${detail.skill_version_hash}`} mono />
        )}
        {detail.parent_log_id != null && (
          <MetaRow label="parent" value={`replay de #${detail.parent_log_id}`} mono />
        )}
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

      {/* ── Scores (Phase 2) ── */}
      <Section
        title="⭐ Scores"
        subtitle="Scorers automatiques (heuristiques + llm-judge) + annotations humaines."
        toolbar={
          <Button variant="secondary" onClick={onRescoreAuto} disabled={rescoring}>
            {rescoring ? 'Rescoring…' : 'Relancer scorers auto'}
          </Button>
        }
      >
        <ScoresTable
          scores={scores}
          currentUserId={currentUserId}
          onDeleteMine={onDeleteMyScore}
        />

        <div style={{ marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm)', background: 'var(--bg-secondary, rgba(128,128,128,0.05))', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Ton vote (optionnel : rationale)
          </div>
          <input
            type="text"
            value={humanRationale}
            onChange={e => setHumanRationale(e.target.value)}
            placeholder="Pourquoi c'est bon / mauvais ? (facultatif)"
            style={{
              width: '100%', padding: '6px 8px', marginBottom: 8,
              fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)',
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
            <Button variant="secondary" onClick={onThumbDown}>👎 Pas bon</Button>
            <Button variant="primary" onClick={onThumbUp}>👍 Bon</Button>
          </div>
        </div>
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

function AddToDatasetButton({ logId, skillSlug }: { logId: number; skillSlug: string }) {
  const [open, setOpen] = useState(false);
  const [datasets, setDatasets] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/ai-skills/api/datasets?skill=${encodeURIComponent(skillSlug)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Array<{ id: number; name: string }>) => setDatasets(rows))
      .finally(() => setLoading(false));
  }, [open, skillSlug]);

  const add = async () => {
    if (picked == null) return;
    setAdding(true);
    try {
      await fetch(`/ai-skills/api/datasets/${picked}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ logId }),
      });
      setDone(true);
      setTimeout(() => { setOpen(false); setDone(false); setPicked(null); }, 1200);
    } finally { setAdding(false); }
  };

  if (!open) {
    return <Button variant="secondary" onClick={() => setOpen(true)}>➕ Ajouter à un dataset</Button>;
  }

  return (
    <div style={{
      position: 'relative', display: 'flex', gap: 6, alignItems: 'center',
      padding: '4px 8px', background: 'var(--bg-secondary, rgba(128,128,128,0.05))',
      border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
    }}>
      {loading ? (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>…</span>
      ) : datasets.length === 0 ? (
        <>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            Aucun dataset pour ce skill
          </span>
          <a href="/ai-evals" target="_blank" rel="noreferrer" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent-primary)' }}>créer →</a>
        </>
      ) : done ? (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--success, #4caf50)' }}>✓ ajouté</span>
      ) : (
        <>
          <select
            value={picked ?? ''}
            onChange={e => setPicked(e.target.value ? parseInt(e.target.value) : null)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)',
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', borderRadius: 2, padding: '2px 4px',
            }}
          >
            <option value="">— dataset —</option>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <Button variant="primary" onClick={add} disabled={picked == null || adding}>
            {adding ? '…' : 'Ajouter'}
          </Button>
        </>
      )}
      <button type="button" onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>×</button>
    </div>
  );
}

function ScoresTable({
  scores, currentUserId, onDeleteMine,
}: { scores: ScoreRow[]; currentUserId: number; onDeleteMine: (id: number) => void }) {
  if (scores.length === 0) {
    return <p className={styles.placeholderHint}>Aucun score pour le moment. Les heuristiques s'exécutent automatiquement après chaque analyse IA ; clique « Relancer scorers auto » pour inclure le llm-judge.</p>;
  }

  const kindIcon: Record<ScoreRow['scorer_kind'], string> = {
    heuristic: '⚙',
    'llm-judge': '🤖',
    human: '🧑',
  };

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>
        <thead>
          <tr style={{ background: 'var(--bg-secondary, rgba(128,128,128,0.05))', color: 'var(--text-secondary)' }}>
            <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>kind</th>
            <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>name</th>
            <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>value</th>
            <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>rationale</th>
            <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>by / when</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {scores.map(s => {
            const n = parseFloat(s.score_value);
            const mine = s.scorer_kind === 'human' && s.annotator_user_id === currentUserId;
            const valueDisplay = s.scorer_kind === 'human' && (n === 1 || n === -1)
              ? (n === 1 ? '👍' : '👎')
              : Number.isFinite(n) ? n.toFixed(2) : s.score_value;
            return (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{kindIcon[s.scorer_kind]} {s.scorer_kind}</td>
                <td style={{ padding: '6px 10px', color: 'var(--text-primary)' }}>{s.score_name}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--accent-primary)', fontWeight: 600 }}>{valueDisplay}</td>
                <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', maxWidth: 400, wordBreak: 'break-word' }}>{s.rationale ?? '—'}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                  {s.scorer_kind === 'human' ? `user #${s.annotator_user_id}` : s.scorer_id ?? '—'}
                  <br />
                  {new Date(s.created_at).toLocaleString('fr-FR')}
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                  {mine && (
                    <button
                      type="button"
                      onClick={() => onDeleteMine(s.id)}
                      title="Retirer mon vote"
                      style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}
                    >✕</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
