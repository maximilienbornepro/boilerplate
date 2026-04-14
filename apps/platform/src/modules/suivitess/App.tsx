import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout, ModuleHeader } from '@boilerplate/shared/components';
import './index.css';
import { ReviewWizard } from './components/ReviewWizard/ReviewWizard';
import { DocumentSelector } from './components/DocumentSelector/DocumentSelector';
import { HistoryPanel } from './components/HistoryPanel/HistoryPanel';
import { RecorderBar } from './components/RecorderBar/RecorderBar';
import { SuggestionsPanel } from './components/SuggestionsPanel/SuggestionsPanel';
import { TranscriptionWizard } from './components/TranscriptionWizard/TranscriptionWizard';
import { EmailPreviewModal } from './components/EmailPreviewModal/EmailPreviewModal';
import { SubjectAnalysisModal } from './components/SubjectAnalysisModal/SubjectAnalysisModal';

function DocumentReview({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { docId } = useParams<{ docId: string }>();
  const [searchParams] = useSearchParams();
  const scrollToSectionId = searchParams.get('section') || undefined;
  const navigate = useNavigate();
  const [copyFn, setCopyFn] = useState<(() => void) | null>(null);
  const [exportJsonFn, setExportJsonFn] = useState<(() => void) | null>(null);
  const [saveFn, setSaveFn] = useState<(() => Promise<void>) | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTranscriptionWizard, setShowTranscriptionWizard] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedAI, setSelectedAI] = useState('');
  const [connectedAIs, setConnectedAIs] = useState<Array<{ id: string; label: string }>>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showExports, setShowExports] = useState(false);
  const exportsRef = useRef<HTMLDivElement>(null);
  const [showImports, setShowImports] = useState(false);
  const importsRef = useRef<HTMLDivElement>(null);
  const [importInitialProvider, setImportInitialProvider] = useState<string | undefined>(undefined);
  const [importProviders, setImportProviders] = useState<{ outlook: boolean; gmail: boolean; transcription: boolean }>({ outlook: false, gmail: false, transcription: false });

  const AI_LABELS: Record<string, string> = {
    anthropic: 'Claude', openai: 'OpenAI', mistral: 'Mistral', scaleway: 'Scaleway',
  };

  // Load connected AI providers
  useEffect(() => {
    fetch('/api/connectors', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((connectors: Array<{ service: string; isActive: boolean }>) => {
        const ais = connectors
          .filter(c => c.isActive && AI_LABELS[c.service])
          .map(c => ({ id: c.service, label: AI_LABELS[c.service] }));
        setConnectedAIs(ais);
        if (ais.length > 0 && !selectedAI) setSelectedAI(ais[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!showExports) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportsRef.current && !exportsRef.current.contains(e.target as Node)) {
        setShowExports(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExports]);

  useEffect(() => {
    if (!showImports) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (importsRef.current && !importsRef.current.contains(e.target as Node)) {
        setShowImports(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showImports]);

  // Detect which import sources are configured (OAuth + manual connectors)
  useEffect(() => {
    Promise.all([
      fetch('/api/auth/outlook/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { connected: false }).catch(() => ({ connected: false })),
      fetch('/api/auth/gmail/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { connected: false }).catch(() => ({ connected: false })),
      fetch('/api/auth/fathom/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { connected: false }).catch(() => ({ connected: false })),
      fetch('/api/connectors', { credentials: 'include' }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([outlook, gmail, fathom, connectors]: [{ connected: boolean }, { connected: boolean }, { connected: boolean }, Array<{ service: string; isActive: boolean }>]) => {
      const hasFathom = !!fathom.connected || connectors.some(c => c.service === 'fathom' && c.isActive);
      const hasOtter = connectors.some(c => c.service === 'otter' && c.isActive);
      setImportProviders({
        outlook: !!outlook.connected,
        gmail: !!gmail.connected,
        transcription: hasFathom || hasOtter,
      });
    });
  }, []);

  const openImport = (provider?: string) => {
    setImportInitialProvider(provider);
    setShowTranscriptionWizard(true);
    setShowImports(false);
  };

  const handleBack = () => {
    navigate('/suivitess');
  };

  const handleCopyReady = useCallback((fn: (() => void) | null) => {
    setCopyFn(() => fn);
  }, []);

  const handleExportJsonReady = useCallback((fn: (() => void) | null) => {
    setExportJsonFn(() => fn);
  }, []);

  const handleSaveAllReady = useCallback((fn: (() => Promise<void>) | null) => {
    setSaveFn(() => fn);
  }, []);

  const handleSaveAll = useCallback(async () => {
    if (!saveFn || isSaving) return;
    setIsSaving(true);
    try {
      await saveFn();
    } finally {
      setIsSaving(false);
    }
  }, [saveFn, isSaving]);

  const handleRestore = () => {
    setRefreshKey(k => k + 1);
  };


  return (
    <Layout appId="suivitess" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader
        title="SuiviTess"
        onBack={handleBack}
      >
        <button
          className="module-header-btn"
          onClick={() => setShowHistory(true)}
        >
          Historique
        </button>
        <button
          className="module-header-btn"
          onClick={() => setShowAnalysis(true)}
          title="Analyser les sujets et proposer la création de tickets (Jira/Notion/Roadmap)"
        >
          Analyser
        </button>
        {connectedAIs.length > 0 && (
          <span
            className="suivitess-ai-picker"
            title="IA utilisée pour la reformulation et l'analyse des sujets"
          >
            <svg className="suivitess-ai-picker__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2 L13.5 8.5 L20 10 L13.5 11.5 L12 18 L10.5 11.5 L4 10 L10.5 8.5 Z" />
              <path d="M19 16 L19.7 18.3 L22 19 L19.7 19.7 L19 22 L18.3 19.7 L16 19 L18.3 18.3 Z" />
            </svg>
            <span className="suivitess-ai-picker__label">IA</span>
            <select
              className="suivitess-ai-picker__select"
              value={selectedAI}
              onChange={e => setSelectedAI(e.target.value)}
              aria-label="Connecteur IA utilisé pour la reformulation et l'analyse"
            >
              {connectedAIs.map(ai => (
                <option key={ai.id} value={ai.id}>{ai.label}</option>
              ))}
            </select>
          </span>
        )}
        {(importProviders.transcription || importProviders.gmail || importProviders.outlook) && (
          <div ref={importsRef} className="suivitess-exports">
            <button
              type="button"
              className="module-header-btn"
              onClick={() => setShowImports(v => !v)}
              aria-haspopup="menu"
              aria-expanded={showImports}
              title="Importer du contenu dans cette review"
            >
              Imports
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showImports && (
              <div className="suivitess-exports-menu" role="menu">
                {importProviders.transcription && (
                  <button
                    type="button"
                    className="suivitess-exports-item"
                    onClick={() => openImport()}
                  >
                    Transcription
                  </button>
                )}
                {importProviders.transcription && (importProviders.gmail || importProviders.outlook) && <div className="suivitess-exports-divider" />}
                {importProviders.gmail && (
                  <button
                    type="button"
                    className="suivitess-exports-item"
                    onClick={() => openImport('gmail')}
                  >
                    Gmail
                  </button>
                )}
                {importProviders.outlook && (
                  <button
                    type="button"
                    className="suivitess-exports-item"
                    onClick={() => openImport('outlook')}
                  >
                    Outlook
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {(exportJsonFn || copyFn) && (
          <div ref={exportsRef} className="suivitess-exports">
            <button
              type="button"
              className="module-header-btn"
              onClick={() => setShowExports(v => !v)}
              aria-haspopup="menu"
              aria-expanded={showExports}
            >
              Exports
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showExports && (
              <div className="suivitess-exports-menu" role="menu">
                {exportJsonFn && (
                  <button
                    type="button"
                    className="suivitess-exports-item"
                    onClick={() => { exportJsonFn(); setShowExports(false); }}
                  >
                    JSON
                  </button>
                )}
                {copyFn && (
                  <button
                    type="button"
                    className="suivitess-exports-item"
                    onClick={() => { copyFn(); setShowExports(false); }}
                  >
                    Tableau
                  </button>
                )}
                {connectedAIs.length > 0 && docId && (
                  <>
                    <div className="suivitess-exports-divider" />
                    <button type="button" className="suivitess-exports-item" onClick={() => { setShowEmailModal(true); setShowExports(false); }}>
                      Email (avec preview)
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {saveFn && (
          <button
            className="module-header-btn module-header-btn-primary"
            onClick={handleSaveAll}
            disabled={isSaving}
          >
            {isSaving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        )}
      </ModuleHeader>
      {hasUnsavedChanges && (
        <div style={{
          position: 'sticky',
          top: 110,
          zIndex: 499,
          background: 'var(--error-light, rgba(220, 38, 38, 0.15))',
          borderBottom: '1px solid var(--error, #dc2626)',
          color: 'var(--error, #dc2626)',
          padding: '10px 16px',
          fontSize: '13px',
          fontWeight: 600,
          textAlign: 'center',
        }}>
          Modifications non sauvegardées — Cliquez sur « Sauvegarder » pour enregistrer vos changements.
        </div>
      )}
      {docId && showRecorder && (
        <RecorderBar
          documentId={docId}
          onDone={() => { setShowSuggestions(true); }}
        />
      )}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ReviewWizard
          key={refreshKey}
          docId={docId}
          onBack={handleBack}
          onCopyReady={handleCopyReady}
          onExportJsonReady={handleExportJsonReady}
          onSaveAllReady={handleSaveAllReady}
          onUnsavedChange={setHasUnsavedChanges}
          scrollToSectionId={scrollToSectionId}
        />
        {showSuggestions && docId && (
          <SuggestionsPanel
            documentId={docId}
            onClose={() => setShowSuggestions(false)}
            onAccepted={() => setRefreshKey(k => k + 1)}
          />
        )}
      </div>
      {showHistory && docId && (
        <HistoryPanel
          documentId={docId}
          onClose={() => setShowHistory(false)}
          onRestore={handleRestore}
        />
      )}
      {showEmailModal && docId && (
        <EmailPreviewModal
          documentId={docId}
          onClose={() => setShowEmailModal(false)}
        />
      )}
      {showTranscriptionWizard && docId && (
        <TranscriptionWizard
          documentId={docId}
          initialProvider={importInitialProvider}
          onClose={() => { setShowTranscriptionWizard(false); setImportInitialProvider(undefined); }}
          onDone={() => setRefreshKey(k => k + 1)}
        />
      )}
      {showAnalysis && docId && (
        <SubjectAnalysisModal
          documentId={docId}
          onClose={() => setShowAnalysis(false)}
          onDone={() => { setRefreshKey(k => k + 1); setShowAnalysis(false); }}
        />
      )}
    </Layout>
  );
}

function DocumentList({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const navigate = useNavigate();

  const handleSelect = (doc: { id: string; title: string }) => {
    navigate(`/suivitess/${doc.id}`);
  };

  const handleBack = () => {
    if (onNavigate) {
      onNavigate('/');
    } else {
      navigate('/');
    }
  };

  return (
    <Layout appId="suivitess" variant="full-width" onNavigate={onNavigate}>
      <DocumentSelector onSelect={handleSelect} onNavigate={onNavigate} />
    </Layout>
  );
}

export default function App({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return (
    <Routes>
      <Route path="/:docId" element={<DocumentReview onNavigate={onNavigate} />} />
      <Route path="/" element={<DocumentList onNavigate={onNavigate} />} />
    </Routes>
  );
}
