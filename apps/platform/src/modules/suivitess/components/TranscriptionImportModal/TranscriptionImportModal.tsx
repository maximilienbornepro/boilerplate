import { useState, useEffect } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import styles from './TranscriptionImportModal.module.css';

interface TranscriptionCall {
  id: string;
  title: string;
  date: string;
  duration?: number;
  url?: string;
}

interface AIProviderInfo {
  service: string;
  isActive: boolean;
}

interface TranscriptionImportModalProps {
  documentId: string;
  onClose: () => void;
  onImported: () => void;
}

const API_BASE = '/suivitess-api';

const PROVIDERS = [
  { id: 'fathom', label: 'Fathom' },
  { id: 'otter', label: 'Otter.ai' },
];

const AI_PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'scaleway', label: 'Scaleway' },
];

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  return `${m} min`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function TranscriptionImportModal({ documentId, onClose, onImported }: TranscriptionImportModalProps) {
  const [provider, setProvider] = useState('fathom');
  const [calls, setCalls] = useState<TranscriptionCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Step 2: after selecting a call, choose import mode
  const [selectedCall, setSelectedCall] = useState<TranscriptionCall | null>(null);
  const [importing, setImporting] = useState(false);
  const [connectedAI, setConnectedAI] = useState<string[]>([]);
  const [selectedAI, setSelectedAI] = useState<string | null>(null);

  useEffect(() => {
    loadCalls();
  }, [provider]);

  // Load connected AI providers from connectors
  useEffect(() => {
    fetch('/api/connectors', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((connectors: AIProviderInfo[]) => {
        const active = connectors
          .filter(c => c.isActive && AI_PROVIDERS.some(ai => ai.id === c.service))
          .map(c => c.service);
        setConnectedAI(active);
        if (active.length > 0 && !selectedAI) setSelectedAI(active[0]);
      })
      .catch(() => {});
  }, []);

  const loadCalls = async () => {
    setLoading(true);
    setError('');
    setCalls([]);
    setSelectedCall(null);
    try {
      const res = await fetch(`${API_BASE}/transcription/calls?provider=${provider}&days=30`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      setCalls(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (useAI: boolean) => {
    if (!selectedCall) return;
    setImporting(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          callId: selectedCall.id,
          callTitle: selectedCall.title,
          provider,
          useAI,
          aiProvider: useAI ? selectedAI : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      const data = await res.json();
      const modeLabel = data.mode === 'ai' ? 'analyse IA' : 'import brut';
      setSuccess(`"${selectedCall.title}" importé (${modeLabel}) — ${data.subjectCount} sujets dans "${data.sectionName}"`);
      setSelectedCall(null);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'import');
    } finally {
      setImporting(false);
    }
  };

  // ── Step 2: import mode selection ──
  if (selectedCall) {
    return (
      <Modal title="Mode d'import" onClose={() => setSelectedCall(null)}>
        <div className={styles.body}>
          <div className={styles.selectedCallInfo}>
            <span className={styles.callTitle}>{selectedCall.title}</span>
            <span className={styles.callMeta}>{formatDate(selectedCall.date)}</span>
          </div>

          {error && <div className={styles.error}>{error}</div>}
          {success && <div className={styles.success}>{success}</div>}

          <div className={styles.importOptions}>
            {/* AI option */}
            <div className={styles.importOption}>
              <div className={styles.importOptionHeader}>
                <strong>Analyse IA</strong>
                <span className={styles.importOptionDesc}>
                  L'IA extrait les sujets clés, résumés et responsables
                </span>
              </div>
              {connectedAI.length > 0 ? (
                <>
                  <select
                    className={styles.aiSelect}
                    value={selectedAI || ''}
                    onChange={e => setSelectedAI(e.target.value)}
                  >
                    {connectedAI.map(id => {
                      const ai = AI_PROVIDERS.find(a => a.id === id);
                      return <option key={id} value={id}>{ai?.label || id}</option>;
                    })}
                  </select>
                  <Button
                    variant="primary"
                    onClick={() => handleImport(true)}
                    disabled={importing}
                  >
                    {importing ? 'Analyse en cours...' : 'Analyser avec l\'IA'}
                  </Button>
                </>
              ) : (
                <span className={styles.noAI}>
                  Aucune IA configurée. Ajoutez une clé API dans Réglages &gt; Connecteurs.
                </span>
              )}
            </div>

            <div className={styles.separator}>ou</div>

            {/* Raw option */}
            <div className={styles.importOption}>
              <div className={styles.importOptionHeader}>
                <strong>Import brut</strong>
                <span className={styles.importOptionDesc}>
                  Importe la transcription telle quelle, groupée par intervenant
                </span>
              </div>
              <Button
                variant="secondary"
                onClick={() => handleImport(false)}
                disabled={importing}
              >
                {importing ? 'Import...' : 'Importer sans IA'}
              </Button>
            </div>
          </div>

          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => setSelectedCall(null)}>Retour</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Step 1: call selection ──
  return (
    <Modal title="Importer une transcription" onClose={onClose}>
      <div className={styles.body}>
        <div className={styles.providerRow}>
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              className={`${styles.providerBtn} ${provider === p.id ? styles.active : ''}`}
              onClick={() => setProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        {loading ? (
          <LoadingSpinner message="Chargement des appels..." />
        ) : calls.length === 0 ? (
          <div className={styles.empty}>
            Aucun appel trouvé sur les 30 derniers jours.
            <br />
            <span className={styles.emptyHint}>Vérifiez que le connecteur {provider} est configuré dans Réglages &gt; Connecteurs.</span>
          </div>
        ) : (
          <div className={styles.callList}>
            {calls.map(call => (
              <div key={call.id} className={styles.callItem}>
                <div className={styles.callInfo}>
                  <span className={styles.callTitle}>{call.title}</span>
                  <span className={styles.callMeta}>
                    {formatDate(call.date)}
                    {call.duration ? ` · ${formatDuration(call.duration)}` : ''}
                  </span>
                </div>
                <Button
                  variant="primary"
                  onClick={() => setSelectedCall(call)}
                >
                  Sélectionner
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </Modal>
  );
}
