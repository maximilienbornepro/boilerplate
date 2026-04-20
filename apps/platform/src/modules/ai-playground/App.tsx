import { useCallback, useEffect, useState } from 'react';
import { Layout, Button, LoadingSpinner, Toast, useGatewayUser } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { AssistantFlow } from '../ai-improve-assistant/App';
import styles from './AiPlayground.module.css';

// Admin-only playground : edit N prompt variants and M inputs, hit "Run all"
// and get a matrix of outputs with scores, cost, and tokens per cell.
// Each cell is also persisted as a regular ai_analysis_logs row so it can be
// inspected from /ai-logs and added to a dataset from there.

interface Skill {
  slug: string;
  name: string;
  description: string;
}

interface Variant { label: string; content: string }
interface InputEntry { label: string; content: string }

interface RecentInput {
  id: number;
  skill_slug: string;
  source_kind: string | null;
  source_title: string | null;
  input_preview: string;
  input_length: number;
  created_at: string;
}

interface Cell {
  variantIndex: number;
  inputIndex: number;
  variantLabel: string;
  inputLabel: string;
  logId: number | null;
  output: string;
  error: string | null;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  scores: Array<{ name: string; kind: string; value: number; rationale: string | null }>;
}

interface RunResult {
  skillSlug: string;
  variants: Array<{ label: string; shortHash: string }>;
  inputs: Array<{ label: string }>;
  cells: Cell[];
}

function formatCost(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 0.1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

// Source tagging — shared with the recent-inputs picker.
const SOURCE_KINDS: Array<{ value: string; label: string; icon: string }> = [
  { value: '',          label: 'Toutes les sources', icon: '✦' },
  { value: 'transcript', label: 'Transcription',     icon: '🎙' },
  { value: 'slack',      label: 'Slack',             icon: '💬' },
  { value: 'outlook',    label: 'Outlook',           icon: '✉' },
  { value: 'gmail',      label: 'Gmail',             icon: '📧' },
  { value: 'subject',    label: 'Sujet',             icon: '📌' },
  { value: 'board',      label: 'Board delivery',    icon: '📊' },
];
function kindBadge(kind: string | null): { icon: string; label: string; color: string } {
  const k = (kind ?? '').toLowerCase();
  if (k === 'transcript' || k === 'fathom' || k === 'otter') return { icon: '🎙', label: 'transcription', color: 'var(--accent-primary)' };
  if (k === 'slack')   return { icon: '💬', label: 'slack',   color: '#4a154b' };
  if (k === 'outlook') return { icon: '✉',  label: 'outlook', color: '#0072c6' };
  if (k === 'gmail')   return { icon: '📧', label: 'gmail',   color: '#ea4335' };
  if (k === 'subject') return { icon: '📌', label: 'sujet',   color: '#6c757d' };
  if (k === 'board')   return { icon: '📊', label: 'board',   color: '#17a2b8' };
  return { icon: '✦', label: k || '—', color: 'var(--text-secondary)' };
}

export default function AiPlaygroundApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { user, loading: authLoading } = useGatewayUser();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillSlug, setSkillSlug] = useState<string>('');
  const [loadingSkill, setLoadingSkill] = useState(false);

  const [variants, setVariants] = useState<Variant[]>([{ label: 'current', content: '' }]);
  const [inputs, setInputs] = useState<InputEntry[]>([{ label: 'input 1', content: '' }]);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  // "Depuis un log" picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<string>('');
  const [recentInputs, setRecentInputs] = useState<RecentInput[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const [toasts, setToasts] = useState<ToastData[]>([]);
  const addToast = useCallback((t: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...t, id: String(Date.now()) + Math.random() }]);
  }, []);
  const dismissToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // Load skills list for the dropdown.
  useEffect(() => {
    fetch('/ai-skills/api', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Skill[]) => {
        const nonJudge = rows.filter(s => !s.slug.startsWith('llm-judge'));
        setSkills(nonJudge);
        if (nonJudge.length > 0 && !skillSlug) setSkillSlug(nonJudge[0].slug);
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a skill is picked, load its current content into the first variant.
  useEffect(() => {
    if (!skillSlug) return;
    setLoadingSkill(true);
    fetch(`/ai-skills/api/${skillSlug}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { content?: string } | null) => {
        if (d?.content) {
          setVariants(prev => {
            const cp = [...prev];
            cp[0] = { label: 'current', content: d.content! };
            return cp;
          });
        }
      })
      .finally(() => setLoadingSkill(false));
  }, [skillSlug]);

  // ── Guards ──
  if (authLoading) {
    return (
      <Layout appId="ai-playground" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem' }}><LoadingSpinner message="Chargement..." /></div>
      </Layout>
    );
  }
  if (!user?.isAdmin) {
    return (
      <Layout appId="ai-playground" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>403</h1>
          <p>Cette page est réservée aux administrateurs.</p>
        </div>
      </Layout>
    );
  }

  const runAll = async () => {
    if (!skillSlug) return;
    const okVariants = variants.filter(v => v.content.trim().length > 0);
    const okInputs = inputs.filter(i => i.content.trim().length > 0);
    if (okVariants.length === 0 || okInputs.length === 0) {
      addToast({ type: 'error', message: 'Fournir au moins 1 variant et 1 input non-vide' });
      return;
    }
    if (okVariants.length * okInputs.length > 40) {
      addToast({ type: 'error', message: 'Matrice trop grande (max 40 cellules)' });
      return;
    }
    setRunning(true);
    try {
      const res = await fetch('/ai-skills/api/playground/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ skillSlug, variants: okVariants, inputs: okInputs }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const data: RunResult = await res.json();
      setResult(data);
      addToast({ type: 'success', message: `${data.cells.length} cellules exécutées` });
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally { setRunning(false); }
  };

  const addVariant = () => setVariants(v => [...v, { label: `variant ${v.length + 1}`, content: variants[0]?.content ?? '' }]);
  const removeVariant = (i: number) => setVariants(v => v.filter((_, idx) => idx !== i));
  const patchVariant = (i: number, patch: Partial<Variant>) =>
    setVariants(v => v.map((x, idx) => idx === i ? { ...x, ...patch } : x));

  const addInput = () => setInputs(i => [...i, { label: `input ${i.length + 1}`, content: '' }]);
  const removeInput = (i: number) => setInputs(inps => inps.filter((_, idx) => idx !== i));
  const patchInput = (i: number, patch: Partial<InputEntry>) =>
    setInputs(inps => inps.map((x, idx) => idx === i ? { ...x, ...patch } : x));

  const loadRecentInputs = useCallback(async () => {
    if (!skillSlug) return;
    setLoadingRecent(true);
    try {
      const params = new URLSearchParams();
      params.set('skill', skillSlug);
      params.set('limit', '60');
      if (pickerKind) params.set('source', pickerKind);
      const r = await fetch(`/ai-skills/api/logs/recent-inputs?${params.toString()}`, { credentials: 'include' });
      if (r.ok) setRecentInputs(await r.json());
    } finally { setLoadingRecent(false); }
  }, [skillSlug, pickerKind]);

  // Refresh when picker is opened OR when filters change.
  useEffect(() => {
    if (pickerOpen) loadRecentInputs();
  }, [pickerOpen, loadRecentInputs]);

  const importFromLog = async (row: RecentInput) => {
    // Fetch the full input (the preview is truncated at 300 chars).
    const r = await fetch(`/ai-skills/api/logs/${row.id}`, { credentials: 'include' });
    const detail = r.ok ? await r.json() : null;
    const full = (detail?.input_content as string | undefined) ?? row.input_preview;
    const label = row.source_title
      ? row.source_title.slice(0, 80)
      : `log #${row.id}`;

    // Replace the first empty input, or append a new one.
    setInputs(prev => {
      const emptyIdx = prev.findIndex(x => !x.content.trim());
      if (emptyIdx >= 0) {
        const cp = [...prev];
        cp[emptyIdx] = { label, content: full };
        return cp;
      }
      return [...prev, { label, content: full }];
    });
    addToast({ type: 'success', message: `Input « ${label} » importé` });
  };

  return (
    <Layout appId="ai-playground" variant="full-width" onNavigate={onNavigate}>
      <div className={styles.root}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>$ ai-playground</h1>
            <p className={styles.subtitle}>
              Compare N variantes de prompts × M inputs. Chaque cellule est loggée et scorée ; une matrice détaillée est rendue ci-dessous.
            </p>
          </div>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setAssistantOpen(true)}>
              🚀 Améliorer
            </Button>
            <Button variant="primary" onClick={runAll} disabled={running || loadingSkill || !skillSlug}>
              {running ? 'Exécution…' : `▶ Run all (${variants.filter(v => v.content.trim()).length} × ${inputs.filter(i => i.content.trim()).length})`}
            </Button>
          </div>
        </header>

        <div className={styles.skillPicker}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Skill :</span>
          <select
            className={styles.skillSelect}
            value={skillSlug}
            onChange={e => setSkillSlug(e.target.value)}
          >
            {skills.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </select>
          {loadingSkill && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Chargement skill…</span>}
        </div>

        <div className={styles.editorsGrid}>
          <div className={styles.editorCol}>
            <h3 className={styles.colTitle}>Variants ({variants.length})</h3>
            {variants.map((v, i) => (
              <div key={i} className={styles.row}>
                <input
                  className={styles.labelInput}
                  value={v.label}
                  onChange={e => patchVariant(i, { label: e.target.value })}
                  placeholder="label"
                />
                <textarea
                  className={styles.contentTextarea}
                  value={v.content}
                  onChange={e => patchVariant(i, { content: e.target.value })}
                  placeholder="Contenu du skill pour cette variant…"
                  spellCheck={false}
                />
                {variants.length > 1 && (
                  <button type="button" className={styles.removeBtn} onClick={() => removeVariant(i)}>×</button>
                )}
              </div>
            ))}
            <button type="button" className={styles.addRow} onClick={addVariant}>+ ajouter une variant</button>
          </div>

          <div className={styles.editorCol}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <h3 className={styles.colTitle}>Inputs ({inputs.length})</h3>
              <button
                type="button"
                className={styles.addRow}
                onClick={() => setPickerOpen(v => !v)}
                style={{ margin: 0 }}
              >
                {pickerOpen ? '× fermer' : '📥 Depuis un log…'}
              </button>
            </div>

            {pickerOpen && (
              <RecentInputPicker
                kindFilter={pickerKind}
                setKindFilter={setPickerKind}
                loading={loadingRecent}
                rows={recentInputs}
                onPick={importFromLog}
              />
            )}

            {inputs.map((inp, i) => (
              <div key={i} className={styles.row}>
                <input
                  className={styles.labelInput}
                  value={inp.label}
                  onChange={e => patchInput(i, { label: e.target.value })}
                  placeholder="label"
                />
                <textarea
                  className={styles.contentTextarea}
                  value={inp.content}
                  onChange={e => patchInput(i, { content: e.target.value })}
                  placeholder="Contenu de l'input (transcription, mail, texte…)"
                  spellCheck={false}
                />
                {inputs.length > 1 && (
                  <button type="button" className={styles.removeBtn} onClick={() => removeInput(i)}>×</button>
                )}
              </div>
            ))}
            <button type="button" className={styles.addRow} onClick={addInput}>+ ajouter un input</button>
          </div>
        </div>

        {/* Result matrix */}
        {result && (
          <div className={styles.matrixWrap}>
            <table className={styles.matrix}>
              <thead>
                <tr>
                  <th style={{ minWidth: 120 }}>—</th>
                  {result.inputs.map((inp, i) => (
                    <th key={i}>{inp.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.variants.map((v, vi) => (
                  <tr key={vi}>
                    <th>
                      {v.label}
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400, marginTop: 2 }}>v {v.shortHash}</div>
                    </th>
                    {result.inputs.map((_, ii) => {
                      const cell = result.cells.find(c => c.variantIndex === vi && c.inputIndex === ii);
                      if (!cell) return <td key={ii}>—</td>;
                      return (
                        <td key={ii}>
                          <div className={styles.cellOutput}>{cell.output || '(vide)'}</div>
                          {cell.error && <div className={styles.cellError}>{cell.error}</div>}
                          <div className={styles.cellMeta}>
                            <span>{cell.durationMs} ms</span>
                            <span>{formatCost(cell.costUsd)}</span>
                            <span>{cell.inputTokens}/{cell.outputTokens} tk</span>
                            {cell.logId != null && <a href={`/ai-logs/${cell.logId}`} target="_blank" rel="noreferrer">log #{cell.logId}</a>}
                          </div>
                          {cell.scores.length > 0 && (
                            <div className={styles.cellScores}>
                              {cell.scores.map((s, si) => (
                                <div key={si} className={styles.cellScoreRow}>
                                  <span>{s.kind}:{s.name}</span>
                                  <span className={styles.cellScoreValue}>{s.value.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ position: 'fixed', top: 60, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1000 }}>
        {toasts.map(t => (
          <Toast key={t.id} toast={t} onClose={() => dismissToast(t.id)} />
        ))}
      </div>

      <AssistantFlow
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        initialSkillSlug={skillSlug || null}
      />
    </Layout>
  );
}

// ── Recent input picker ─────────────────────────────────────────────

function RecentInputPicker({
  kindFilter, setKindFilter, loading, rows, onPick,
}: {
  kindFilter: string;
  setKindFilter: (v: string) => void;
  loading: boolean;
  rows: RecentInput[];
  onPick: (row: RecentInput) => void;
}) {
  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-secondary, rgba(128,128,128,0.05))',
      padding: 'var(--spacing-xs)',
      marginBottom: 'var(--spacing-xs)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--spacing-xs)',
      maxHeight: 360,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {SOURCE_KINDS.map(s => (
          <button
            key={s.value || 'all'}
            type="button"
            onClick={() => setKindFilter(s.value)}
            style={{
              padding: '3px 8px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              background: kindFilter === s.value ? 'var(--accent-primary)' : 'transparent',
              color: kindFilter === s.value ? '#000' : 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 2,
              cursor: 'pointer',
              fontWeight: kindFilter === s.value ? 600 : 400,
            }}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>Chargement…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
            Aucun log correspondant pour ce skill.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map(r => {
              const badge = kindBadge(r.source_kind);
              return (
                <li key={r.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <button
                    type="button"
                    onClick={() => onPick(r)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '6px 8px', background: 'transparent', border: 'none',
                      cursor: 'pointer', fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)',
                    }}
                    onMouseDown={e => (e.currentTarget.style.background = 'var(--bg-primary)')}
                    onMouseUp={e => (e.currentTarget.style.background = 'transparent')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '1px 6px',
                        borderRadius: 2,
                        background: badge.color,
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 600,
                      }}>
                        {badge.icon} {badge.label}
                      </span>
                      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.source_title || '(sans titre)'}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        #{r.id} · {r.input_length} chars
                      </span>
                    </div>
                    <div style={{
                      fontSize: 11, color: 'var(--text-secondary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {r.input_preview}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
