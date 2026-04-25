import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@boilerplate/shared/components';
import type { SyncMetaResponse, ProviderSyncMeta } from '../../services/api';

/* ═══════════════════════════════════════════════════════════════════
   Inline connector setup — single panel rendered at the top of the
   bulk-import modal that lists every supported source (Fathom, Gmail,
   Outlook, Slack) using the SAME `connector-card` DOM + CSS as the
   /reglages page (CSS already imported in the modal). Replaces the
   pre-modal redirect gate AND the previous SyncStatusBanner so the
   user sees one coherent block, visually identical to elsewhere.

   For Fathom / Gmail / Outlook: single-click OAuth redirect to
   `/api/auth/<id>?returnUrl=...`. For Slack: redirect to /reglages
   (multi-field config form lives there). Both stamp the
   `suivitess:bulk-import-reopen` localStorage flag so the modal
   restores itself when the user returns.
   ═══════════════════════════════════════════════════════════════════ */

const REOPEN_FLAG_KEY = 'suivitess:bulk-import-reopen';

type ProviderId = 'fathom' | 'gmail' | 'outlook' | 'slack';
type ConnectKind = 'oauth' | 'settings-form';

interface ProviderDef {
  id: ProviderId;
  label: string;
  description: string;
  color: string;
  icon: ReactNode;
  /** OAuth = single click, redirects to provider for consent.
   *  settings-form = redirects to /reglages (needs token / channels). */
  connectKind: ConnectKind;
}

// Inlined SVGs — same artwork as the /reglages page, copied here to
// keep the import surface flat (icons live as private functions in
// ConnectorsPage.tsx and aren't exported).

const FathomIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="24" rx="6" fill="#6366f1" />
    <path d="M7 7h10M7 12h10M7 17h6" stroke="white" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const GmailIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="5" width="20" height="14" rx="2" fill="#EA4335" />
    <path d="M2 7l10 7 10-7" stroke="white" strokeWidth="1.5" fill="none" />
  </svg>
);

const OutlookIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="4" width="22" height="16" rx="2" fill="#0078D4" />
    <path d="M1 6l11 7 11-7" fill="none" stroke="white" strokeWidth="1.5" />
    <ellipse cx="8" cy="14" rx="4" ry="3.5" fill="#005A9E" />
    <text x="8" y="16" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="Arial">O</text>
  </svg>
);

const SlackIcon = () => (
  <svg width="24" height="24" viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
    <path fill="#E01E5A" d="M99.4,151.2c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9h12.9V151.2z"/>
    <path fill="#E01E5A" d="M105.9,151.2c0-7.1,5.8-12.9,12.9-12.9s12.9,5.8,12.9,12.9v32.3c0,7.1-5.8,12.9-12.9,12.9s-12.9-5.8-12.9-12.9V151.2z"/>
    <path fill="#36C5F0" d="M118.8,99.4c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9s12.9,5.8,12.9,12.9v12.9H118.8z"/>
    <path fill="#36C5F0" d="M118.8,105.9c7.1,0,12.9,5.8,12.9,12.9s-5.8,12.9-12.9,12.9H86.5c-7.1,0-12.9-5.8-12.9-12.9s5.8-12.9,12.9-12.9H118.8z"/>
    <path fill="#2EB67D" d="M170.6,118.8c0-7.1,5.8-12.9,12.9-12.9c7.1,0,12.9,5.8,12.9,12.9s-5.8,12.9-12.9,12.9h-12.9V118.8z"/>
    <path fill="#2EB67D" d="M164.1,118.8c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9V86.5c0-7.1,5.8-12.9,12.9-12.9c7.1,0,12.9,5.8,12.9,12.9V118.8z"/>
    <path fill="#ECB22E" d="M151.2,170.6c7.1,0,12.9,5.8,12.9,12.9c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9v-12.9H151.2z"/>
    <path fill="#ECB22E" d="M151.2,164.1c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9h32.3c7.1,0,12.9,5.8,12.9,12.9c0,7.1-5.8,12.9-12.9,12.9H151.2z"/>
  </svg>
);

const PROVIDERS: ProviderDef[] = [
  { id: 'fathom',  label: 'Fathom',  description: 'Transcriptions de calls (Fathom + Otter)', color: '#6366f1', icon: <FathomIcon />,  connectKind: 'oauth' },
  { id: 'gmail',   label: 'Gmail',   description: 'Emails synchronisés (label SuiviTess)',     color: '#EA4335', icon: <GmailIcon />,   connectKind: 'oauth' },
  { id: 'outlook', label: 'Outlook', description: 'Emails synchronisés (dossier SuiviTess)',   color: '#0078D4', icon: <OutlookIcon />, connectKind: 'oauth' },
  { id: 'slack',   label: 'Slack',   description: 'Messages des canaux configurés',            color: '#4A154B', icon: <SlackIcon />,   connectKind: 'settings-form' },
];

interface ProviderState {
  id: ProviderId;
  connected: boolean;
  loading: boolean;
  /** Click on the header toggles this — same pattern as EmailOAuthCard
   *  on the /reglages page so users recognise the affordance. */
  expanded: boolean;
}

interface Props {
  /** Sync metadata from `fetchSyncMeta()` — drives the "dernière
   *  synchro X · N messages" line on Slack + Outlook cards. */
  syncMeta: SyncMetaResponse | null;
  /** True while a `triggerSyncAll()` round-trip is in flight. */
  syncing: boolean;
  /** Triggers a fresh syncMeta + sources reload. */
  onRefresh: () => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'jamais';
  const ago = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ago / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function buildSyncLine(p: ProviderSyncMeta | undefined): string | null {
  if (!p?.configured) return null;
  if (p.error) return `Erreur : ${p.error}`;
  const count = p.messageCount ?? 0;
  return `${count} message${count > 1 ? 's' : ''} · dernière synchro ${formatRelative(p.lastSyncAt ?? null)}`;
}

/** Inline setup panel — one card per source provider using the
 *  shared `connector-card` CSS already imported by the modal. Same
 *  visual treatment as the cards on /reglages so users recognise
 *  the pattern across the app. */
export function InlineConnectorSetup({ syncMeta, syncing, onRefresh }: Props) {
  const [statuses, setStatuses] = useState<ProviderState[]>(
    PROVIDERS.map(p => ({ id: p.id, connected: false, loading: true, expanded: false })),
  );

  const toggleExpanded = (id: ProviderId) => {
    setStatuses(prev => prev.map(s =>
      s.id === id ? { ...s, expanded: !s.expanded } : s,
    ));
  };

  useEffect(() => {
    // OAuth providers: read /api/auth/<id>/status. Slack: piggy-back
    // on the syncMeta we receive — `configured: true` is the canonical
    // signal there.
    const oauthIds: ProviderId[] = ['fathom', 'gmail', 'outlook'];
    Promise.all(
      oauthIds.map(id =>
        fetch(`/api/auth/${id}/status`, { credentials: 'include' })
          .then(r => (r.ok ? r.json() : { connected: false }))
          .then((d: { connected: boolean }) => ({ id, connected: !!d.connected }))
          .catch(() => ({ id, connected: false })),
      ),
    ).then(results => {
      const byId = new Map(results.map(r => [r.id, r.connected]));
      setStatuses(prev => prev.map(s => {
        if (s.id === 'slack') {
          return { ...s, connected: !!syncMeta?.slack?.configured, loading: false };
        }
        return {
          ...s,
          connected: byId.get(s.id) ?? false,
          loading: false,
        };
      }));
    });
  // Re-run when syncMeta arrives so the Slack card flips from loading
  // to its real state without a manual refresh.
  }, [syncMeta]);

  const handleConnect = (provider: ProviderDef) => {
    try {
      window.localStorage.setItem(REOPEN_FLAG_KEY, JSON.stringify({
        provider: provider.id,
        ts: Date.now(),
      }));
    } catch { /* private mode — fall back to manual reopen */ }

    if (provider.connectKind === 'oauth') {
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/api/auth/${provider.id}?returnUrl=${returnUrl}`;
    } else {
      // settings-form (Slack) — needs token + channels, can't be done
      // in one click. Redirect to /reglages where the form lives.
      window.location.href = '/reglages';
    }
  };

  const anyConnected = statuses.some(s => s.connected);
  const anyLoading = statuses.some(s => s.loading);

  return (
    <div className="connectors-list" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--spacing-sm)',
      marginBottom: 'var(--spacing-md)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--spacing-sm)',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-muted)',
        }}>
          {anyLoading
            ? 'Vérification des connecteurs…'
            : anyConnected
              ? 'Connecteurs configurés — actualise pour récupérer les derniers contenus.'
              : '⚠ Aucun connecteur d\'import configuré — connecte une source ci-dessous.'}
        </span>
        {anyConnected && (
          <Button variant="secondary" onClick={onRefresh} disabled={syncing}>
            {syncing ? 'Synchronisation…' : 'Synchroniser'}
          </Button>
        )}
      </div>

      <div style={{
        display: 'grid',
        gap: 'var(--spacing-sm)',
        // Two cards per row, balanced visually. Drops to 1 column on
        // narrow viewports (modal max-width = 1100px, but min-width
        // can shrink in mobile).
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      }}>
        {PROVIDERS.map(provider => {
          const s = statuses.find(x => x.id === provider.id)!;
          const syncLine = provider.id === 'slack'
            ? buildSyncLine(syncMeta?.slack)
            : provider.id === 'outlook'
              ? buildSyncLine(syncMeta?.outlook)
              : null;
          // Same pattern as `EmailOAuthCard` on /reglages: clickable
          // header toggles an expanded body that holds the actions.
          // Reuses the existing `connector-card`, `connector-card-body`,
          // `connector-btn` classes so the visual parity is exact.
          return (
            <div key={provider.id} className="connector-card">
              <div
                className="connector-card-header"
                onClick={() => toggleExpanded(provider.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="connector-card-left">
                  <div className="connector-card-icon" style={{ color: provider.color, width: 32, height: 32 }}>
                    {provider.icon}
                  </div>
                  <div className="connector-card-info">
                    <div className="connector-card-name">{provider.label}</div>
                    <div className="connector-card-desc">
                      {syncLine ?? provider.description}
                    </div>
                  </div>
                </div>
                <div className="connector-card-right">
                  {s.loading ? (
                    <span className="connector-status">…</span>
                  ) : s.connected ? (
                    <span className="connector-status active">
                      <span className="connector-status-dot" />
                      Connecté
                    </span>
                  ) : (
                    <span className="connector-status inactive">
                      <span className="connector-status-dot" />
                      Non connecté
                    </span>
                  )}
                </div>
              </div>
              {s.expanded && !s.loading && (
                <div className="connector-card-body" style={{ padding: 'var(--spacing-md)' }}>
                  {s.connected ? (
                    <p style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--text-muted)',
                      margin: 0,
                    }}>
                      Connecté. Pour reconfigurer ou déconnecter, ouvre la page
                      {' '}
                      <a href="/reglages" style={{ color: 'var(--accent-primary)' }}>Réglages</a>.
                    </p>
                  ) : (
                    <>
                      <p style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--text-muted)',
                        margin: '0 0 var(--spacing-sm)',
                      }}>
                        {provider.connectKind === 'oauth'
                          ? `Connecte ton compte ${provider.label} pour importer dans SuiviTess.`
                          : `Configure ${provider.label} dans Réglages (token + canaux).`}
                      </p>
                      <Button variant="primary" onClick={() => handleConnect(provider)}>
                        {provider.connectKind === 'oauth'
                          ? `Connecter ${provider.label}`
                          : `Configurer ${provider.label}`}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
    return typeof ts === 'number' && Date.now() - ts < 10 * 60 * 1000;
  } catch {
    return false;
  }
}
