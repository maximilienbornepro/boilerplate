import { useEffect, useState } from 'react';
import { Card, Badge, Button, SectionTitle, LoadingSpinner, ConfirmModal } from '@boilerplate/shared/components';

// Admin → AI Skills : list the skills exposed by the backend registry, edit
// the markdown content used in AI prompts, or restore the shipped default.

interface SkillListItem {
  slug: string;
  name: string;
  description: string;
  usage: { module: string; endpoint: string; trigger: string };
  isCustomized: boolean;
  updatedAt: string | null;
  updatedByUserId: number | null;
}

interface SkillDetail extends SkillListItem {
  content: string;
  defaultContent: string;
}

interface Props {
  onToast: (msg: { type: 'success' | 'error' | 'info'; message: string }) => void;
}

export function AdminAiSkillsSection({ onToast }: Props) {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SkillDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/ai-skills/api', { credentials: 'include' });
      if (!res.ok) throw new Error('Chargement impossible');
      setSkills(await res.json());
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openEditor = async (slug: string) => {
    try {
      const res = await fetch(`/ai-skills/api/${slug}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Impossible de charger ce skill');
      const detail: SkillDetail = await res.json();
      setEditing(detail);
      setDraft(detail.content);
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (draft.trim().length === 0) {
      onToast({ type: 'error', message: 'Le contenu est vide' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/ai-skills/api/${editing.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur');
      onToast({ type: 'success', message: `Skill "${editing.name}" mis à jour` });
      setEditing(null);
      await load();
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setSaving(false);
    }
  };

  const reset = async (slug: string) => {
    try {
      const res = await fetch(`/ai-skills/api/${slug}/reset`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Erreur');
      onToast({ type: 'success', message: 'Skill restauré à la version par défaut' });
      setConfirmReset(null);
      if (editing?.slug === slug) {
        // Re-fetch detail so the editor reflects the restored content.
        await openEditor(slug);
      }
      await load();
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
      setConfirmReset(null);
    }
  };

  // ── Editor ──
  if (editing) {
    const dirty = draft !== editing.content;
    const sameAsDefault = draft === editing.defaultContent;
    return (
      <section className="admin-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)' }}>
          <SectionTitle>Éditer : {editing.name}</SectionTitle>
          <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
            <Button variant="secondary" onClick={() => setEditing(null)}>Retour</Button>
            <Button variant="secondary" onClick={() => setConfirmReset(editing.slug)} disabled={sameAsDefault && !editing.isCustomized}>
              Restaurer par défaut
            </Button>
            <Button variant="primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>

        <Card>
          <p className="shared-card__subtitle" style={{ marginBottom: 'var(--spacing-xs)' }}>{editing.description}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            <div><strong>Module :</strong> {editing.usage.module}</div>
            <div><strong>Endpoint :</strong> <code>{editing.usage.endpoint}</code></div>
            <div><strong>Déclenché quand :</strong> {editing.usage.trigger}</div>
            {editing.isCustomized && (
              <div style={{ marginTop: 'var(--spacing-xs)' }}>
                <Badge type="warning">Modifié en base</Badge>
                {editing.updatedAt && <span style={{ marginLeft: 8 }}>Dernière modif : {new Date(editing.updatedAt).toLocaleString('fr-FR')}</span>}
              </div>
            )}
          </div>
        </Card>

        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 500,
            marginTop: 'var(--spacing-md)',
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

        {confirmReset && (
          <ConfirmModal
            title="Restaurer par défaut ?"
            message="Le contenu éditable sera remplacé par la version livrée dans le dépôt. Toute modification sera perdue."
            confirmLabel="Restaurer"
            cancelLabel="Annuler"
            danger
            onConfirm={() => reset(confirmReset)}
            onCancel={() => setConfirmReset(null)}
          />
        )}
      </section>
    );
  }

  // ── List ──
  return (
    <section className="admin-section">
      <SectionTitle>Skills IA</SectionTitle>
      <p className="admin-section-description">
        Prompts markdown utilisés dans les appels IA. Éditer ici surcharge le fichier livré ; « Restaurer par défaut » recopie le fichier dans la DB.
      </p>

      {loading ? (
        <LoadingSpinner message="Chargement des skills…" />
      ) : skills.length === 0 ? (
        <p className="admin-empty">Aucun skill enregistré.</p>
      ) : (
        <div className="admin-users">
          {skills.map(s => (
            <Card key={s.slug} className="admin-user-card">
              <div className="admin-user-row">
                <div className="admin-user-info">
                  <div className="admin-user-name-row">
                    <span className="shared-card__title">{s.name}</span>
                    <Badge type={s.isCustomized ? 'warning' : 'success'}>
                      {s.isCustomized ? 'Modifié' : 'Défaut'}
                    </Badge>
                    <Badge type="accent">{s.usage.module}</Badge>
                  </div>
                  <span className="shared-card__subtitle">{s.description}</span>
                  <div style={{ marginTop: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                    <code>{s.slug}</code>
                    {s.updatedAt && <span style={{ marginLeft: 8 }}>· modifié le {new Date(s.updatedAt).toLocaleString('fr-FR')}</span>}
                  </div>
                </div>
                <div className="admin-user-actions">
                  <Button variant="primary" onClick={() => openEditor(s.slug)}>Éditer</Button>
                  {s.isCustomized && (
                    <Button variant="secondary" onClick={() => setConfirmReset(s.slug)}>Restaurer</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {confirmReset && !editing && (
        <ConfirmModal
          title="Restaurer par défaut ?"
          message="Le contenu éditable sera remplacé par la version livrée dans le dépôt. Toute modification sera perdue."
          confirmLabel="Restaurer"
          cancelLabel="Annuler"
          danger
          onConfirm={() => reset(confirmReset)}
          onCancel={() => setConfirmReset(null)}
        />
      )}
    </section>
  );
}
