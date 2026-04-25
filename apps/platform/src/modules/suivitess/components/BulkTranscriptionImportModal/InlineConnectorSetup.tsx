import { useEffect, useState } from 'react';
import { Button } from '@boilerplate/shared/components';

/* ═══════════════════════════════════════════════════════════════════
   Inline connector setup — surfaced when the bulk-import modal
   detects no usable source provider on mount. Replaces the previous
   "redirect to /reglages" gate so the user can configure a connector
   without leaving the modal context.

   Each card triggers the same `/api/auth/<provider>` OAuth redirect
   the full /reglages page uses, but stamps `bulk-import-reopen=1` in
   localStorage first so the SuiviTess page can reopen the modal
   automatically after the callback returns.
   ═══════════════════════════════════════════════════════════════════ */

const REOPEN_FLAG_KEY = 'suivitess:bulk-import-reopen';

interface ProviderStatus {
  id: 'fathom' | 'gmail' | 'outlook';
  label: string;
  description: string;
  connected: boolean;
  loading: boolean;
}

const PROVIDERS: Array<Pick<ProviderStatus, 'id' | 'label' | 'description'>> = [
  { id: 'fathom',  label: 'Fathom',  description: 'Transcriptions de calls (Fathom + Otter)' },
  { id: 'gmail',   label: 'Gmail',   description: 'Emails synchronisés (label SuiviTess)' },
  { id: 'outlook', label: 'Outlook', description: 'Emails synchronisés (dossier SuiviTess)' },
];

/** Inline setup panel — one card per OAuth-capable import provider.
 *  Self-contained: queries `/api/auth/<provider>/status` on mount and
 *  shows a connect / disconnect button accordingly. The parent only
 *  cares about the `onRefresh` signal sent after a connection lands. */
export function InlineConnectorSetup({ onRefresh }: { onRefresh: () => void }) {
  const [statuses, setStatuses] = useState<ProviderStatus[]>(
    PROVIDERS.map(p => ({ ...p, connected: false, loading: true })),
  );

  useEffect(() => {
    Promise.all(
      PROVIDERS.map(p =>
        fetch(`/api/auth/${p.id}/status`, { credentials: 'include' })
          .then(r => (r.ok ? r.json() : { connected: false }))
          .then((d: { connected: boolean }) => ({ id: p.id, connected: !!d.connected }))
          .catch(() => ({ id: p.id, connected: false })),
      ),
    ).then(results => {
      const byId = new Map(results.map(r => [r.id, r.connected]));
      setStatuses(prev => prev.map(s => ({
        ...s,
        connected: byId.get(s.id) ?? false,
        loading: false,
      })));
    });
  }, []);

  const handleConnect = (providerId: ProviderStatus['id']) => {
    // Stamp the reopen flag BEFORE the redirect — the suivitess page
    // (App.tsx / DocumentSelector.tsx) reads it on mount and re-opens
    // the bulk-import modal once the OAuth callback has landed. The
    // flag is one-shot — consumers clear it after acting on it.
    try {
      window.localStorage.setItem(REOPEN_FLAG_KEY, JSON.stringify({
        provider: providerId,
        ts: Date.now(),
      }));
    } catch { /* private mode — fall back to the manual reopen */ }
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/${providerId}?returnUrl=${returnUrl}`;
  };

  const anyConnected = statuses.some(s => s.connected);

  return (
    <div style={{
      padding: 'var(--spacing-md)',
      background: 'var(--bg-secondary, var(--bg-primary))',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      marginBottom: 'var(--spacing-md)',
    }}>
      <div style={{ marginBottom: 'var(--spacing-sm)' }}>
        <h3 style={{
          margin: 0,
          fontSize: 'var(--font-size-md)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-primary)',
        }}>
          {anyConnected
            ? '✓ Au moins un connecteur est actif'
            : '⚠ Aucun connecteur d\'import configuré'}
        </h3>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-muted)',
        }}>
          {anyConnected
            ? 'Tu peux fermer ce panneau et passer à l\'analyse, ou en activer plus.'
            : 'Connecte une source pour pouvoir analyser des transcriptions ou des emails.'}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 'var(--spacing-sm)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {statuses.map(s => (
          <div
            key={s.id}
            style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-primary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>
                {s.label}
              </strong>
              {s.loading ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>…</span>
              ) : s.connected ? (
                <span style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-success, #10b981)',
                  fontWeight: 600,
                }}>
                  ✓ Connecté
                </span>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Non connecté</span>
              )}
            </div>
            <p style={{
              margin: 0,
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
              lineHeight: 1.4,
            }}>
              {s.description}
            </p>
            {!s.connected && !s.loading && (
              <Button
                variant="primary"
                onClick={() => handleConnect(s.id)}
                style={{ alignSelf: 'flex-start', marginTop: 4 }}
              >
                Connecter {s.label}
              </Button>
            )}
          </div>
        ))}
      </div>

      {anyConnected && (
        <div style={{ marginTop: 'var(--spacing-sm)', textAlign: 'right' }}>
          <Button variant="secondary" onClick={onRefresh}>
            Actualiser les sources
          </Button>
        </div>
      )}
    </div>
  );
}

/** Read + clear the one-shot "reopen this modal after OAuth callback"
 *  flag set by {@link InlineConnectorSetup}. Returns true if the
 *  consumer should auto-open the bulk-import modal on this mount. */
export function consumeBulkImportReopenFlag(): boolean {
  try {
    const raw = window.localStorage.getItem(REOPEN_FLAG_KEY);
    if (!raw) return false;
    window.localStorage.removeItem(REOPEN_FLAG_KEY);
    const { ts } = JSON.parse(raw) as { ts?: number };
    // Anti-stale: flags older than 10 minutes are dropped silently.
    return typeof ts === 'number' && Date.now() - ts < 10 * 60 * 1000;
  } catch {
    return false;
  }
}
