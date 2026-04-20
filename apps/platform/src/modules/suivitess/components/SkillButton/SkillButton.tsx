import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Button } from '@boilerplate/shared/components';
import styles from './SkillButton.module.css';

// Wraps an action button (e.g. "Analyser") and exposes :
//   (1) the skill (or pipeline) used by that action, visible on hover + a
//       persistent caption below the button
//   (2) an inline "Éditer" action that opens a panel where every skill in
//       the pipeline can be edited individually — same endpoints as the
//       admin page.
//
// Two modes :
//   - Single skill (legacy path) : pass `skillSlug="…"`.
//   - Multi-skill pipeline : pass `pipeline={[{tier, label, slugs}, …]}`.
//     Use when an action orchestrates multiple skills (e.g. the suivitess
//     modular pipeline extract → place → write).

interface SkillMeta {
  slug: string;
  name: string;
  description: string;
  content: string;
  defaultContent: string;
  isCustomized: boolean;
}

export interface PipelineStep {
  /** Short tag shown in the UI, e.g. "T1", "T2", "T3". */
  tier: string;
  /** Human label, e.g. "Extract", "Place", "Write". */
  label: string;
  /** Slugs executed at this tier. Multiple = alternatives (e.g. extractor
   *  per source kind) OR parallel (e.g. writers per placement). */
  slugs: string[];
}

interface Props {
  /** Legacy : single skill behind the action. */
  skillSlug?: string;
  /** Preferred for multi-skill orchestrations. Takes precedence over
   *  skillSlug if both are passed. */
  pipeline?: PipelineStep[];
  /** The actual button or any trigger element. */
  children: ReactNode;
  /** Optional — hide the hover tooltip (useful when the button is disabled). */
  disabled?: boolean;
  /** Show a persistent caption below the button. Default: true. */
  showCaption?: boolean;
}

const HOVER_DELAY_MS = 250;

export function SkillButton({ skillSlug, pipeline, children, disabled, showCaption = true }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SkillMeta | null>(null);
  const [metaBySlug, setMetaBySlug] = useState<Record<string, SkillMeta>>({});
  const [loadingSlugs, setLoadingSlugs] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef<number | null>(null);

  // Flatten every slug we need to load.
  const allSlugs = pipeline
    ? Array.from(new Set(pipeline.flatMap(p => p.slugs)))
    : skillSlug
      ? [skillSlug]
      : [];

  const fetchMeta = useCallback(async (slug: string) => {
    if (metaBySlug[slug]) return;
    setLoadingSlugs(prev => new Set(prev).add(slug));
    try {
      const res = await fetch(`/ai-skills/api/${slug}`, { credentials: 'include' });
      if (res.ok) {
        const m: SkillMeta = await res.json();
        setMetaBySlug(prev => ({ ...prev, [slug]: m }));
      }
    } finally {
      setLoadingSlugs(prev => { const n = new Set(prev); n.delete(slug); return n; });
    }
  }, [metaBySlug]);

  // Load every skill's metadata on mount so the caption + tooltip + edit
  // panel render immediately without per-hover delay.
  useEffect(() => {
    allSlugs.forEach(s => { void fetchMeta(s); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSlugs.join(',')]);

  const openTooltip = () => {
    if (disabled) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };
  const closeTooltip = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
  };
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const openEditorFor = (slug: string) => {
    const m = metaBySlug[slug];
    if (!m) return;
    setEditing(m);
    setDraft(m.content);
    setOpen(false);
    setError('');
  };

  const save = async () => {
    if (!editing) return;
    if (draft.trim().length === 0) { setError('Contenu vide'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/ai-skills/api/${editing.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const updated = { ...editing, content: draft, isCustomized: true };
      setMetaBySlug(prev => ({ ...prev, [editing.slug]: updated }));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSaving(false); }
  };

  const resetDefault = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    try {
      const res = await fetch(`/ai-skills/api/${editing.slug}/reset`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft(editing.defaultContent);
      const updated = { ...editing, content: editing.defaultContent, isCustomized: false };
      setMetaBySlug(prev => ({ ...prev, [editing.slug]: updated }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSaving(false); }
  };

  // ── Caption / tooltip wording ──
  const totalSkills = allSlugs.length;
  const tierCount = pipeline?.length ?? 1;
  const captionLabel = pipeline
    ? `pipeline ${tierCount} tier${tierCount > 1 ? 's' : ''} · ${totalSkills} skill${totalSkills > 1 ? 's' : ''}`
    : (loadingSlugs.size > 0 ? '…' : (metaBySlug[skillSlug ?? '']?.name ?? skillSlug ?? ''));

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
      onFocus={openTooltip}
      onBlur={closeTooltip}
    >
      {children}

      {showCaption && (
        <button
          type="button"
          className={styles.caption}
          onClick={(e) => {
            e.preventDefault(); e.stopPropagation();
            // Open the first skill of the pipeline as a pragmatic default.
            // User can navigate to others via the tooltip's list.
            if (pipeline && pipeline.length > 0) setOpen(true);
            else if (skillSlug) openEditorFor(skillSlug);
          }}
          title={pipeline ? 'Voir la pipeline et éditer un skill' : 'Éditer le skill IA utilisé par ce bouton'}
        >
          {!pipeline && <span className={styles.captionLabel}>skill :</span>}
          <span className={styles.captionName}>
            {captionLabel}
          </span>
        </button>
      )}

      {open && !editing && (
        <div className={styles.tooltip} role="tooltip">
          <div className={styles.tooltipTitle}>
            {pipeline ? 'Pipeline IA' : 'Skill IA utilisé'}
          </div>
          {!pipeline && skillSlug && (
            <>
              <div className={styles.tooltipName}>
                {loadingSlugs.has(skillSlug) ? 'Chargement…' : (metaBySlug[skillSlug]?.name ?? skillSlug)}
              </div>
              {metaBySlug[skillSlug]?.description && (
                <div className={styles.tooltipDesc}>{metaBySlug[skillSlug]!.description}</div>
              )}
              <div className={styles.tooltipActions}>
                <button
                  type="button"
                  className={styles.editBtn}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditorFor(skillSlug); }}
                  disabled={!metaBySlug[skillSlug]}
                >
                  Éditer le skill
                </button>
              </div>
            </>
          )}
          {pipeline && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 320 }}>
              {pipeline.map((step, stepIdx) => (
                <div key={step.tier + stepIdx}>
                  <div style={{
                    fontSize: 11, fontWeight: 700,
                    color: 'var(--accent-primary)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{
                      padding: '1px 6px',
                      background: 'var(--accent-primary)', color: '#0a0a0a',
                      borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 10,
                    }}>
                      {step.tier}
                    </span>
                    {step.label}
                    {step.slugs.length > 1 && (
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 400 }}>
                        ({step.slugs.length} {step.slugs.length > 1 ? 'alternatives' : 'skill'})
                      </span>
                    )}
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {step.slugs.map(slug => {
                      const m = metaBySlug[slug];
                      return (
                        <li key={slug}>
                          <button
                            type="button"
                            className={styles.pipelineItem}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditorFor(slug); }}
                            disabled={!m}
                          >
                            <span>•</span>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m?.name ?? (loadingSlugs.has(slug) ? '…' : slug)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <Modal title={`Éditer : ${editing.name}`} onClose={() => setEditing(null)} size="xl">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              {editing.description}
            </div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: 400,
                padding: 'var(--spacing-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-sm)',
                lineHeight: 1.5,
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                resize: 'vertical',
              }}
            />
            {error && (
              <div style={{ color: 'var(--error)', fontSize: 'var(--font-size-sm)' }}>{error}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-xs)' }}>
              <Button variant="secondary" onClick={resetDefault} disabled={saving || !editing.isCustomized}>
                Restaurer par défaut
              </Button>
              <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                <Button variant="secondary" onClick={() => setEditing(null)}>Annuler</Button>
                <Button variant="primary" onClick={save} disabled={saving || draft === editing.content}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </span>
  );
}
