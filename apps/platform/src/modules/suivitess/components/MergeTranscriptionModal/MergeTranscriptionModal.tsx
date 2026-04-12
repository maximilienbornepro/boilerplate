import { useState, useEffect } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import styles from './MergeTranscriptionModal.module.css';

interface Section {
  id: string;
  name: string;
  subjects: Array<{ id: string; title: string }>;
}

interface AIProviderOption {
  id: string;
  label: string;
}

interface MergeResult {
  updatedCount: number;
  createdCount: number;
  changes: Array<{ action: string; reason: string }>;
}

interface MergeTranscriptionModalProps {
  documentId: string;
  onClose: () => void;
  onMerged: () => void;
}

const API_BASE = '/suivitess-api';

const AI_PROVIDERS: AIProviderOption[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'scaleway', label: 'Scaleway' },
];

export function MergeTranscriptionModal({ documentId, onClose, onMerged }: MergeTranscriptionModalProps) {
  const [connectedAI, setConnectedAI] = useState<string[]>([]);
  const [selectedAI, setSelectedAI] = useState<string>('');
  const [selectedSection, setSelectedSection] = useState<string>('');
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState('');
  const [sections, setSections] = useState<Section[]>([]);
  const [loadingSections, setLoadingSections] = useState(true);

  // Fetch document sections
  useEffect(() => {
    fetch(`${API_BASE}/documents/${documentId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(doc => {
        if (doc?.sections) {
          setSections(doc.sections.map((s: { id: string; name: string; subjects: Array<{ id: string; title: string }> }) => ({
            id: s.id,
            name: s.name,
            subjects: s.subjects || [],
          })));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSections(false));
  }, [documentId]);

  // Filter sections that come from transcription imports (Fathom, Otter, etc.)
  const transcriptionSections = sections.filter(s =>
    /^(Fathom|Otter|Transcription)\s*[—–-]/i.test(s.name)
  );

  useEffect(() => {
    fetch('/api/connectors', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((connectors: Array<{ service: string; isActive: boolean }>) => {
        const active = connectors
          .filter(c => c.isActive && AI_PROVIDERS.some(ai => ai.id === c.service))
          .map(c => c.service);
        setConnectedAI(active);
        if (active.length > 0) setSelectedAI(active[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (transcriptionSections.length > 0 && !selectedSection) {
      setSelectedSection(transcriptionSections[0].id);
    }
  }, [transcriptionSections]);

  const handleMerge = async () => {
    if (!selectedSection || !selectedAI) return;
    setMerging(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sectionId: selectedSection }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      const data: MergeResult = await res.json();
      setResult(data);
      onMerged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la fusion');
    } finally {
      setMerging(false);
    }
  };

  return (
    <Modal title="Fusionner la transcription" onClose={onClose}>
      <div className={styles.body}>
        {loadingSections ? (
          <LoadingSpinner message="Chargement..." />
        ) : transcriptionSections.length === 0 ? (
          <div className={styles.empty}>
            Aucune section de transcription trouvée dans ce document.
            <br />
            <span className={styles.emptyHint}>
              Importez d'abord une transcription via le bouton "Transcription".
            </span>
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label>Section à fusionner</label>
              <select
                value={selectedSection}
                onChange={e => setSelectedSection(e.target.value)}
              >
                {transcriptionSections.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.subjects.length} sujets)
                  </option>
                ))}
              </select>
              <span className={styles.hint}>
                Les sujets de cette section seront analysés et fusionnés avec les sujets existants.
              </span>
            </div>

            <div className={styles.field}>
              <label>IA à utiliser</label>
              {connectedAI.length > 0 ? (
                <select
                  value={selectedAI}
                  onChange={e => setSelectedAI(e.target.value)}
                >
                  {connectedAI.map(id => {
                    const ai = AI_PROVIDERS.find(a => a.id === id);
                    return <option key={id} value={id}>{ai?.label || id}</option>;
                  })}
                </select>
              ) : (
                <span className={styles.noAI}>
                  Aucune IA configurée. Ajoutez une clé API dans Réglages &gt; Connecteurs.
                </span>
              )}
            </div>

            {error && <div className={styles.error}>{error}</div>}

            {result && (
              <div className={styles.result}>
                <div className={styles.resultSummary}>
                  <strong>{result.updatedCount}</strong> sujets mis à jour,{' '}
                  <strong>{result.createdCount}</strong> sujets créés
                </div>
                {result.changes.length > 0 && (
                  <ul className={styles.changeList}>
                    {result.changes.map((c, i) => (
                      <li key={i}>
                        <span className={c.action === 'create' ? styles.actionCreate : styles.actionUpdate}>
                          {c.action === 'create' ? '+ Créé' : '↻ Mis à jour'}
                        </span>
                        {' '}{c.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>
                {result ? 'Fermer' : 'Annuler'}
              </Button>
              {!result && (
                <Button
                  variant="primary"
                  onClick={handleMerge}
                  disabled={merging || !selectedAI || !selectedSection}
                >
                  {merging ? 'Analyse en cours...' : 'Fusionner avec l\'IA'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
