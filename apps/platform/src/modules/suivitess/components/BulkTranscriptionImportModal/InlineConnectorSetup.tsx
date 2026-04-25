import { useEffect, useState, useCallback } from 'react';
import {
  EmailOAuthCard,
  AIProviderCard,
  ALL_SERVICES,
  fetchConnectors,
} from '../../../gateway/components/ConnectorsPage';
import type { SyncMetaResponse } from '../../services/api';

/* ═══════════════════════════════════════════════════════════════════
   Inline connector setup — embeds the SAME card components used on
   /reglages (`EmailOAuthCard`, `AIProviderCard`) directly inside the
   bulk-import modal. Zero re-implementation: every visual quirk
   (chevron, expand/collapse, OAuth/token tabs, status pill) is
   inherited from the source-of-truth components.

   Slack lives in `CollectorsSection` on /reglages — it's a much
   bigger chunk of UI (token + channels picker + sync controls), so
   for now Slack still routes the user to /reglages. We surface its
   sync status compactly via the syncMeta the bulk modal already
   fetches.
   ═══════════════════════════════════════════════════════════════════ */

const REOPEN_FLAG_KEY = 'suivitess:bulk-import-reopen';

const FATHOM_SERVICE = ALL_SERVICES.find(s => s.id === 'fathom')!;
const OUTLOOK_SERVICE = ALL_SERVICES.find(s => s.id === 'outlook')!;
const GMAIL_SERVICE = ALL_SERVICES.find(s => s.id === 'gmail')!;

interface Props {
  /** Sync metadata from `fetchSyncMeta()` — drives the Slack
   *  fallback row. Outlook sync info is owned by `EmailOAuthCard`. */
  syncMeta: SyncMetaResponse | null;
  /** Triggers a fresh syncMeta + sources reload. */
  onRefresh: () => void;
}

/** Sets the one-shot reopen flag in localStorage so the suivitess
 *  pages re-open the bulk-import modal after the OAuth callback
 *  redirects back. Called from inside the cards via a window-level
 *  hook below — kept here for symmetry with `consumeBulkImportReopenFlag`. */
function stampReopenFlag(provider: string): void {
  try {
    window.localStorage.setItem(REOPEN_FLAG_KEY, JSON.stringify({
      provider,
      ts: Date.now(),
    }));
  } catch { /* private mode — fall back to manual reopen */ }
}

/** Inline setup — renders the actual /reglages cards inside the
 *  modal. The cards manage their own expand/collapse, OAuth/token
 *  tabs, and status. We feed them the connector list (for the
 *  fathom card's API token tab) and refresh on save. */
export function InlineConnectorSetup({ syncMeta, onRefresh }: Props) {
  const [connectors, setConnectors] = useState<Awaited<ReturnType<typeof fetchConnectors>>>([]);

  const loadConnectors = useCallback(() => {
    fetchConnectors().then(setConnectors).catch(() => setConnectors([]));
  }, []);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  // After a save inside one of the cards, refresh both the local
  // connector list (for AIProviderCard's token tab) AND the parent
  // bulk-import sources (so newly-connected providers surface fresh
  // transcripts/emails immediately).
  const handleChanged = useCallback(() => {
    loadConnectors();
    onRefresh();
  }, [loadConnectors, onRefresh]);

  // Patch window.location.href setters globally to stamp the reopen
  // flag whenever an `/api/auth/<provider>?...` redirect is about to
  // happen from inside the embedded cards. This avoids forking the
  // shared cards just to add localStorage write — same callback,
  // works transparently. The patch is removed on unmount.
  useEffect(() => {
    const originalAssign = window.location.assign.bind(window.location);
    const originalReplace = window.location.replace.bind(window.location);
    const intercept = (url: string | URL) => {
      const s = String(url);
      const match = s.match(/\/api\/auth\/([a-z]+)/);
      if (match) stampReopenFlag(match[1]);
    };
    // Override assignments — handles both .href= and .assign().
    const proto = Object.getPrototypeOf(window.location);
    const desc = Object.getOwnPropertyDescriptor(proto, 'href');
    if (desc?.set) {
      const originalSetter = desc.set;
      Object.defineProperty(window.location, 'href', {
        configurable: true,
        get: desc.get,
        set(v: string) { intercept(v); originalSetter.call(window.location, v); },
      });
    }
    window.location.assign = ((url: string | URL) => { intercept(url); originalAssign(url); }) as typeof window.location.assign;
    window.location.replace = ((url: string | URL) => { intercept(url); originalReplace(url); }) as typeof window.location.replace;
    return () => {
      // Best-effort cleanup. Window.location is non-trivial to fully
      // restore; Vite HMR keeps the patched version which is fine.
      try { window.location.assign = originalAssign; } catch { /* ignore */ }
      try { window.location.replace = originalReplace; } catch { /* ignore */ }
    };
  }, []);

  const fathomConnector = connectors.find(c => c.service === 'fathom') ?? null;
  const slackMeta = syncMeta?.slack;

  return (
    <div className="connectors-list" style={{ marginBottom: 'var(--spacing-md)' }}>
      <AIProviderCard
        service={FATHOM_SERVICE}
        connector={fathomConnector}
        oauthProvider="fathom"
        onSaved={handleChanged}
        onDeleted={handleChanged}
      />
      <EmailOAuthCard service={OUTLOOK_SERVICE} />
      <EmailOAuthCard service={GMAIL_SERVICE} />
      <SlackCardLink slackConfigured={!!slackMeta?.configured} />
    </div>
  );
}

/** Compact card pointing to /reglages for Slack — the full Slack
 *  setup (token + channels + active flag) lives in `CollectorsSection`
 *  on /reglages, too heavy to inline here. We mimic the visual of a
 *  collapsed `connector-card` so the look matches. */
function SlackCardLink({ slackConfigured }: { slackConfigured: boolean }) {
  return (
    <div className="connector-card">
      <div
        className="connector-card-header"
        style={{ cursor: 'pointer' }}
        onClick={() => {
          try {
            window.localStorage.setItem(REOPEN_FLAG_KEY, JSON.stringify({ provider: 'slack', ts: Date.now() }));
          } catch { /* private mode */ }
          window.location.href = '/reglages';
        }}
        title="Configurer Slack dans Réglages"
      >
        <div className="connector-card-left">
          <div className="connector-card-icon" style={{ color: '#4A154B' }}>
            <svg width="24" height="24" viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
              <path fill="#E01E5A" d="M99.4,151.2c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9h12.9V151.2z" />
              <path fill="#E01E5A" d="M105.9,151.2c0-7.1,5.8-12.9,12.9-12.9s12.9,5.8,12.9,12.9v32.3c0,7.1-5.8,12.9-12.9,12.9s-12.9-5.8-12.9-12.9V151.2z" />
              <path fill="#36C5F0" d="M118.8,99.4c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9s12.9,5.8,12.9,12.9v12.9H118.8z" />
              <path fill="#36C5F0" d="M118.8,105.9c7.1,0,12.9,5.8,12.9,12.9s-5.8,12.9-12.9,12.9H86.5c-7.1,0-12.9-5.8-12.9-12.9s5.8-12.9,12.9-12.9H118.8z" />
              <path fill="#2EB67D" d="M170.6,118.8c0-7.1,5.8-12.9,12.9-12.9c7.1,0,12.9,5.8,12.9,12.9s-5.8,12.9-12.9,12.9h-12.9V118.8z" />
              <path fill="#2EB67D" d="M164.1,118.8c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9V86.5c0-7.1,5.8-12.9,12.9-12.9c7.1,0,12.9,5.8,12.9,12.9V118.8z" />
              <path fill="#ECB22E" d="M151.2,170.6c7.1,0,12.9,5.8,12.9,12.9c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9v-12.9H151.2z" />
              <path fill="#ECB22E" d="M151.2,164.1c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9h32.3c7.1,0,12.9,5.8,12.9,12.9c0,7.1-5.8,12.9-12.9,12.9H151.2z" />
            </svg>
          </div>
          <div className="connector-card-info">
            <div className="connector-card-name">Slack</div>
            <div className="connector-card-desc">Messages des canaux configurés — configuration dans Réglages.</div>
          </div>
        </div>
        <div className="connector-card-right">
          {slackConfigured ? (
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
    </div>
  );
}

/** Read + clear the one-shot "reopen this modal after OAuth callback"
 *  flag set by the embedded cards (via the location.href intercept
 *  above) or by the Slack card. Called by the suivitess pages on
 *  mount — returns true if the consumer should auto-open the modal. */
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
