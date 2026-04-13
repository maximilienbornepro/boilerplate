import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../Modal/Modal.js';
import { VisibilityPicker } from './VisibilityPicker.js';
import type { Visibility } from './VisibilityPicker.js';
import styles from './SharingModal.module.css';

export interface SharingConfig {
  ownerId: number;
  visibility: string;
  shares: Array<{ userId: number; email: string }>;
}

export interface SharingModalProps {
  resourceType: 'roadmap' | 'delivery' | 'suivitess';
  resourceId: string;
  resourceName: string;
  apiBase?: string;
  onClose: () => void;
  onUpdated?: () => void;
}

export function SharingModal({
  resourceType,
  resourceId,
  resourceName,
  apiBase = '',
  onClose,
  onUpdated,
}: SharingModalProps) {
  const [config, setConfig] = useState<SharingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<Array<{ id: number; email: string }>>([]);
  const [suggestions, setSuggestions] = useState<Array<{ id: number; email: string }>>([]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/sharing/${resourceType}/${resourceId}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [apiBase, resourceType, resourceId]);

  useEffect(() => {
    fetchConfig();
    // Fetch user list for autocomplete
    fetch(`${apiBase}/api/users/list`, { credentials: 'include' })
      .then((r) => r.json())
      .then(setUsers)
      .catch(() => {});
  }, [fetchConfig, apiBase]);

  useEffect(() => {
    if (!email.trim() || !config) {
      setSuggestions([]);
      return;
    }
    const q = email.toLowerCase();
    const sharedIds = new Set(config.shares.map((s) => s.userId));
    setSuggestions(
      users.filter(
        (u) => u.email.toLowerCase().includes(q) && u.id !== config.ownerId && !sharedIds.has(u.id)
      ).slice(0, 5)
    );
  }, [email, users, config]);

  const handleSetVisibility = async (newVis: 'public' | 'private') => {
    if (!config || config.visibility === newVis) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/sharing/${resourceType}/${resourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ visibility: newVis }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Erreur');
        return;
      }
      setConfig({ ...config, visibility: newVis });
      onUpdated?.();
    } catch {
      setError('Erreur réseau');
    } finally {
      setSaving(false);
    }
  };

  const handleAddShare = async (targetEmail: string) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/api/sharing/${resourceType}/${resourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ addEmail: targetEmail }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Erreur');
        return;
      }
      setEmail('');
      setSuggestions([]);
      await fetchConfig();
      onUpdated?.();
    } catch {
      setError('Erreur réseau');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveShare = async (userId: number) => {
    setSaving(true);
    setError('');
    try {
      await fetch(`${apiBase}/api/sharing/${resourceType}/${resourceId}/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await fetchConfig();
      onUpdated?.();
    } catch {
      setError('Erreur réseau');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Partage : ${resourceName}`} onClose={onClose}>
      {loading ? (
        <p className={styles.loading}>Chargement...</p>
      ) : !config ? (
        <p className={styles.error}>Impossible de charger la configuration de partage</p>
      ) : (
        <div className={styles.content}>
          {/* Visibility */}
          <div className={styles.visibilitySection}>
            <label className={styles.label}>Visibilité</label>
            <VisibilityPicker
              value={config.visibility as Visibility}
              onChange={handleSetVisibility}
              disabled={saving}
            />
            <span className={styles.visHint}>
              {config.visibility === 'public'
                ? 'Tous les utilisateurs peuvent voir cet élément'
                : 'Vous seul y avez accès. Ajouter des personnes ci-dessous pour le partager.'}
            </span>
          </div>

          {/* Share by email — only when private */}
          {config.visibility === 'private' && <div className={styles.shareSection}>
            <label className={styles.label}>Partager avec</label>
            <div className={styles.inputRow}>
              <input
                type="email"
                className={styles.input}
                placeholder="Email..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email.trim()) {
                    e.preventDefault();
                    handleAddShare(email.trim());
                  }
                }}
              />
              <button
                className={styles.addBtn}
                onClick={() => email.trim() && handleAddShare(email.trim())}
                disabled={saving || !email.trim()}
                type="button"
              >
                +
              </button>
            </div>
            {suggestions.length > 0 && (
              <ul className={styles.suggestions}>
                {suggestions.map((u) => (
                  <li key={u.id}>
                    <button
                      className={styles.suggestionItem}
                      onClick={() => handleAddShare(u.email)}
                      type="button"
                    >
                      {u.email}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>}

          {/* Current shares — only when private */}
          {config.visibility === 'private' && config.shares.length > 0 && (
            <div className={styles.sharesList}>
              <label className={styles.label}>
                Partagé avec ({config.shares.length})
              </label>
              {config.shares.map((s) => (
                <div key={s.userId} className={styles.shareItem}>
                  <span className={styles.shareEmail}>{s.email}</span>
                  <button
                    className={styles.removeBtn}
                    onClick={() => handleRemoveShare(s.userId)}
                    disabled={saving}
                    type="button"
                    title="Retirer"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}

export default SharingModal;
