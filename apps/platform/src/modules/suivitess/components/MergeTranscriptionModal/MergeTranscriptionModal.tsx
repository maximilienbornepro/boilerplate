import { useState, useEffect } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import styles from './MergeTranscriptionModal.module.css';

interface Section {
  id: string;
  name: string;
  subjects: Array<{ id: string; title: string }>;
}

interface Proposal {
  id: number;
  action: 'enrich' | 'create_subject' | 'create_section';
  // enrich
  subjectId?: string;
  subjectTitle?: string;
  sectionName?: string;
  appendText?: string;
  // create_subject
  sectionId?: string;
  title?: string;
  situation?: string;
  responsibility?: string | null;
  status?: string;
  // create_section
  subjects?: Array<{ title: string; situation: string; responsibility?: string | null; status?: string }>;
  // shared
  reason?: string;
}

const AI_PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'scaleway', label: 'Scaleway' },
];

const API_BASE = '/suivitess-api';

interface MergeTranscriptionModalProps {
  documentId: string;
  onClose: () => void;
  onMerged: () => void;
}

export function MergeTranscriptionModal({ documentId, onClose, onMerged }: MergeTranscriptionModalProps) {
  const [connectedAI, setConnectedAI] = useState<string[]>([]);
  const [selectedAI, setSelectedAI] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [sections, setSections] = useState<Section[]>([]);
  const [loadingSections, setLoadingSections] = useState(true);

  // Step 2: proposals (mutable — user can change section targets)
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ enriched: number; created: number; sectionsCreated: number } | null>(null);

  // Non-transcription sections (targets for create_subject)
  const existingSections = sections.filter(s =>
    !/^(Fathom|Otter|Transcription)\s*[—–-]/i.test(s.name)
  );

  // Fetch document + AI providers
  useEffect(() => {
    fetch(`${API_BASE}/documents/${documentId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(doc => {
        if (doc?.sections) setSections(doc.sections);
      })
      .catch(() => {})
      .finally(() => setLoadingSections(false));

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
  }, [documentId]);

  const transcriptionSections = sections.filter(s =>
    /^(Fathom|Otter|Transcription)\s*[—–-]/i.test(s.name)
  );

  useEffect(() => {
    if (transcriptionSections.length > 0 && !selectedSection) {
      setSelectedSection(transcriptionSections[0].id);
    }
  }, [sections]);

  const handleAnalyze = async () => {
    if (!selectedSection || !selectedAI) return;
    setAnalyzing(true);
    setError('');
    setProposals([]);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sectionId: selectedSection }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `Erreur ${res.status}`);
      const data = await res.json();
      setProposals(data.proposals || []);
      // All selected by default
      setSelected(new Set((data.proposals || []).map((p: Proposal) => p.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleProposal = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === proposals.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(proposals.map(p => p.id)));
    }
  };

  const updateProposal = (id: number, updates: Partial<Proposal>) => {
    setProposals(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  // Convert an enrich proposal to a create_subject (user decides the target is wrong)
  const convertToCreate = (p: Proposal) => {
    updateProposal(p.id, {
      action: 'create_subject',
      sectionId: existingSections[0]?.id || '',
      sectionName: existingSections[0]?.name || '',
      title: p.subjectTitle || 'Nouveau sujet',
      situation: p.appendText || '',
    });
  };

  // Change the target section for a create_subject proposal
  const changeTargetSection = (proposalId: number, newSectionId: string) => {
    if (newSectionId === '__new__') {
      // Convert to create_section
      const p = proposals.find(pr => pr.id === proposalId);
      if (!p) return;
      updateProposal(proposalId, {
        action: 'create_section',
        sectionName: p.title || 'Nouvelle section',
        sectionId: undefined,
        subjects: [{ title: p.title || '', situation: p.situation || '', responsibility: p.responsibility, status: p.status }],
      });
    } else {
      const section = existingSections.find(s => s.id === newSectionId);
      updateProposal(proposalId, {
        sectionId: newSectionId,
        sectionName: section?.name || '',
      });
    }
  };

  const handleApply = async () => {
    const toApply = proposals.filter(p => selected.has(p.id));
    if (toApply.length === 0) return;
    setApplying(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ proposals: toApply }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `Erreur ${res.status}`);
      const data = await res.json();
      setResult(data);
      onMerged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setApplying(false);
    }
  };

  const renderProposal = (p: Proposal) => {
    const isSelected = selected.has(p.id);

    if (p.action === 'enrich') {
      return (
        <div key={p.id} className={`${styles.proposal} ${isSelected ? styles.selected : ''}`}>
          <input type="checkbox" checked={isSelected} onChange={() => toggleProposal(p.id)} />
          <div className={styles.proposalContent}>
            <div className={styles.proposalAction}>
              <span className={styles.actionEnrich}>↻ Enrichir</span>
              <span className={styles.proposalTarget}>
                {p.subjectTitle || 'sujet'} <span className={styles.inSection}>dans {p.sectionName}</span>
              </span>
            </div>
            <div className={styles.proposalDetail}>{p.appendText}</div>
            {p.reason && <div className={styles.proposalReason}>{p.reason}</div>}
            <button
              className={styles.convertBtn}
              onClick={(e) => { e.stopPropagation(); convertToCreate(p); }}
              title="Convertir en nouveau sujet (si le sujet cible n'est pas le bon)"
            >
              Créer comme nouveau sujet
            </button>
          </div>
        </div>
      );
    }

    if (p.action === 'create_subject') {
      return (
        <div key={p.id} className={`${styles.proposal} ${isSelected ? styles.selected : ''}`}>
          <input type="checkbox" checked={isSelected} onChange={() => toggleProposal(p.id)} />
          <div className={styles.proposalContent}>
            <div className={styles.proposalAction}>
              <span className={styles.actionCreate}>+ Sujet</span>
              <span className={styles.proposalTarget}>{p.title}</span>
            </div>
            <div className={styles.sectionSelector}>
              <span className={styles.selectorLabel}>Section :</span>
              <select
                className={styles.sectionSelect}
                value={p.sectionId || ''}
                onChange={(e) => changeTargetSection(p.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
              >
                {existingSections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                <option value="__new__">+ Nouvelle section</option>
              </select>
            </div>
            {p.situation && <div className={styles.proposalDetail}>{p.situation}</div>}
            {p.reason && <div className={styles.proposalReason}>{p.reason}</div>}
          </div>
        </div>
      );
    }

    if (p.action === 'create_section') {
      return (
        <div key={p.id} className={`${styles.proposal} ${isSelected ? styles.selected : ''}`}>
          <input type="checkbox" checked={isSelected} onChange={() => toggleProposal(p.id)} />
          <div className={styles.proposalContent}>
            <div className={styles.proposalAction}>
              <span className={styles.actionSection}>+ Section</span>
              <input
                type="text"
                className={styles.sectionNameInput}
                value={p.sectionName || ''}
                onChange={(e) => { e.stopPropagation(); updateProposal(p.id, { sectionName: e.target.value }); }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Nom de la section"
              />
            </div>
            {p.subjects && p.subjects.length > 0 && (
              <ul className={styles.subjectsList}>
                {p.subjects.map((s, i) => (
                  <li key={i}>{s.title}</li>
                ))}
              </ul>
            )}
            {p.reason && <div className={styles.proposalReason}>{p.reason}</div>}
          </div>
        </div>
      );
    }

    return null;
  };

  // ── Result view ──
  if (result) {
    return (
      <Modal title="Fusion terminée" onClose={onClose}>
        <div className={styles.body}>
          <div className={styles.resultBox}>
            <p><strong>{result.enriched}</strong> sujets enrichis</p>
            <p><strong>{result.created}</strong> sujets créés</p>
            {result.sectionsCreated > 0 && <p><strong>{result.sectionsCreated}</strong> sections créées</p>}
          </div>
          <div className={styles.actions}>
            <Button variant="primary" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Proposals view ──
  if (proposals.length > 0) {
    return (
      <Modal title="Propositions de fusion" onClose={() => setProposals([])}>
        <div className={styles.body}>
          <div className={styles.selectAllRow}>
            <label className={styles.selectAll}>
              <input type="checkbox" checked={selected.size === proposals.length} onChange={toggleAll} />
              <span>{selected.size === proposals.length ? 'Tout désélectionner' : 'Tout sélectionner'}</span>
            </label>
            <span className={styles.selectionCount}>{selected.size}/{proposals.length} sélectionnés</span>
          </div>

          <div className={styles.proposalList}>
            {proposals.map(renderProposal)}
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setProposals([])}>Annuler</Button>
            <Button
              variant="primary"
              onClick={handleApply}
              disabled={applying || selected.size === 0}
            >
              {applying ? 'Application...' : `Appliquer (${selected.size})`}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Initial config view ──
  return (
    <Modal title="Fusionner la transcription" onClose={onClose}>
      <div className={styles.body}>
        {loadingSections ? (
          <LoadingSpinner message="Chargement..." />
        ) : transcriptionSections.length === 0 ? (
          <div className={styles.empty}>
            Aucune section de transcription trouvée.
            <br />
            <span className={styles.emptyHint}>Importez d'abord via le bouton "Transcription".</span>
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label>Section à fusionner</label>
              <select value={selectedSection} onChange={e => setSelectedSection(e.target.value)}>
                {transcriptionSections.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.subjects.length} sujets)</option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label>IA à utiliser</label>
              {connectedAI.length > 0 ? (
                <select value={selectedAI} onChange={e => setSelectedAI(e.target.value)}>
                  {connectedAI.map(id => {
                    const ai = AI_PROVIDERS.find(a => a.id === id);
                    return <option key={id} value={id}>{ai?.label || id}</option>;
                  })}
                </select>
              ) : (
                <span className={styles.noAI}>Aucune IA configurée.</span>
              )}
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>Annuler</Button>
              <Button
                variant="primary"
                onClick={handleAnalyze}
                disabled={analyzing || !selectedAI || !selectedSection}
              >
                {analyzing ? 'Analyse en cours...' : 'Analyser'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
