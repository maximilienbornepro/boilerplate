import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Button } from '@boilerplate/shared/components';
import styles from './SkillButton.module.css';

// Wraps an action button (e.g. "Analyser") and exposes, on hover, the skill
// used by that action + an inline "Éditer" action that opens a lightweight
// editor (same endpoints as the admin page).

interface SkillMeta {
  slug: string;
  name: string;
  description: string;
  content: string;
  defaultContent: string;
  isCustomized: boolean;
}

interface Props {
  /** Slug of the skill behind the action. */
  skillSlug: string;
  /** The actual button or any trigger element. */
  children: ReactNode;
  /** Optional — hide the hover tooltip (useful when the button is disabled). */
  disabled?: boolean;
  /** Show a persistent "skill: ✎ edit" caption below the button instead of
   *  relying only on the hover tooltip. Default: true. */
  showCaption?: boolean;
}

const HOVER_DELAY_MS = 250;

export function SkillButton({ skillSlug, children, disabled, showCaption = true }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [meta, setMeta] = useState<SkillMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef<number | null>(null);

  const fetchMeta = useCallback(async () => {
    if (meta || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/ai-skills/api/${skillSlug}`, { credentials: 'include' });
      if (res.ok) setMeta(await res.json());
    } finally { setLoading(false); }
  }, [meta, loading, skillSlug]);

  // Load meta on mount so the caption shows the real skill name immediately.
  useEffect(() => {
    fetchMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillSlug]);

  const openTooltip = () => {
    if (disabled) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpen(true);
      fetchMeta();
    }, HOVER_DELAY_MS);
  };

  const closeTooltip = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
  };

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const openEditor = () => {
    if (!meta) return;
    setDraft(meta.content);
    setEditing(true);
    setOpen(false);
    setError('');
  };

  const save = async () => {
    if (!meta) return;
    if (draft.trim().length === 0) { setError('Contenu vide'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`/ai-skills/api/${meta.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setMeta({ ...meta, content: draft, isCustomized: true });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSaving(false); }
  };

  const resetDefault = async () => {
    if (!meta) return;
    setSaving(true); setError('');
    try {
      const res = await fetch(`/ai-skills/api/${meta.slug}/reset`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft(meta.defaultContent);
      setMeta({ ...meta, content: meta.defaultContent, isCustomized: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSaving(false); }
  };

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
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditor(); }}
          title="Éditer le skill IA utilisé par ce bouton"
          disabled={!meta}
        >
          <span className={styles.captionLabel}>skill :</span>
          <span className={styles.captionName}>
            {loading ? '…' : (meta?.name ?? skillSlug)}
          </span>
          <span className={styles.captionEdit}>✎ éditer</span>
        </button>
      )}

      {open && !editing && (
        <div className={styles.tooltip} role="tooltip">
          <div className={styles.tooltipTitle}>Skill IA utilisé</div>
          <div className={styles.tooltipName}>
            {loading ? 'Chargement…' : (meta?.name ?? skillSlug)}
          </div>
          {meta?.description && (
            <div className={styles.tooltipDesc}>{meta.description}</div>
          )}
          <div className={styles.tooltipActions}>
            <button
              type="button"
              className={styles.editBtn}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditor(); }}
              disabled={!meta}
            >
              Éditer le skill
            </button>
          </div>
        </div>
      )}

      {editing && meta && (
        <Modal title={`Éditer : ${meta.name}`} onClose={() => setEditing(false)} size="xl">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              {meta.description}
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
              <Button variant="secondary" onClick={resetDefault} disabled={saving || !meta.isCustomized}>
                Restaurer par défaut
              </Button>
              <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
                <Button variant="secondary" onClick={() => setEditing(false)}>Annuler</Button>
                <Button variant="primary" onClick={save} disabled={saving || draft === meta.content}>
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
