import { useState, useEffect } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import styles from './TranscriptionWizard.module.css';

interface TranscriptionCall {
  id: string;
  title: string;
  date: string;
  duration?: number;
}

interface Proposal {
  id: number;
  action: 'enrich' | 'create_subject' | 'create_section';
  subjectId?: string;
  subjectTitle?: string;
  sectionName?: string;
  appendText?: string;
  sectionId?: string;
  title?: string;
  situation?: string;
  responsibility?: string | null;
  status?: string;
  subjects?: Array<{ title: string; situation: string; responsibility?: string | null; status?: string }>;
  reason?: string;
}

interface Section {
  id: string;
  name: string;
  subjects: Array<{ id: string; title: string }>;
}

const PROVIDERS = [
  { id: 'fathom', label: 'Fathom' },
  { id: 'otter', label: 'Otter.ai' },
  { id: 'outlook', label: 'Outlook' },
  { id: 'gmail', label: 'Gmail' },
];

const EMAIL_PROVIDERS = new Set(['outlook', 'gmail']);

const AI_PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'scaleway', label: 'Scaleway' },
];

const API_BASE = '/suivitess-api';

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  return `${Math.floor(seconds / 60)} min`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface Props {
  documentId: string;
  onClose: () => void;
  onDone: () => void;
  /** Pre-select a provider (e.g. "gmail", "outlook"). Falls back to first active. */
  initialProvider?: string;
}

type Step = 'select-call' | 'choose-mode' | 'proposals' | 'result';

export function TranscriptionWizard({ documentId, onClose, onDone, initialProvider }: Props) {
  const [step, setStep] = useState<Step>('select-call');

  const [provider, setProvider] = useState('');
  const [activeProviders, setActiveProviders] = useState<typeof PROVIDERS>([]);
  const [connectedAI, setConnectedAI] = useState<string[]>([]);
  const [selectedAI, setSelectedAI] = useState('');

  const [calls, setCalls] = useState<TranscriptionCall[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [selectedCall, setSelectedCall] = useState<TranscriptionCall | null>(null);

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [existingSections, setExistingSections] = useState<Section[]>([]);

  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ enriched: number; created: number; sectionsCreated: number } | null>(null);

  // Already-imported call tracking
  const [importedCallIds, setImportedCallIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Load connectors (Fathom token, Otter, AI) + OAuth status (Fathom, Outlook, Gmail)
    Promise.all([
      fetch('/api/connectors', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch('/api/auth/fathom/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { connected: false }).catch(() => ({ connected: false })),
      fetch('/api/auth/outlook/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { connected: false }).catch(() => ({ connected: false })),
      fetch('/api/auth/gmail/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { connected: false }).catch(() => ({ connected: false })),
    ]).then(([connectors, fathomStatus, outlookStatus, gmailStatus]: [Array<{ service: string; isActive: boolean }>, { connected: boolean }, { connected: boolean }, { connected: boolean }]) => {
        // Transcription providers
        const activeTrans = PROVIDERS.filter(p => {
          if (p.id === 'fathom') return fathomStatus.connected || connectors.some(c => c.service === 'fathom' && c.isActive);
          if (p.id === 'outlook') return outlookStatus.connected;
          if (p.id === 'gmail') return gmailStatus.connected;
          return connectors.some(c => c.service === p.id && c.isActive);
        });
        setActiveProviders(activeTrans);
        if (activeTrans.length > 0) {
          const preselect = initialProvider && activeTrans.some(p => p.id === initialProvider)
            ? initialProvider
            : activeTrans[0].id;
          setProvider(preselect);
        }
        const activeAI = connectors.filter(c => c.isActive && AI_PROVIDERS.some(ai => ai.id === c.service)).map(c => c.service);
        setConnectedAI(activeAI);
        if (activeAI.length > 0) setSelectedAI(activeAI[0]);
      }).catch(() => {});

    fetch(`${API_BASE}/documents/${documentId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(doc => { if (doc?.sections) setExistingSections(doc.sections); })
      .catch(() => {});

    // Load already-imported calls
    fetch(`${API_BASE}/documents/${documentId}/transcript-imports`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((imports: Array<{ callId: string }>) => {
        setImportedCallIds(new Set(imports.map(i => i.callId)));
      })
      .catch(() => {});
  }, [documentId]);

  useEffect(() => {
    if (!provider) return;
    setLoadingCalls(true); setError(''); setCalls([]);
    const isEmail = EMAIL_PROVIDERS.has(provider);
    const url = isEmail
      ? `${API_BASE}/email/list?provider=${provider}&days=7`
      : `${API_BASE}/transcription/calls?provider=${provider}&days=30`;
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data) => {
        if (isEmail) {
          // Map email items to TranscriptionCall format
          setCalls(data.map((e: { id: string; subject: string; date: string; sender: string; preview: string }) => ({
            id: e.id,
            title: `${e.subject} (${e.sender})`,
            date: e.date,
            duration: undefined,
          })));
        } else {
          setCalls(data);
        }
      })
      .catch(() => setError('Erreur de chargement'))
      .finally(() => setLoadingCalls(false));
  }, [provider]);

  // ── Helpers ──

  const recordImport = async (callId: string, callTitle: string) => {
    try {
      await fetch(`${API_BASE}/documents/${documentId}/transcript-imports`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ callId, provider, callTitle }),
      });
      setImportedCallIds(prev => new Set([...prev, callId]));
    } catch { /* silent */ }
  };

  // ── Actions ──

  // Fetch email body for email providers
  const fetchEmailContent = async (call: TranscriptionCall): Promise<string> => {
    const bodyRes = await fetch(`${API_BASE}/email/body/${encodeURIComponent(call.id)}?provider=${provider}`, { credentials: 'include' });
    if (!bodyRes.ok) return call.title; // fallback to title
    const { body } = await bodyRes.json();
    return `=== ${call.title} ===\n${body || ''}`;
  };

  const handleImportRaw = async () => {
    if (!selectedCall) return;
    setImporting(true); setError('');
    try {
      if (EMAIL_PROVIDERS.has(provider)) {
        const content = await fetchEmailContent(selectedCall);
        const res = await fetch(`${API_BASE}/documents/${documentId}/content-import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ content, source: provider, sourceTitle: selectedCall.title, useAI: false, itemIds: [selectedCall.id] }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json();
        setResult({ enriched: 0, created: data.subjectCount, sectionsCreated: 1 });
      } else {
        const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ callId: selectedCall.id, callTitle: selectedCall.title, provider, useAI: false }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json();
        setResult({ enriched: 0, created: data.subjectCount, sectionsCreated: 1 });
      }
      await recordImport(selectedCall.id, selectedCall.title);
      setStep('result'); onDone();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
    finally { setImporting(false); }
  };

  const handleImportAISection = async () => {
    if (!selectedCall) return;
    setImporting(true); setError('');
    try {
      if (EMAIL_PROVIDERS.has(provider)) {
        const content = await fetchEmailContent(selectedCall);
        const res = await fetch(`${API_BASE}/documents/${documentId}/content-import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ content, source: provider, sourceTitle: selectedCall.title, useAI: true, itemIds: [selectedCall.id] }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json();
        setResult({ enriched: 0, created: data.subjectCount, sectionsCreated: 1 });
      } else {
        const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ callId: selectedCall.id, callTitle: selectedCall.title, provider, useAI: true }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json();
        setResult({ enriched: 0, created: data.subjectCount, sectionsCreated: 1 });
      }
      await recordImport(selectedCall.id, selectedCall.title);
      setStep('result'); onDone();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
    finally { setImporting(false); }
  };

  const handleAnalyzeAndPropose = async () => {
    if (!selectedCall) return;
    setAnalyzing(true); setError('');
    try {
      if (EMAIL_PROVIDERS.has(provider)) {
        const content = await fetchEmailContent(selectedCall);
        const res = await fetch(`${API_BASE}/documents/${documentId}/content-analyze-and-propose`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ content, source: provider, sourceTitle: selectedCall.title, itemIds: [selectedCall.id] }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json();
        setProposals(data.proposals || []);
        setSelected(new Set((data.proposals || []).map((p: Proposal) => p.id)));
      } else {
        const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-analyze-and-propose`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ callId: selectedCall.id, callTitle: selectedCall.title, provider }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const data = await res.json();
        setProposals(data.proposals || []);
        setSelected(new Set((data.proposals || []).map((p: Proposal) => p.id)));
      }
      setStep('proposals');
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
    finally { setAnalyzing(false); }
  };

  const handleApply = async () => {
    const toApply = proposals.filter(p => selected.has(p.id));
    if (toApply.length === 0) return;
    setApplying(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/documents/${documentId}/transcript-apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ proposals: toApply }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setResult(await res.json());
      if (selectedCall) await recordImport(selectedCall.id, selectedCall.title);
      setStep('result'); onDone();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
    finally { setApplying(false); }
  };

  const toggleProposal = (id: number) => {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleAll = () => setSelected(selected.size === proposals.length ? new Set() : new Set(proposals.map(p => p.id)));
  const updateProposal = (id: number, updates: Partial<Proposal>) => setProposals(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

  const changeTargetSection = (pid: number, newSectionId: string) => {
    if (newSectionId === '__new__') {
      const p = proposals.find(pr => pr.id === pid);
      if (!p) return;
      updateProposal(pid, { action: 'create_section', sectionName: p.title || 'Nouvelle section', sectionId: undefined,
        subjects: [{ title: p.title || '', situation: p.situation || '', responsibility: p.responsibility, status: p.status }] });
    } else {
      const s = existingSections.find(s => s.id === newSectionId);
      updateProposal(pid, { sectionId: newSectionId, sectionName: s?.name || '' });
    }
  };

  // ── RESULT ──
  if (step === 'result' && result) {
    return (
      <Modal title="Terminé" onClose={onClose}>
        <div className={styles.body}>
          <div className={styles.resultBox}>
            {result.enriched > 0 && <p><strong>{result.enriched}</strong> sujets enrichis</p>}
            {result.created > 0 && <p><strong>{result.created}</strong> sujets créés</p>}
            {result.sectionsCreated > 0 && <p><strong>{result.sectionsCreated}</strong> sections créées</p>}
          </div>
          <div className={styles.footer}><Button variant="primary" onClick={onClose}>Fermer</Button></div>
        </div>
      </Modal>
    );
  }

  // ── PROPOSALS ──
  if (step === 'proposals') {
    return (
      <Modal title="Propositions de fusion" onClose={() => setStep('choose-mode')}>
        <div className={styles.body}>
          <div className={styles.selectAllRow}>
            <label className={styles.selectAll}>
              <input type="checkbox" checked={selected.size === proposals.length} onChange={toggleAll} />
              <span>{selected.size === proposals.length ? 'Tout désélectionner' : 'Tout sélectionner'}</span>
            </label>
            <span className={styles.selectionCount}>{selected.size}/{proposals.length}</span>
          </div>
          <div className={styles.proposalList}>
            {proposals.map(p => {
              const isSel = selected.has(p.id);
              return (
                <div key={p.id} className={`${styles.proposal} ${isSel ? styles.selected : ''}`}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleProposal(p.id)} />
                  <div className={styles.proposalContent}>
                    <div className={styles.proposalAction}>
                      <span className={p.action === 'enrich' ? styles.actionEnrich : p.action === 'create_subject' ? styles.actionCreate : styles.actionSection}>
                        {p.action === 'enrich' ? '↻ Enrichir' : p.action === 'create_subject' ? '+ Sujet' : '+ Section'}
                      </span>
                      <span className={styles.proposalTarget}>
                        {p.action === 'enrich' ? (p.subjectTitle || '') : (p.title || p.sectionName || '')}
                        {p.sectionName && p.action !== 'create_section' && <span className={styles.inSection}> dans {p.sectionName}</span>}
                      </span>
                    </div>
                    {p.action === 'create_subject' && (
                      <div className={styles.sectionSelector}>
                        <span className={styles.selectorLabel}>Section :</span>
                        <select className={styles.sectionSelect} value={p.sectionId || ''} onChange={e => changeTargetSection(p.id, e.target.value)} onClick={e => e.stopPropagation()}>
                          {existingSections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          <option value="__new__">+ Nouvelle section</option>
                        </select>
                      </div>
                    )}
                    {p.action === 'create_section' && (
                      <input type="text" className={styles.sectionNameInput} value={p.sectionName || ''} onChange={e => updateProposal(p.id, { sectionName: e.target.value })} onClick={e => e.stopPropagation()} placeholder="Nom de la section" />
                    )}
                    {(p.appendText || p.situation) && <div className={styles.proposalDetail}>{p.appendText || p.situation}</div>}
                    {p.reason && <div className={styles.proposalReason}>{p.reason}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => setStep('choose-mode')}>Retour</Button>
            <Button variant="primary" onClick={handleApply} disabled={applying || selected.size === 0}>
              {applying ? 'Application...' : `Appliquer (${selected.size})`}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── CHOOSE MODE ──
  if (step === 'choose-mode' && selectedCall) {
    const busy = analyzing || importing;
    return (
      <Modal title="Mode d'import" onClose={() => { setSelectedCall(null); setStep('select-call'); }}>
        <div className={styles.body}>
          <div className={styles.selectedCallInfo}>
            <span className={styles.callTitle}>{selectedCall.title}</span>
            <span className={styles.callMeta}>{formatDate(selectedCall.date)}</span>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.importOptions}>
            <div className={styles.importOption}>
              <div className={styles.importOptionHeader}>
                <strong>Analyser et fusionner</strong>
                <span className={styles.recommended}>Recommandé</span>
              </div>
              <span className={styles.importOptionDesc}>L'IA analyse la transcription et propose d'enrichir les sujets existants ou d'en créer</span>
              {connectedAI.length > 0 ? (
                <>
                  <select className={styles.aiSelect} value={selectedAI} onChange={e => setSelectedAI(e.target.value)}>
                    {connectedAI.map(id => { const ai = AI_PROVIDERS.find(a => a.id === id); return <option key={id} value={id}>{ai?.label || id}</option>; })}
                  </select>
                  <Button variant="primary" onClick={handleAnalyzeAndPropose} disabled={busy}>
                    {analyzing ? 'Analyse...' : 'Analyser et fusionner'}
                  </Button>
                </>
              ) : <span className={styles.noAI}>Aucune IA configurée.</span>}
            </div>
            {connectedAI.length > 0 && (
              <>
                <div className={styles.separator}>ou</div>
                <div className={styles.importOption}>
                  <strong>Analyser comme section</strong>
                  <span className={styles.importOptionDesc}>L'IA extrait les sujets clés dans une section dédiée</span>
                  <Button variant="secondary" onClick={handleImportAISection} disabled={busy}>{importing ? 'Analyse...' : 'Créer section IA'}</Button>
                </div>
              </>
            )}
          </div>
          <div className={styles.footer}><Button variant="secondary" onClick={() => { setSelectedCall(null); setStep('select-call'); }}>Retour</Button></div>
        </div>
      </Modal>
    );
  }

  // ── SELECT CALL ──
  return (
    <Modal title="Importer une transcription" onClose={onClose}>
      <div className={styles.body}>
        {activeProviders.length > 0 ? (
          <div className={styles.providerRow}>
            {activeProviders.map(p => (
              <button key={p.id} className={`${styles.providerBtn} ${provider === p.id ? styles.active : ''}`} onClick={() => setProvider(p.id)}>{p.label}</button>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>Aucun service de transcription configuré.<br /><span className={styles.emptyHint}>Ajoutez Fathom ou Otter dans Réglages &gt; Connecteurs.</span></div>
        )}
        {error && <div className={styles.error}>{error}</div>}
        {loadingCalls ? <LoadingSpinner message="Chargement..." /> : calls.length === 0 && activeProviders.length > 0 ? (
          <div className={styles.empty}>Aucun appel sur les 30 derniers jours.</div>
        ) : (
          <div className={styles.callList}>
            {calls.map(call => {
              const alreadyImported = importedCallIds.has(call.id);
              return (
                <div key={call.id} className={`${styles.callItem} ${alreadyImported ? styles.callImported : ''}`}>
                  <div className={styles.callInfo}>
                    <span className={styles.callTitle}>
                      {call.title}
                      {alreadyImported && <span className={styles.importedBadge}>Déjà importé</span>}
                    </span>
                    <span className={styles.callMeta}>{formatDate(call.date)}{call.duration ? ` · ${formatDuration(call.duration)}` : ''}</span>
                  </div>
                  <Button
                    variant={alreadyImported ? 'secondary' : 'primary'}
                    onClick={() => { setSelectedCall(call); setStep('choose-mode'); }}
                  >
                    {alreadyImported ? 'Réimporter' : 'Sélectionner'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <div className={styles.footer}><Button variant="secondary" onClick={onClose}>Fermer</Button></div>
      </div>
    </Modal>
  );
}
