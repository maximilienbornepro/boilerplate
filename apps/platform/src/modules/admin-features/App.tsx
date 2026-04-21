import { useEffect, useState, useMemo } from 'react';
import { Layout, LoadingSpinner, ModuleHeader, Button, useGatewayUser } from '@boilerplate/shared/components';
import './App.css';

/** Row shape returned by GET /platform/settings (admin). */
interface Setting {
  key: string;
  value: string; // 'true' | 'false'
  description: string | null;
  updated_at: string;
}

/** Group label derived from the setting key prefix. Unknown prefixes
 *  fall into "Autres" so nothing is silently hidden. */
function groupOf(key: string): 'Connecteurs' | 'Modules' | 'Intégrations' | 'Autres' {
  if (key.startsWith('connector_')) return 'Connecteurs';
  if (key.startsWith('module_')) return 'Modules';
  if (key.startsWith('integration_')) return 'Intégrations';
  return 'Autres';
}

/** Human-readable label extracted from the key — strips the prefix
 *  + replaces underscores with spaces + Title Cases. The DB
 *  description is shown as a sub-line. */
function prettyLabel(key: string): string {
  const stripped = key
    .replace(/^connector_/, '')
    .replace(/^module_/, '')
    .replace(/^integration_/, '')
    .replace(/_enabled$/, '')
    .replace(/_/g, ' ');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function AdminFeaturesApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const user = useGatewayUser();
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.isAdmin) return;
    void load();
  }, [user?.isAdmin]);

  async function load() {
    try {
      const res = await fetch('/api/platform/settings', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Setting[];
      setSettings(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement échoué');
    }
  }

  async function toggle(key: string, next: boolean) {
    setSaving(prev => { const s = new Set(prev); s.add(key); return s; });
    // Optimistic update so the toggle feels instant.
    setSettings(prev => prev?.map(s => s.key === key ? { ...s, value: next ? 'true' : 'false' } : s) ?? null);
    try {
      const res = await fetch(`/api/platform/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: next ? 'true' : 'false' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Revert on failure.
      setSettings(prev => prev?.map(s => s.key === key ? { ...s, value: next ? 'false' : 'true' } : s) ?? null);
      setError(err instanceof Error ? err.message : 'Mise à jour échouée');
    } finally {
      setSaving(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }

  const grouped = useMemo(() => {
    if (!settings) return null;
    const map = new Map<string, Setting[]>();
    for (const s of settings) {
      const g = groupOf(s.key);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    // Stable order : Connecteurs, Modules, Intégrations, Autres.
    const order: Array<'Connecteurs' | 'Modules' | 'Intégrations' | 'Autres'> = ['Connecteurs', 'Modules', 'Intégrations', 'Autres'];
    return order.filter(o => map.has(o)).map(o => [o, map.get(o)!] as const);
  }, [settings]);

  // Same auth-gate pattern as /ai-logs : show a spinner while the
  // gateway user is loading, a friendly 403 card if the user is not
  // an admin, the real page otherwise. No redirect — the burger menu
  // still shows so they can leave.
  if (!user) {
    return (
      <Layout appId="admin-features" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem' }}><LoadingSpinner message="Chargement..." /></div>
      </Layout>
    );
  }
  if (!user.isAdmin) {
    return (
      <Layout appId="admin-features" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>403</h1>
          <p>Cette page est réservée aux administrateurs.</p>
          <Button variant="secondary" onClick={() => onNavigate?.('/')}>Retour</Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout appId="admin-features" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader title="Fonctionnalités" onBack={() => onNavigate?.('/')} />
      <div className="admin-features-page">
        <p className="admin-features-intro">
          Active ou désactive les fonctionnalités globales de la plateforme. Les réglages s'appliquent à tous les utilisateurs.
        </p>
        {error && <div className="admin-features-error">⚠ {error}</div>}
        {!settings ? (
          <LoadingSpinner message="Chargement…" />
        ) : grouped && grouped.length > 0 ? (
          grouped.map(([group, items]) => (
            <section key={group} className="admin-features-group">
              <h2 className="admin-features-group-title">{group}</h2>
              <ul className="admin-features-list">
                {items.map(s => {
                  const isOn = s.value === 'true';
                  const isSaving = saving.has(s.key);
                  return (
                    <li key={s.key} className={`admin-features-row ${isOn ? 'admin-features-row--on' : 'admin-features-row--off'}`}>
                      <div className="admin-features-row-info">
                        <div className="admin-features-row-label">{prettyLabel(s.key)}</div>
                        {s.description && <div className="admin-features-row-desc">{s.description}</div>}
                        <code className="admin-features-row-key">{s.key}</code>
                      </div>
                      <button
                        type="button"
                        className={`admin-features-toggle ${isOn ? 'admin-features-toggle--on' : ''}`}
                        onClick={() => toggle(s.key, !isOn)}
                        disabled={isSaving}
                        aria-pressed={isOn}
                        aria-label={`${isOn ? 'Désactiver' : 'Activer'} ${prettyLabel(s.key)}`}
                      >
                        <span className="admin-features-toggle-knob" />
                        <span className="admin-features-toggle-text">{isSaving ? '…' : isOn ? 'ON' : 'OFF'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        ) : (
          <div className="admin-features-empty">Aucun réglage.</div>
        )}
      </div>
    </Layout>
  );
}

export default AdminFeaturesApp;
