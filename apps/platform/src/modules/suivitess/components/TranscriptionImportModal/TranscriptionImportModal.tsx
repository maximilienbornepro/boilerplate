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
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadCalls();
  }, [provider]);

  const loadCalls = async () => {
    setLoading(true);
    setError('');
    setCalls([]);
    try {
      const res = await fetch(`${API_BASE}/transcription/calls?provider=${provider}&days=30`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      const data = await res.json();
      setCalls(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (call: TranscriptionCall) => {
    setImporting(call.id);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          callId: call.id,
          callTitle: call.title,
          provider,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      const data = await res.json();
      setSuccess(`"${call.title}" importé — ${data.subjectCount} sujets créés dans la section "${data.sectionName}"`);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'import');
    } finally {
      setImporting(null);
    }
  };

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
                  onClick={() => handleImport(call)}
                  disabled={importing !== null}
                >
                  {importing === call.id ? 'Import...' : 'Importer'}
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
