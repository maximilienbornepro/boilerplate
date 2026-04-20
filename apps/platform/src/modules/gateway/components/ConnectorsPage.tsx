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
  <svg viewBox="0 0 24 24" fill="currentColor" style={{ background: 'white', borderRadius: 4, padding: 2 }}>
    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.167V6.354c0-.606-.233-.933-.746-.886l-15.177.887c-.56.046-.747.326-.747.933zm14.337.745c.093.42 0 .84-.42.886l-.7.14v10.264c-.607.327-1.167.514-1.634.514-.746 0-.933-.234-1.493-.933l-4.572-7.186v6.953l1.447.327s0 .84-1.167.84l-3.22.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.453-.234 4.759 7.28V9.2l-1.214-.14c-.093-.513.28-.886.747-.933l3.229-.186z"/>
  </svg>
);

const ClickUpIcon = () => (
  <svg viewBox="0 0 24 24">
    <defs>
      <linearGradient id="cu-top" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#ff49a4" />
        <stop offset="100%" stopColor="#ffad3b" />
      </linearGradient>
      <linearGradient id="cu-bot" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#7b68ee" />
        <stop offset="100%" stopColor="#49ccf9" />
      </linearGradient>
    </defs>
    <path d="M12 4l-7 6.5 2.2 1.8L12 8.2l4.8 4.1L19 10.5z" fill="url(#cu-top)" />
    <path d="M5.5 15.5a8 8 0 0 0 13 0l-2.2-1.8a5 5 0 0 1-8.6 0z" fill="url(#cu-bot)" />
  </svg>
);

// ==================== Service definitions ====================

// Claude (Anthropic) logo
import claudeLogo from '../assets/claude-logo.png';
const ClaudeIcon = () => (
  <img src={claudeLogo} alt="Claude" width="24" height="24" />
);

// OpenAI logo
import openaiLogo from '../assets/openai-logo.svg';
const OpenAIIcon = () => (
  <img src={openaiLogo} alt="OpenAI" width="24" height="24" style={{ background: 'white', borderRadius: 4, padding: 2 }} />
);

// Mistral logo
import mistralLogo from '../assets/mistral-logo.svg';
const MistralIcon = () => (
  <img src={mistralLogo} alt="Mistral" width="24" height="24" />
);

// Scaleway logo
import scalewayLogo from '../assets/scaleway-logo.svg';
const ScalewayIcon = () => (
  <img src={scalewayLogo} alt="Scaleway" width="24" height="24" />
);

// Fathom icon — brand logo
import fathomLogo from '../assets/fathom-logo.webp';
const FathomIcon = () => (
  <img src={fathomLogo} alt="Fathom" width="24" height="24" style={{ borderRadius: 4 }} />
);

// Otter.ai icon — "O" with audio bars
const OtterIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <circle cx="7" cy="12" r="5" />
    <circle cx="7" cy="12" r="2" fill="white" />
    <rect x="14" y="4" width="2.5" height="16" rx="1.25" />
    <rect x="18" y="6" width="2.5" height="12" rx="1.25" />
    <rect x="22" y="9" width="2" height="6" rx="1" />
  </svg>
);

// Outlook icon — blue envelope with O
const OutlookIcon = () => (
  <svg viewBox="0 0 24 24">
    <rect x="1" y="4" width="22" height="16" rx="2" fill="#0078D4" />
    <path d="M1 6l11 7 11-7" fill="none" stroke="white" strokeWidth="1.5" />
    <ellipse cx="8" cy="14" rx="4" ry="3.5" fill="#005A9E" />
    <text x="8" y="16" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="Arial">O</text>
  </svg>
);

// Gmail icon — brand logo
import gmailLogo from '../assets/gmail-logo.png';
const GmailIcon = () => (
  <img src={gmailLogo} alt="Gmail" width="24" height="24" />
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
    description: 'Connectez vos outils de gestion pour importer tickets, sprints et transcriptions dans vos reviews et delivery boards.',
    services: [
      {
        id: 'jira',
        name: 'Jira',
        description: 'Importez les tickets Jira dans Delivery, créez des tickets depuis SuiviTess.',
        color: '#0052CC',
        icon: <JiraIcon />,
        enabled: true,
      },
      {
        id: 'fathom',
        name: 'Fathom',
        description: 'Importez automatiquement vos transcriptions de meetings Fathom dans SuiviTess.',
        color: '#6366f1',
        icon: <FathomIcon />,
        enabled: true,
      },
      {
        id: 'otter',
        name: 'Otter.ai',
        description: 'Importez vos transcriptions Otter.ai dans SuiviTess.',
        color: '#3b82f6',
        icon: <OtterIcon />,
        enabled: true,
      },
      {
        id: 'notion',
        name: 'Notion',
        description: 'Créez une page Notion à partir d\'un sujet SuiviTess en un clic.',
        color: '#000000',
        icon: <NotionIcon />,
        enabled: true,
      },
      {
        id: 'clickup',
        name: 'ClickUp',
        description: 'Importez vos tâches et sprints ClickUp (bientôt disponible).',
        color: '#7B68EE',
        icon: <ClickUpIcon />,
        enabled: false,
      },
    ],
  },
  {
    title: 'Intelligence artificielle',
    description: 'Choisissez votre fournisseur d\'IA. Au moins un connecteur doit être actif pour utiliser la reformulation, l\'analyse de sujets, l\'export email et l\'adaptation de CV.',
    services: [
      {
        id: 'anthropic',
        name: 'Anthropic (Claude)',
        description: 'IA polyvalente — recommandée pour SuiviTess et l\'adaptation de CV.',
        color: '#D97757',
        icon: <ClaudeIcon />,
        enabled: true,
      },
      {
        id: 'openai',
        name: 'OpenAI',
        description: 'Modèles GPT + embeddings (nécessaire pour le RAG si Scaleway n\'est pas utilisé).',
        color: '#10a37f',
        icon: <OpenAIIcon />,
        enabled: true,
      },
      {
        id: 'mistral',
        name: 'Mistral',
        description: 'IA française — alternative à Claude et GPT.',
        color: '#F7D046',
        icon: <MistralIcon />,
        enabled: true,
      },
      {
        id: 'scaleway',
        name: 'Scaleway',
        description: 'LLM et embeddings hébergés en Europe (API compatible OpenAI).',
        color: '#4F0599',
        icon: <ScalewayIcon />,
        enabled: true,
      },
    ],
  },
  {
    title: 'Emails',
    description: 'Connectez votre boîte mail pour importer des échanges dans vos reviews SuiviTess en quelques clics.',
    services: [
      {
        id: 'outlook',
        name: 'Outlook',
        description: 'Microsoft 365 ou Outlook.com — importez vos emails dans SuiviTess.',
        color: '#0078D4',
        icon: <OutlookIcon />,
        enabled: true,
      },
      {
        id: 'gmail',
        name: 'Gmail',
        description: 'Google Workspace ou Gmail perso — importez vos emails dans SuiviTess.',
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
    throw new Error(data.error || 'Erreur lors de la déconnexion');
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
      setError('Impossible de vérifier le statut OAuth');
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
      setSuccessMessage('Connexion Jira OAuth réussie !');
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
              Compte connecté
            </div>
            {status.siteUrl && (
              <div className="connector-oauth-detail">
                <strong>Site</strong>
                <a href={status.siteUrl} target="_blank" rel="noopener noreferrer">{status.siteUrl}</a>
              </div>
            )}
            {status.connectedAt && (
              <div className="connector-oauth-detail">
                <strong>Connecté le</strong>
                <span>{new Date(status.connectedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
            )}
            {status.isExpired && (
              <div className="connector-oauth-detail warning">
                Session expirée — elle sera renouvelée automatiquement au prochain usage.
              </div>
            )}
          </div>

          <div className="connector-actions">
            <button
              className="connector-btn danger"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Déconnexion...' : 'Se déconnecter'}
            </button>
          </div>
        </div>
      ) : (
        <div className="connector-oauth-connect">
          <p className="connector-oauth-desc">
            Connectez votre compte Atlassian : vous serez redirigé vers Jira pour autoriser l'accès. Aucun mot de passe à saisir.
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
        message: `Connexion Jira réussie — vous êtes identifié en tant que ${result.user?.displayName}.`,
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
          <label htmlFor="jira-url">URL de votre Jira</label>
          <input
            id="jira-url"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://votre-equipe.atlassian.net"
          />
          <span className="connector-field-hint">
            Copiez l'URL de votre Jira (ex. https://ma-societe.atlassian.net)
          </span>
        </div>

        <div className="connector-field">
          <label htmlFor="jira-email">Votre email Atlassian</label>
          <input
            id="jira-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@example.com"
          />
          <span className="connector-field-hint">
            Utilisez l'email avec lequel vous vous connectez à Jira.
          </span>
        </div>

        <div className="connector-field">
          <label htmlFor="jira-token">Token API Atlassian</label>
          <input
            id="jira-token"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="Collez votre token ici"
          />
          <span className="connector-field-hint">
            Créez un token sur <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">id.atlassian.com/manage-profile/security/api-tokens</a>, puis collez-le ici.
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
              Enregistrement...
            </span>
          ) : (
            'Enregistrer'
          )}
        </button>

        <button
          className="connector-btn secondary"
          onClick={handleTest}
          disabled={testing || !connector}
          title="Vérifie que les identifiants sont corrects et affiche le nom du compte Jira"
        >
          {testing ? (
            <span className="connector-loading">
              <span className="connector-spinner" />
              Vérification...
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
            title="Supprime le connecteur et ses identifiants"
          >
            {deleting ? 'Suppression...' : 'Supprimer le connecteur'}
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
          <span className={`connector-expand-icon${expanded ? ' expanded' : ''}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
          <div
            className="connector-card-icon"
            style={{ color: service.color }}
          >
            {service.icon}
          </div>
          <div className="connector-card-info">
            <div className="connector-card-name">{service.name}</div>
            <div className="connector-card-desc">{service.description}</div>
          </div>
        </div>

        <div className="connector-card-right">
          <div className={`connector-status ${isActive ? 'active' : connector ? 'active' : 'inactive'}`}>
            <span className="connector-status-dot" />
            {isActive ? 'Connecté' : (connector || isConfigured) ? 'À tester' : 'Non connecté'}
          </div>
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
          <div className="connector-card-icon" style={{ color: service.color }}>
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
    { key: 'apiKey', label: 'Clé API Anthropic', type: 'password', required: true, placeholder: 'sk-ant-...', hint: 'Créez une clé sur console.anthropic.com > Settings > API Keys.' },
    { key: 'model', label: 'Modèle (optionnel)', type: 'text', placeholder: 'claude-sonnet-4-6', hint: 'Laissez vide pour utiliser le modèle recommandé.' },
  ],
  openai: [
    { key: 'apiKey', label: 'Clé API OpenAI', type: 'password', required: true, placeholder: 'sk-...', hint: 'Créez une clé sur platform.openai.com > API keys.' },
    { key: 'model', label: 'Modèle chat (optionnel)', type: 'text', placeholder: 'gpt-4o', hint: 'Laissez vide pour le modèle par défaut.' },
    { key: 'embeddingModel', label: 'Modèle embedding (optionnel)', type: 'text', placeholder: 'text-embedding-3-small', hint: 'Utilisé par le RAG. Laissez vide pour le modèle par défaut.' },
  ],
  mistral: [
    { key: 'apiKey', label: 'Clé API Mistral', type: 'password', required: true, placeholder: 'Collez votre clé ici', hint: 'Créez une clé sur console.mistral.ai.' },
    { key: 'model', label: 'Modèle (optionnel)', type: 'text', placeholder: 'mistral-large-latest', hint: 'Laissez vide pour utiliser le modèle par défaut.' },
    { key: 'baseUrl', label: 'URL de l\'API (optionnel)', type: 'text', placeholder: 'https://api.mistral.ai/v1', hint: 'Ne modifiez que si vous utilisez un endpoint custom.' },
  ],
  scaleway: [
    { key: 'apiKey', label: 'Clé API Scaleway', type: 'password', required: true, placeholder: 'Collez votre clé ici', hint: 'Disponible dans votre console Scaleway > IAM > Clés API.' },
    { key: 'baseUrl', label: 'URL de l\'API', type: 'text', required: true, placeholder: 'https://api.scaleway.ai/v1', hint: 'URL de votre projet Scaleway Generative APIs.' },
    { key: 'chatModel', label: 'Modèle chat (optionnel)', type: 'text', placeholder: 'qwen3-32b' },
    { key: 'embeddingModel', label: 'Modèle embedding (optionnel)', type: 'text', placeholder: 'bge-multilingual-gemma2' },
  ],
};

const AI_SERVICE_IDS = new Set(['anthropic', 'openai', 'mistral', 'scaleway']);

// Transcription providers use simple API keys
AI_FIELDS['fathom'] = [
  { key: 'apiKey', label: 'Clé API Fathom', type: 'password', required: true, placeholder: 'fathom_...', hint: 'Disponible dans Fathom > Settings > API.' },
];

AI_FIELDS['otter'] = [
  { key: 'apiKey', label: 'Clé API Otter.ai', type: 'password', required: true, placeholder: 'Collez votre clé ici' },
  { key: 'baseUrl', label: 'URL de l\'API (optionnel)', type: 'text', placeholder: 'https://api.otter.ai/v1', hint: 'Ne modifiez que si vous utilisez un endpoint custom.' },
];

AI_FIELDS['notion'] = [
  { key: 'apiKey', label: 'Token d\'intégration Notion', type: 'password', required: true, placeholder: 'secret_...', hint: 'Créez une intégration sur notion.so/profile/integrations, puis partagez vos bases de données avec elle.' },
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
      setTestResult({ success: true, message: `Connexion réussie ! Modele : ${result.model || '?'}` });
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
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        <button
          className="connector-btn secondary"
          onClick={handleTest}
          disabled={testing || !connector}
          title="Envoie une requête test pour vérifier que la clé fonctionne"
        >
          {testing ? 'Vérification...' : 'Tester la connexion'}
        </button>
        {connector && (
          <button
            className="connector-btn danger"
            onClick={handleDelete}
            disabled={deleting}
            title="Supprime le connecteur et ses identifiants"
          >
            {deleting ? 'Suppression...' : 'Supprimer le connecteur'}
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
          <span className={`connector-expand-icon${expanded ? ' expanded' : ''}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
          <div className="connector-card-icon" style={{ color: service.color }}>
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
          <div className={`connector-status ${(isActive || oauthConnected) ? 'active' : connector ? 'active' : 'inactive'}`}>
            <span className="connector-status-dot" />
            {oauthConnected ? 'Connecté' : isActive ? 'Connecté' : connector ? 'À tester' : 'Non connecté'}
          </div>
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
                  La connexion {service.name} n'est pas encore activée sur cette instance. Contactez un administrateur pour l'activer.
                </div>
              ) : oauthConnected ? (
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: '0 0 var(--spacing-sm)' }}>
                    Votre compte {service.name} est connecté. Vous pouvez l'utiliser dans les modules.
                  </p>
                  {oauthStatus?.isExpired && (
                    <p style={{ color: 'var(--color-warning)', fontSize: 'var(--font-size-xs)', margin: '0 0 var(--spacing-sm)' }}>
                      Session expirée — cliquez sur « Se reconnecter » pour rafraîchir l'accès.
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                    <button className="connector-btn connector-btn-primary" onClick={handleOAuthConnect}>Se reconnecter</button>
                    <button className="connector-btn connector-btn-danger" onClick={handleOAuthDisconnect}>Se déconnecter</button>
                  </div>
                </div>
              ) : (
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', margin: '0 0 var(--spacing-md)' }}>
                    Connectez votre compte {service.name} pour importer vos données. Vous serez redirigé vers {service.name} pour autoriser l'accès — aucun mot de passe à saisir ici.
                  </p>
                  <button className="connector-btn connector-btn-primary" onClick={handleOAuthConnect}>
                    Se connecter avec {service.name}
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
          <div className="connector-card-icon" style={{ color: service.color }}>
            {service.icon}
          </div>
          <div className="connector-card-info">
            <div className="connector-card-name">{service.name}</div>
            <div className="connector-card-desc">{service.description}</div>
          </div>
        </div>
        <div className="connector-card-right">
          {status?.connected ? (
            <span className="connector-status active">Connecté</span>
          ) : (
            <span className="connector-status inactive">Non connecté</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="connector-card-body" style={{ padding: 'var(--spacing-md)' }}>
          {loading ? (
            <div className="connector-loading"><span className="connector-spinner" /><span>Chargement...</span></div>
          ) : !oauthAvail && !status?.connected ? (
            <div className="connectors-error">OAuth {service.name} non configuré sur le serveur. Ajoutez les variables {provider.toUpperCase()}_OAUTH_CLIENT_ID et {provider.toUpperCase()}_OAUTH_CLIENT_SECRET.</div>
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
        Configurez vos connexions aux services externes. Les identifiants sont stockés par utilisateur.
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

      {/* ==================== Collecteurs automatiques ==================== */}
      <CollectorsSection />

      </div>
    </>
  );
}

// ==================== Collectors Section ====================

function CollectorsSection() {
  const [slackStatus, setSlackStatus] = useState<{
    configured: boolean;
    isActive?: boolean;
    lastSyncAt?: string | null;
    channelCount?: number;
    channels?: Array<{ id: string; name: string }>;
    messageCount?: number;
    daysToFetch?: number;
  } | null>(null);
  const [outlookStatus, setOutlookStatus] = useState<{
    configured: boolean;
    messageCount?: number;
  } | null>(null);
  const [slackSyncing, setSlackSyncing] = useState(false);
  const [slackExpanded, setSlackExpanded] = useState(false);
  const [outlookExpanded, setOutlookExpanded] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const [slack, outlook] = await Promise.all([
        fetch('/suivitess-api/slack/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { configured: false }).catch(() => ({ configured: false })),
        fetch('/suivitess-api/outlook/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { configured: false }).catch(() => ({ configured: false })),
      ]);
      setSlackStatus(slack);
      setOutlookStatus(outlook);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleSlackSync = async () => {
    setSlackSyncing(true);
    try {
      await fetch('/suivitess-api/slack/sync-now', { method: 'POST', credentials: 'include' });
      await loadStatus();
    } catch { /* ignore */ }
    setSlackSyncing(false);
  };

  const handleSlackDisconnect = async () => {
    try {
      await fetch('/suivitess-api/slack/configure', { method: 'DELETE', credentials: 'include' });
      setSlackStatus({ configured: false });
    } catch { /* ignore */ }
  };

  const formatTimeAgo = (iso: string | null | undefined): string => {
    if (!iso) return 'jamais';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return 'à l\'instant';
    if (diff < 3600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
    if (diff < 86400_000) return `il y a ${Math.floor(diff / 3600_000)}h`;
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="connectors-group">
      <h3 className="connectors-group-title">Collecteurs automatiques</h3>
      <p className="connectors-group-desc">
        Récupérez automatiquement vos messages Slack et emails Outlook pour les importer dans SuiviTess via « Importer & ranger ».
      </p>
      <div className="connectors-list">

        {/* ── Slack Collector Card ── */}
        <div className="connector-card">
          <div className="connector-card-header" onClick={() => setSlackExpanded(v => !v)}>
            <div className="connector-card-left">
              <div className="connector-card-icon" style={{ background: 'transparent' }}>
                <svg style={{ width: 36, height: 36 }} viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
                  <g>
                    <path fill="#E01E5A" d="M99.4,151.2c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9h12.9V151.2z"/>
                    <path fill="#E01E5A" d="M105.9,151.2c0-7.1,5.8-12.9,12.9-12.9s12.9,5.8,12.9,12.9v32.3c0,7.1-5.8,12.9-12.9,12.9s-12.9-5.8-12.9-12.9V151.2z"/>
                    <path fill="#36C5F0" d="M118.8,99.4c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9s12.9,5.8,12.9,12.9v12.9H118.8z"/>
                    <path fill="#36C5F0" d="M118.8,105.9c7.1,0,12.9,5.8,12.9,12.9s-5.8,12.9-12.9,12.9H86.5c-7.1,0-12.9-5.8-12.9-12.9s5.8-12.9,12.9-12.9H118.8z"/>
                    <path fill="#2EB67D" d="M170.6,118.8c0-7.1,5.8-12.9,12.9-12.9c7.1,0,12.9,5.8,12.9,12.9s-5.8,12.9-12.9,12.9h-12.9V118.8z"/>
                    <path fill="#2EB67D" d="M164.1,118.8c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9V86.5c0-7.1,5.8-12.9,12.9-12.9c7.1,0,12.9,5.8,12.9,12.9V118.8z"/>
                    <path fill="#ECB22E" d="M151.2,170.6c7.1,0,12.9,5.8,12.9,12.9c0,7.1-5.8,12.9-12.9,12.9c-7.1,0-12.9-5.8-12.9-12.9v-12.9H151.2z"/>
                    <path fill="#ECB22E" d="M151.2,164.1c-7.1,0-12.9-5.8-12.9-12.9c0-7.1,5.8-12.9,12.9-12.9h32.3c7.1,0,12.9,5.8,12.9,12.9c0,7.1-5.8,12.9-12.9,12.9H151.2z"/>
                  </g>
                </svg>
              </div>
              <div className="connector-card-info">
                <div className="connector-card-name">Slack</div>
                <div className="connector-card-desc">
                  {slackStatus?.configured
                    ? `${slackStatus.messageCount ?? 0} messages · ${slackStatus.channelCount ?? 0} channel${(slackStatus.channelCount ?? 0) > 1 ? 's' : ''} · sync ${formatTimeAgo(slackStatus.lastSyncAt)}`
                    : 'Collecte automatique des messages Slack (toutes les heures)'}
                </div>
              </div>
            </div>
            <div className="connector-card-right">
              <div className={`connector-status ${slackStatus?.configured ? 'active' : 'inactive'}`}>
                <span className="connector-status-dot" />
                {slackStatus?.configured ? 'Connecté' : 'Non connecté'}
              </div>
              <span className={`connector-expand-icon${slackExpanded ? ' expanded' : ''}`}>&#x25BC;</span>
            </div>
          </div>
          {slackExpanded && (
            <div className="connector-card-body" style={{ padding: 'var(--spacing-md)' }}>
              {slackStatus?.configured ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                      Channels surveillés :
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {(slackStatus.channels || []).map(ch => (
                        <span key={ch.id} style={{
                          padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                          fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-primary)',
                        }}>
                          #{ch.name}
                        </span>
                      ))}
                    </div>
                    <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                      Récupère les {slackStatus.daysToFetch ?? 7} derniers jours · Sync automatique toutes les heures
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                    <button className="connector-btn connector-btn-primary" onClick={handleSlackSync} disabled={slackSyncing}>
                      {slackSyncing ? 'Synchronisation...' : 'Synchroniser maintenant'}
                    </button>
                    <button className="connector-btn connector-btn-danger" onClick={handleSlackDisconnect}>
                      Se déconnecter
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    Pour connecter Slack, utilisez l'extension Chrome SuiviTess Importer :
                  </p>
                  <ol style={{ margin: 0, paddingLeft: 'var(--spacing-lg)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', lineHeight: 2 }}>
                    <li>Installez l'extension SuiviTess Importer</li>
                    <li>Ouvrez <a href="https://app.slack.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>Slack</a> dans Chrome</li>
                    <li>Cliquez sur l'extension → « Connecter et synchroniser »</li>
                  </ol>
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                    Le serveur collectera ensuite les messages automatiquement toutes les heures.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Outlook Collector Card ── */}
        <div className="connector-card">
          <div className="connector-card-header" onClick={() => setOutlookExpanded(v => !v)}>
            <div className="connector-card-left">
              <div className="connector-card-icon" style={{ background: 'transparent' }}>
                <OutlookIcon />
              </div>
              <div className="connector-card-info">
                <div className="connector-card-name">Outlook</div>
                <div className="connector-card-desc">
                  {outlookStatus?.configured && (outlookStatus.messageCount ?? 0) > 0
                    ? `${outlookStatus.messageCount} email${(outlookStatus.messageCount ?? 0) > 1 ? 's' : ''} synchronisé${(outlookStatus.messageCount ?? 0) > 1 ? 's' : ''}`
                    : 'Synchronisez vos emails Outlook via l\'extension Chrome'}
                </div>
              </div>
            </div>
            <div className="connector-card-right">
              <div className={`connector-status ${outlookStatus?.configured && (outlookStatus.messageCount ?? 0) > 0 ? 'active' : 'inactive'}`}>
                <span className="connector-status-dot" />
                {outlookStatus?.configured && (outlookStatus.messageCount ?? 0) > 0 ? 'Synchronisé' : 'Non synchronisé'}
              </div>
              <span className={`connector-expand-icon${outlookExpanded ? ' expanded' : ''}`}>&#x25BC;</span>
            </div>
          </div>
          {outlookExpanded && (
            <div className="connector-card-body" style={{ padding: 'var(--spacing-md)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                {outlookStatus?.configured && (outlookStatus.messageCount ?? 0) > 0 ? (
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--success)' }}>
                    ✓ {outlookStatus.messageCount} email{(outlookStatus.messageCount ?? 0) > 1 ? 's' : ''} disponible{(outlookStatus.messageCount ?? 0) > 1 ? 's' : ''} dans « Importer & ranger ».
                  </p>
                ) : (
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    Pour synchroniser vos emails :
                  </p>
                )}
                <ol style={{ margin: 0, paddingLeft: 'var(--spacing-lg)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', lineHeight: 2 }}>
                  <li>
                    <a href="https://outlook.office.com/mail/" target="_blank" rel="noopener noreferrer"
                       style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                      Ouvrir Outlook →
                    </a>
                  </li>
                  <li>Cliquez sur l'extension SuiviTess Importer dans Chrome</li>
                  <li>Les emails se synchronisent automatiquement</li>
                </ol>
                <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Les emails synchronisés apparaissent dans SuiviTess {'>'} « Importer {'&'} ranger », groupés par jour.
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
