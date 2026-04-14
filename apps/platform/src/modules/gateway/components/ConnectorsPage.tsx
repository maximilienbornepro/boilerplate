import { useState, useEffect, useCallback } from 'react';
import { ModuleHeader, Tabs } from '@boilerplate/shared/components';
import './ConnectorsPage.css';

// ==================== Types ====================

interface ConnectorData {
  id: number;
  userId: number;
  service: string;
  config: Record<string, string>;
  isActive: boolean;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TestResult {
  success: boolean;
  message: string;
  userName?: string;
}

interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: JSX.Element;
  enabled: boolean;
}

interface OAuthStatus {
  connected: boolean;
  siteUrl?: string;
  cloudId?: string;
  expiresAt?: string;
  isExpired?: boolean;
  connectedAt?: string;
}

// ==================== SVG Icons ====================

const JiraIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zM6.77 6.8a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72a4.362 4.362 0 0 0 4.34 4.34V7.63a.84.84 0 0 0-.83-.83H6.77zM2 11.6a4.362 4.362 0 0 0 4.34 4.34h1.8v1.72A4.362 4.362 0 0 0 12.48 22V12.43a.84.84 0 0 0-.83-.83H2z"/>
  </svg>
);

const NotionIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.167V6.354c0-.606-.233-.933-.746-.886l-15.177.887c-.56.046-.747.326-.747.933zm14.337.745c.093.42 0 .84-.42.886l-.7.14v10.264c-.607.327-1.167.514-1.634.514-.746 0-.933-.234-1.493-.933l-4.572-7.186v6.953l1.447.327s0 .84-1.167.84l-3.22.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.453-.234 4.759 7.28V9.2l-1.214-.14c-.093-.513.28-.886.747-.933l3.229-.186z"/>
  </svg>
);

const ClickUpIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M3.986 11.072l2.142 1.736a6.26 6.26 0 0 0 5.872 3.87 6.26 6.26 0 0 0 5.872-3.87l2.142-1.736C18.858 14.725 15.742 17.45 12 17.45c-3.742 0-6.858-2.725-8.014-6.378z"/>
    <path d="M12 6.556l-3.672 3.332-2.142-1.736L12 2.856l5.814 5.296-2.142 1.736L12 6.556z"/>
  </svg>
);

// ==================== Service definitions ====================

// Generic AI icon (brain)
const AIIcon = ({ color }: { color?: string }) => (
  <svg viewBox="0 0 24 24" fill={color || 'currentColor'}>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
  </svg>
);

// Fathom icon (microphone)
const FathomIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
);

// Outlook icon (envelope)
const OutlookIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 13L2 7V5l10 6 10-6v2l-10 6zm10-8H2C.9 5 0 5.9 0 7v10c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z"/>
  </svg>
);

// Gmail icon (envelope with G)
const GmailIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
  </svg>
);

// ── Section 1: Gestion de projet ──
// Ces connecteurs permettent de récupérer les projets, tickets et sprints
// qui seront associés aux delivery boards.

interface ServiceGroup {
  title: string;
  description: string;
  services: ServiceDefinition[];
}

const SERVICE_GROUPS: ServiceGroup[] = [
  {
    title: 'Gestion de projet',
    description: 'Recuperez vos projets, tickets et sprints pour les associer a vos delivery boards. Les donnees sont synchronisees automatiquement.',
    services: [
      {
        id: 'jira',
        name: 'Jira',
        description: 'Importer les tickets et sprints Jira dans vos delivery boards',
        color: '#0052CC',
        icon: <JiraIcon />,
        enabled: true,
      },
      {
        id: 'fathom',
        name: 'Fathom',
        description: 'Importer les transcriptions Fathom dans vos sessions SuiviTess',
        color: '#6366f1',
        icon: <FathomIcon />,
        enabled: true,
      },
      {
        id: 'otter',
        name: 'Otter.ai',
        description: 'Importer les transcriptions Otter dans vos sessions SuiviTess',
        color: '#3b82f6',
        icon: <FathomIcon />,
        enabled: true,
      },
      {
        id: 'notion',
        name: 'Notion',
        description: 'Creer des pages Notion depuis vos sujets SuiviTess',
        color: '#000000',
        icon: <NotionIcon />,
        enabled: true,
      },
      {
        id: 'clickup',
        name: 'ClickUp',
        description: 'Importer vos taches et sprints ClickUp',
        color: '#7B68EE',
        icon: <ClickUpIcon />,
        enabled: false,
      },
    ],
  },
  {
    title: 'Intelligence artificielle',
    description: 'Configurez vos cles API pour activer les fonctionnalites IA : reformulation SuiviTess, adaptation de CV, suggestions intelligentes, RAG et embeddings.',
    services: [
      {
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        description: 'Reformulation SuiviTess, adaptation CV, suggestions de sujets',
        color: '#D97757',
        icon: <AIIcon color="#D97757" />,
        enabled: true,
      },
      {
        id: 'openai',
        name: 'OpenAI',
        description: 'Embeddings pour le RAG, generation de texte alternative',
        color: '#10a37f',
        icon: <AIIcon color="#10a37f" />,
        enabled: true,
      },
      {
        id: 'mistral',
        name: 'Mistral',
        description: 'IA francaise performante, alternative a Claude et GPT',
        color: '#F7D046',
        icon: <AIIcon color="#F7D046" />,
        enabled: true,
      },
      {
        id: 'scaleway',
        name: 'Scaleway',
        description: 'LLM et embeddings heberges en Europe (API compatible OpenAI)',
        color: '#4F0599',
        icon: <AIIcon color="#4F0599" />,
        enabled: true,
      },
    ],
  },
  {
    title: 'Messagerie',
    description: 'Connectez vos boites mail pour importer des mails dans SuiviTess et alimenter vos reviews automatiquement.',
    services: [
      {
        id: 'outlook',
        name: 'Outlook',
        description: 'Microsoft 365 / Outlook.com — importez vos mails dans SuiviTess',
        color: '#0078D4',
        icon: <OutlookIcon />,
        enabled: true,
      },
      {
        id: 'gmail',
        name: 'Gmail',
        description: 'Google Workspace / Gmail — importez vos mails dans SuiviTess',
        color: '#EA4335',
        icon: <GmailIcon />,
        enabled: true,
      },
    ],
  },
];

const EMAIL_SERVICE_IDS = new Set(['outlook', 'gmail']);

// Flat list of all services (for backward compat with getConnectorForService)
const ALL_SERVICES = SERVICE_GROUPS.flatMap(g => g.services);

// ==================== API functions ====================

const API_BASE = '/api/connectors';

interface AIUsageSummary {
  provider: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCalls: number;
  lastUsed: string | null;
}

async function fetchConnectors(): Promise<ConnectorData[]> {
  const res = await fetch(API_BASE, { credentials: 'include' });
  if (!res.ok) throw new Error('Erreur lors du chargement des connecteurs');
  return res.json();
}

async function fetchAIUsage(): Promise<AIUsageSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/ai-usage`, { credentials: 'include' });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

async function saveConnector(service: string, config: Record<string, string>): Promise<ConnectorData> {
  const res = await fetch(`${API_BASE}/${service}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ config }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Erreur lors de la sauvegarde');
  }
  return res.json();
}

async function testConnector(service: string): Promise<{ success: boolean; user?: { displayName: string; accountId: string }; error?: string; details?: string }> {
  const res = await fetch(`${API_BASE}/${service}/test`, {
    method: 'POST',
    credentials: 'include',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erreur lors du test');
  }
  return data;
}

async function deleteConnector(service: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${service}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Erreur lors de la suppression');
  }
}

async function checkOAuthAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/jira/oauth-available`);
    const data = await res.json();
    return data.available === true;
  } catch {
    return false;
  }
}

async function fetchOAuthStatus(): Promise<OAuthStatus> {
  const res = await fetch('/api/auth/jira/status', { credentials: 'include' });
  if (!res.ok) return { connected: false };
  return res.json();
}

async function disconnectOAuth(): Promise<void> {
  const res = await fetch('/api/auth/jira', {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Erreur lors de la deconnexion');
  }
}

// ==================== Jira OAuth Tab Component ====================

function JiraOAuthTab({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchOAuthStatus();
      setStatus(s);
    } catch {
      setError('Impossible de verifier le statut OAuth');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Detect ?jira_connected=1 in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('jira_connected') === '1') {
      setSuccessMessage('Connexion Jira OAuth reussie !');
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('jira_connected');
      window.history.replaceState({}, '', url.toString());
      loadStatus();
      onChanged();
    }
    if (params.get('jira_error')) {
      setError(`Erreur OAuth : ${params.get('jira_error')}`);
      const url = new URL(window.location.href);
      url.searchParams.delete('jira_error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [loadStatus, onChanged]);

  const handleConnect = () => {
    // Redirect to backend OAuth initiation
    window.location.href = '/api/auth/jira';
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError('');
    try {
      await disconnectOAuth();
      setStatus({ connected: false });
      setSuccessMessage('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="connector-card-body">
        <div className="connector-loading">
          <span className="connector-spinner" />
          <span>Chargement...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="connector-card-body">
      {successMessage && (
        <div className="connector-test-result success">{successMessage}</div>
      )}

      {error && <div className="connectors-error">{error}</div>}

      {status?.connected ? (
        <div className="connector-oauth-status">
          <div className="connector-oauth-info">
            <div className="connector-oauth-connected">
              <span className="connector-status-dot active" />
              Connecte via OAuth
            </div>
            {status.siteUrl && (
              <div className="connector-oauth-detail">
                Site : {status.siteUrl}
              </div>
            )}
            {status.connectedAt && (
              <div className="connector-oauth-detail">
                Connecte le : {new Date(status.connectedAt).toLocaleDateString('fr-FR')}
              </div>
            )}
            {status.isExpired && (
              <div className="connector-oauth-detail warning">
                Token expire — sera renouvele automatiquement
              </div>
            )}
          </div>

          <div className="connector-actions">
            <button
              className="connector-btn danger"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Deconnexion...' : 'Deconnecter Jira'}
            </button>
          </div>
        </div>
      ) : (
        <div className="connector-oauth-connect">
          <p className="connector-oauth-desc">
            Connectez votre compte Jira via OAuth 2.0. Vous serez redirige vers Atlassian pour autoriser l'acces.
          </p>
          <div className="connector-actions">
            <button className="connector-btn primary" onClick={handleConnect}>
              Se connecter avec Jira
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== Jira Form Component (Basic Auth) ====================

function JiraForm({
  connector,
  onSaved,
  onDeleted,
}: {
  connector: ConnectorData | null;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (connector) {
      setBaseUrl((connector.config.baseUrl as string) || '');
      setEmail((connector.config.email as string) || '');
      setApiToken((connector.config.apiToken as string) || '');
    } else {
      setBaseUrl('');
      setEmail('');
      setApiToken('');
    }
    setTestResult(null);
    setError('');
  }, [connector]);

  const handleSave = async () => {
    if (!baseUrl || !email || !apiToken) {
      setError('Tous les champs sont requis');
      return;
    }

    setSaving(true);
    setError('');
    setTestResult(null);

    try {
      await saveConnector('jira', { baseUrl, email, apiToken });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');

    try {
      const result = await testConnector('jira');
      setTestResult({
        success: true,
        message: `Connexion reussie ! Connecte en tant que ${result.user?.displayName}`,
        userName: result.user?.displayName,
      });
      onSaved();
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Erreur lors du test',
      });
      onSaved();
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');

    try {
      await deleteConnector('jira');
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression');
    } finally {
      setDeleting(false);
    }
  };

  const hasChanges = connector
    ? baseUrl !== (connector.config.baseUrl || '') ||
      email !== (connector.config.email || '') ||
      (apiToken !== (connector.config.apiToken || '') && !apiToken.includes('****'))
    : baseUrl || email || apiToken;

  return (
    <div className="connector-card-body">
      <div className="connector-form">
        <div className="connector-field">
          <label htmlFor="jira-url">URL de l'instance Jira</label>
          <input
            id="jira-url"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://votre-equipe.atlassian.net"
          />
          <span className="connector-field-hint">
            L'URL de votre instance Atlassian Jira Cloud
          </span>
        </div>

        <div className="connector-field">
          <label htmlFor="jira-email">Email</label>
          <input
            id="jira-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@example.com"
          />
          <span className="connector-field-hint">
            L'adresse email associee a votre compte Atlassian
          </span>
        </div>

        <div className="connector-field">
          <label htmlFor="jira-token">Token API</label>
          <input
            id="jira-token"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="Votre token API Atlassian"
          />
          <span className="connector-field-hint">
            Generez un token sur https://id.atlassian.net/manage-profile/security/api-tokens
          </span>
        </div>
      </div>

      {error && <div className="connectors-error">{error}</div>}

      {testResult && (
        <div className={`connector-test-result ${testResult.success ? 'success' : 'error'}`}>
          {testResult.message}
        </div>
      )}

      <div className="connector-actions">
        <button
          className="connector-btn primary"
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? (
            <span className="connector-loading">
              <span className="connector-spinner" />
              Sauvegarde...
            </span>
          ) : (
            'Sauvegarder'
          )}
        </button>

        <button
          className="connector-btn secondary"
          onClick={handleTest}
          disabled={testing || !connector}
        >
          {testing ? (
            <span className="connector-loading">
              <span className="connector-spinner" />
              Test en cours...
            </span>
          ) : (
            'Tester la connexion'
          )}
        </button>

        {connector && (
          <button
            className="connector-btn danger"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Suppression...' : 'Supprimer'}
          </button>
        )}
      </div>
    </div>
  );
}

// ==================== Jira Card with Tabs ====================

function JiraCard({
  connector,
  oauthAvailable,
  onSaved,
  onDeleted,
}: {
  connector: ConnectorData | null;
  oauthAvailable: boolean;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const service = ALL_SERVICES.find(s => s.id === 'jira')!;
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'token' | 'oauth'>(oauthAvailable ? 'oauth' : 'token');
  const [oauthConnected, setOauthConnected] = useState(false);

  // Detect OAuth connection so the "Connecte / Configure / Non configure" badge
  // also reflects OAuth status (not just the Basic Auth user_connectors row).
  const refreshOAuthStatus = useCallback(async () => {
    try {
      const s = await fetchOAuthStatus();
      setOauthConnected(!!s.connected);
    } catch {
      setOauthConnected(false);
    }
  }, []);

  useEffect(() => {
    refreshOAuthStatus();
  }, [refreshOAuthStatus]);

  const handleChanged = () => {
    refreshOAuthStatus();
    onSaved();
  };

  const isActive = oauthConnected || (connector?.isActive ?? false);
  const isConfigured = oauthConnected || connector !== null;

  return (
    <div className="connector-card">
      <div
        className="connector-card-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="connector-card-left">
          <div
            className="connector-card-icon"
            style={{ background: service.color, color: '#fff' }}
          >
            {service.icon}
          </div>
          <div className="connector-card-info">
            <div className="connector-card-name">{service.name}</div>
            <div className="connector-card-desc">{service.description}</div>
          </div>
        </div>

        <div className="connector-card-right">
          <div className={`connector-status ${isActive ? 'active' : 'inactive'}`}>
            <span className="connector-status-dot" />
            {isActive ? 'Connecte' : isConfigured ? 'Configure' : 'Non configure'}
          </div>
          <span className={`connector-expand-icon${expanded ? ' expanded' : ''}`}>
            &#x25BC;
          </span>
        </div>
      </div>

      {expanded && (
        <>
          {oauthAvailable && (
            <Tabs
              tabs={[
                { value: 'oauth', label: 'OAuth' },
                { value: 'token', label: 'Token API' },
              ]}
              value={activeTab}
              onChange={(v) => setActiveTab(v as 'oauth' | 'token')}
            />
          )}

          {activeTab === 'oauth' && oauthAvailable ? (
            <JiraOAuthTab onChanged={handleChanged} />
          ) : (
            <JiraForm connector={connector} onSaved={onSaved} onDeleted={onDeleted} />
          )}
        </>
      )}
    </div>
  );
}

// ==================== Connector Card Component (disabled services) ====================

function ConnectorCardDisabled({ service }: { service: ServiceDefinition }) {
  return (
    <div className="connector-card disabled">
      <div className="connector-card-header">
        <div className="connector-card-left">
          <div className="connector-card-icon" style={{ background: service.color, color: '#fff' }}>
            {service.icon}
          </div>
          <div className="connector-card-info">
            <div className="connector-card-name">{service.name}</div>
            <div className="connector-card-desc">{service.description}</div>
          </div>
        </div>
        <div className="connector-card-right">
          <span className="connector-coming-soon">Bientot disponible</span>
        </div>
      </div>
    </div>
  );
}

// ==================== AI Provider Config ==========================================

interface AIFieldDef {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  required?: boolean;
  hint?: string;
}

const AI_FIELDS: Record<string, AIFieldDef[]> = {
  anthropic: [
    { key: 'apiKey', label: 'Cle API', type: 'password', required: true, placeholder: 'sk-ant-...' },
    { key: 'model', label: 'Modele', type: 'text', placeholder: 'claude-sonnet-4-6', hint: 'Laissez vide pour le modele par defaut' },
  ],
  openai: [
    { key: 'apiKey', label: 'Cle API', type: 'password', required: true, placeholder: 'sk-...' },
    { key: 'model', label: 'Modele Chat', type: 'text', placeholder: 'gpt-4o' },
    { key: 'embeddingModel', label: 'Modele Embedding', type: 'text', placeholder: 'text-embedding-3-small' },
  ],
  mistral: [
    { key: 'apiKey', label: 'Cle API', type: 'password', required: true, placeholder: '...' },
    { key: 'model', label: 'Modele', type: 'text', placeholder: 'mistral-large-latest' },
    { key: 'baseUrl', label: 'URL de base', type: 'text', placeholder: 'https://api.mistral.ai/v1', hint: 'Laissez vide pour l\'URL par defaut' },
  ],
  scaleway: [
    { key: 'apiKey', label: 'Cle API', type: 'password', required: true, placeholder: '...' },
    { key: 'baseUrl', label: 'URL de base', type: 'text', required: true, placeholder: 'https://api.scaleway.ai/v1' },
    { key: 'chatModel', label: 'Modele Chat', type: 'text', placeholder: 'qwen3-32b' },
    { key: 'embeddingModel', label: 'Modele Embedding', type: 'text', placeholder: 'bge-multilingual-gemma2' },
  ],
};

const AI_SERVICE_IDS = new Set(['anthropic', 'openai', 'mistral', 'scaleway']);

// Transcription providers use simple API keys
AI_FIELDS['fathom'] = [
  { key: 'apiKey', label: 'Cle API Fathom', type: 'password', required: true, placeholder: 'fathom_...', hint: 'Disponible dans les parametres Fathom > API' },
];

AI_FIELDS['otter'] = [
  { key: 'apiKey', label: 'Cle API Otter', type: 'password', required: true, placeholder: '...' },
  { key: 'baseUrl', label: 'URL de base', type: 'text', placeholder: 'https://api.otter.ai/v1', hint: 'Laissez vide pour l\'URL par defaut' },
];

AI_FIELDS['notion'] = [
  { key: 'apiKey', label: 'Token d\'integration Notion', type: 'password', required: true, placeholder: 'secret_...', hint: 'Creer une integration sur https://www.notion.so/profile/integrations puis partager les databases avec elle' },
];

// ==================== Generic AI Form ====================

function AIProviderForm({
  service,
  connector,
  onSaved,
  onDeleted,
}: {
  service: ServiceDefinition;
  connector: ConnectorData | null;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const fields = AI_FIELDS[service.id] || [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const v: Record<string, string> = {};
    for (const f of fields) {
      v[f.key] = (connector?.config?.[f.key] as string) || '';
    }
    setValues(v);
    setTestResult(null);
    setError('');
  }, [connector, service.id]);

  const handleSave = async () => {
    const missing = fields.filter(f => f.required && !values[f.key]);
    if (missing.length > 0) {
      setError(`Champs requis : ${missing.map(f => f.label).join(', ')}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveConnector(service.id, values);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const result = await testConnector(service.id);
      setTestResult({ success: true, message: `Connexion reussie ! Modele : ${result.model || '?'}` });
      onSaved();
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Erreur' });
      onSaved();
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await deleteConnector(service.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="connector-card-body">
      <div className="connector-form">
        {fields.map(f => (
          <div key={f.key} className="connector-field">
            <label htmlFor={`${service.id}-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
            <input
              id={`${service.id}-${f.key}`}
              type={f.type}
              value={values[f.key] || ''}
              onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
            />
            {f.hint && <span className="connector-field-hint">{f.hint}</span>}
          </div>
        ))}
      </div>

      {error && <div className="connectors-error">{error}</div>}
      {testResult && (
        <div className={`connector-test-result ${testResult.success ? 'success' : 'error'}`}>
          {testResult.message}
        </div>
      )}

      <div className="connector-actions">
        <button className="connector-btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Sauvegarde...' : 'Sauvegarder'}
        </button>
        <button className="connector-btn secondary" onClick={handleTest} disabled={testing || !connector}>
          {testing ? 'Test...' : 'Tester'}
        </button>
        {connector && (
          <button className="connector-btn danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Suppression...' : 'Supprimer'}
          </button>
        )}
      </div>
    </div>
  );
}

// ==================== Generic AI Provider Card ====================

function AIProviderCard({
  service,
  connector,
  usage,
  oauthProvider,
  onSaved,
  onDeleted,
}: {
  service: ServiceDefinition;
  connector: ConnectorData | null;
  usage?: AIUsageSummary | null;
  oauthProvider?: string;  // e.g. 'fathom' — enables OAuth tab
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'oauth' | 'token'>('oauth');
  const [oauthAvail, setOauthAvail] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<{ connected: boolean; expiresAt?: string; isExpired?: boolean } | null>(null);
  const isActive = connector?.isActive ?? false;
  const oauthConnected = oauthStatus?.connected ?? false;

  useEffect(() => {
    if (!oauthProvider) return;
    fetch(`/api/connectors/${oauthProvider}/oauth-available`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { available: false })
      .then(d => setOauthAvail(!!d.available))
      .catch(() => {});
    fetch(`/api/auth/${oauthProvider}/status`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { connected: false })
      .then(setOauthStatus)
      .catch(() => setOauthStatus({ connected: false }));

    // Detect ?<provider>_connected=1
    const params = new URLSearchParams(window.location.search);
    if (params.get(`${oauthProvider}_connected`) === '1') {
      fetch(`/api/auth/${oauthProvider}/status`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { connected: false })
        .then(setOauthStatus)
        .catch(() => {});
      const url = new URL(window.location.href);
      url.searchParams.delete(`${oauthProvider}_connected`);
      window.history.replaceState({}, '', url.toString());
    }
  }, [oauthProvider]);

  const handleOAuthConnect = () => {
    if (!oauthProvider) return;
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/${oauthProvider}?returnUrl=${returnUrl}`;
  };

  const handleOAuthDisconnect = async () => {
    if (!oauthProvider) return;
    await fetch(`/api/auth/${oauthProvider}`, { method: 'DELETE', credentials: 'include' });
    setOauthStatus({ connected: false });
  };

  return (
    <div className="connector-card">
      <div className="connector-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="connector-card-left">
          <div className="connector-card-icon" style={{ background: service.color, color: '#fff' }}>
            {service.icon}
          </div>
          <div className="connector-card-info">
            <div className="connector-card-name">{service.name}</div>
            <div className="connector-card-desc">{service.description}</div>
          </div>
        </div>
        <div className="connector-card-right">
          {usage && usage.totalCalls > 0 && (
            <div className="connector-usage-badge" title={`${usage.totalCalls} appels — ${formatTokenCount(usage.totalTokensIn + usage.totalTokensOut)} tokens (30j)`}>
              <span className="connector-usage-calls">{usage.totalCalls} appels</span>
              <span className="connector-usage-tokens">{formatTokenCount(usage.totalTokensIn + usage.totalTokensOut)} tokens</span>
            </div>
          )}
          <div className={`connector-status ${(isActive || oauthConnected) ? 'active' : 'inactive'}`}>
            <span className="connector-status-dot" />
            {oauthConnected ? 'Connecte (OAuth)' : isActive ? 'Connecte' : connector ? 'Configure' : 'Non configure'}
          </div>
          <span className={`connector-expand-icon${expanded ? ' expanded' : ''}`}>&#x25BC;</span>
        </div>
      </div>
      {expanded && (
        <>
          {oauthProvider && (
            <div style={{ padding: 'var(--spacing-md) var(--spacing-md) 0' }}>
              <Tabs
                tabs={[
                  { value: 'oauth', label: 'OAuth' },
                  { value: 'token', label: 'Token API' },
                ]}
                value={tab}
                onChange={v => setTab(v as 'oauth' | 'token')}
              />
            </div>
          )}
          {oauthProvider && tab === 'oauth' ? (
            <div style={{ padding: 'var(--spacing-md)' }}>
              {!oauthAvail && !oauthConnected ? (
                <div className="connectors-error">
                  OAuth {service.name} non configure sur le serveur. Ajoutez {oauthProvider.toUpperCase()}_OAUTH_CLIENT_ID et {oauthProvider.toUpperCase()}_OAUTH_CLIENT_SECRET.
                </div>
              ) : oauthConnected ? (
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: '0 0 var(--spacing-sm)' }}>
                    Compte connecte via OAuth.
                  </p>
                  {oauthStatus?.isExpired && (
                    <p style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-xs)', margin: '0 0 var(--spacing-sm)' }}>
                      Token expire — reconnectez-vous
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                    <button className="connector-btn connector-btn-primary" onClick={handleOAuthConnect}>Reconnecter</button>
                    <button className="connector-btn connector-btn-danger" onClick={handleOAuthDisconnect}>Deconnecter</button>
                  </div>
                </div>
              ) : (
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: '0 0 var(--spacing-md)' }}>
                    Connectez-vous via OAuth pour acceder a vos donnees {service.name}.
                  </p>
                  <button className="connector-btn connector-btn-primary" onClick={handleOAuthConnect}>
                    Connecter via OAuth
                  </button>
                </div>
              )}
            </div>
          ) : (
            <AIProviderForm service={service} connector={connector} onSaved={onSaved} onDeleted={onDeleted} />
          )}
        </>
      )}
    </div>
  );
}

// ==================== Main Page Component ====================

interface ConnectorsPageProps {
  onBack: () => void;
}

interface CreditInfo {
  enabled: boolean;
  balance: number;
  monthlyAllocation: number;
  transactions: Array<{
    id: number;
    amount: number;
    balanceAfter: number;
    type: string;
    module: string | null;
    operation: string | null;
    description: string | null;
    createdAt: string;
  }>;
}

function CreditSection({ credits }: { credits: CreditInfo }) {
  if (!credits.enabled) return null;

  const pct = credits.monthlyAllocation > 0
    ? Math.max(0, Math.min(100, (credits.balance / credits.monthlyAllocation) * 100))
    : 0;
  const barColor = pct > 30 ? 'var(--color-accent)' : pct > 10 ? 'var(--color-warning)' : 'var(--color-error)';

  return (
    <div className="connectors-group">
      <h3 className="connectors-group-title">Credits</h3>
      <p className="connectors-group-desc">Solde de credits pour les operations IA et creations de ressources.</p>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--spacing-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--spacing-sm)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-primary)' }}>
            {credits.balance}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
            / {credits.monthlyAllocation} credits
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        {credits.transactions.length > 0 && (
          <details style={{ marginTop: 'var(--spacing-md)' }}>
            <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Historique recent ({credits.transactions.length})
            </summary>
            <div style={{ marginTop: 'var(--spacing-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
              {credits.transactions.slice(0, 10).map(tx => (
                <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', padding: '2px 0' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{tx.description || tx.operation || tx.type}</span>
                  <span style={{ color: tx.amount < 0 ? 'var(--color-error)' : 'var(--color-success)', fontWeight: 'var(--font-weight-semibold)' }}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// ==================== Email OAuth Card (Outlook / Gmail) ====================

function EmailOAuthCard({ service }: { service: ServiceDefinition }) {
  const [status, setStatus] = useState<{ connected: boolean; emailAddress?: string; isExpired?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [oauthAvail, setOauthAvail] = useState(false);

  const provider = service.id; // 'outlook' | 'gmail'

  useEffect(() => {
    fetch(`/api/connectors/${provider}/oauth-available`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { available: false })
      .then(d => setOauthAvail(!!d.available))
      .catch(() => {});
    fetch(`/api/auth/${provider}/status`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { connected: false })
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
    setLoading(false);

    // Detect URL params
    const params = new URLSearchParams(window.location.search);
    if (params.get(`${provider}_connected`) === '1') {
      fetch(`/api/auth/${provider}/status`, { credentials: 'include' }).then(r => r.json()).then(setStatus).catch(() => {});
      const url = new URL(window.location.href);
      url.searchParams.delete(`${provider}_connected`);
      window.history.replaceState({}, '', url.toString());
    }
  }, [provider]);

  const handleConnect = () => {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/${provider}?returnUrl=${returnUrl}`;
  };

  const handleDisconnect = async () => {
    await fetch(`/api/auth/${provider}`, { method: 'DELETE', credentials: 'include' });
    setStatus({ connected: false });
  };

  return (
    <div className="connector-card">
      <div className="connector-card-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <div className="connector-card-left">
          <div className="connector-card-icon" style={{ background: service.color, color: '#fff' }}>
            {service.icon}
          </div>
          <div className="connector-card-info">
            <div className="connector-card-name">{service.name}</div>
            <div className="connector-card-desc">{service.description}</div>
          </div>
        </div>
        <div className="connector-card-right">
          {status?.connected ? (
            <span className="connector-status active">Connecte</span>
          ) : (
            <span className="connector-status inactive">Non connecte</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="connector-card-body" style={{ padding: 'var(--spacing-md)' }}>
          {loading ? (
            <div className="connector-loading"><span className="connector-spinner" /><span>Chargement...</span></div>
          ) : !oauthAvail && !status?.connected ? (
            <div className="connectors-error">OAuth {service.name} non configure sur le serveur. Ajoutez les variables {provider.toUpperCase()}_OAUTH_CLIENT_ID et {provider.toUpperCase()}_OAUTH_CLIENT_SECRET.</div>
          ) : status?.connected ? (
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: '0 0 var(--spacing-sm)' }}>
                Compte : <strong style={{ color: 'var(--text-primary)' }}>{status.emailAddress || '—'}</strong>
              </p>
              {status.isExpired && (
                <p style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-xs)', margin: '0 0 var(--spacing-sm)' }}>
                  Token expire — reconnectez-vous
                </p>
              )}
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                <button className="connector-btn connector-btn-primary" onClick={handleConnect}>Reconnecter</button>
                <button className="connector-btn connector-btn-danger" onClick={handleDisconnect}>Deconnecter</button>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: '0 0 var(--spacing-md)' }}>
                Connectez votre compte {service.name} pour importer vos mails dans SuiviTess.
              </p>
              <button className="connector-btn connector-btn-primary" onClick={handleConnect}>
                Connecter via OAuth
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ConnectorsPage({ onBack }: ConnectorsPageProps) {
  const [connectors, setConnectors] = useState<ConnectorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [oauthAvailable, setOauthAvailable] = useState(false);
  const [aiUsage, setAiUsage] = useState<AIUsageSummary[]>([]);
  const [credits, setCredits] = useState<CreditInfo | null>(null);

  const loadConnectors = useCallback(async () => {
    try {
      const [data, usage] = await Promise.all([fetchConnectors(), fetchAIUsage()]);
      setConnectors(data);
      setAiUsage(usage);
      setError('');
    } catch {
      setError('Impossible de charger les connecteurs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnectors();
    checkOAuthAvailable().then(setOauthAvailable);
    fetch('/connectors-api/credits', { credentials: 'include' })
      .then(r => r.json())
      .then(setCredits)
      .catch(() => {});
  }, [loadConnectors]);

  const getUsageForProvider = (provider: string): AIUsageSummary | null => {
    return aiUsage.find(u => u.provider === provider) || null;
  };

  const getConnectorForService = (serviceId: string): ConnectorData | null => {
    return connectors.find(c => c.service === serviceId) || null;
  };

  if (loading) {
    return (
      <div className="connectors-page">
        <div className="connector-loading" style={{ justifyContent: 'center', padding: 'var(--spacing-3xl)' }}>
          <span className="connector-spinner" />
          <span>Chargement...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <ModuleHeader title="Connecteurs" onBack={onBack} />
      <div className="connectors-page">

      <p className="connectors-subtitle">
        Configurez vos connexions aux services externes. Les identifiants sont stockes par utilisateur.
      </p>

      {error && <div className="connectors-error">{error}</div>}

      {credits && <CreditSection credits={credits} />}

      {SERVICE_GROUPS.map(group => (
        <div key={group.title} className="connectors-group">
          <h3 className="connectors-group-title">{group.title}</h3>
          <p className="connectors-group-desc">{group.description}</p>
          <div className="connectors-list">
            {group.services.map(service => {
              if (service.id === 'jira') {
                return (
                  <JiraCard
                    key="jira"
                    connector={getConnectorForService('jira')}
                    oauthAvailable={oauthAvailable}
                    onSaved={loadConnectors}
                    onDeleted={loadConnectors}
                  />
                );
              }
              if (EMAIL_SERVICE_IDS.has(service.id)) {
                return <EmailOAuthCard key={service.id} service={service} />;
              }
              if (AI_SERVICE_IDS.has(service.id) || service.id === 'fathom' || service.id === 'otter' || service.id === 'notion') {
                if (!service.enabled) return <ConnectorCardDisabled key={service.id} service={service} />;
                return (
                  <AIProviderCard
                    key={service.id}
                    service={service}
                    connector={getConnectorForService(service.id)}
                    usage={AI_SERVICE_IDS.has(service.id) ? getUsageForProvider(service.id) : null}
                    oauthProvider={service.id === 'fathom' ? 'fathom' : undefined}
                    onSaved={loadConnectors}
                    onDeleted={loadConnectors}
                  />
                );
              }
              if (!service.enabled) {
                return <ConnectorCardDisabled key={service.id} service={service} />;
              }
              return null;
            })}
          </div>
        </div>
      ))}
      </div>
    </>
  );
}
