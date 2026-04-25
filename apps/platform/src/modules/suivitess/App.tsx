import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout, ModuleHeader, ToastContainer } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import './index.css';
import { ReviewWizard } from './components/ReviewWizard/ReviewWizard';
import { DocumentSelector } from './components/DocumentSelector/DocumentSelector';
import { HistoryPanel } from './components/HistoryPanel/HistoryPanel';
import { RecorderBar } from './components/RecorderBar/RecorderBar';
import { SuggestionsPanel } from './components/SuggestionsPanel/SuggestionsPanel';
import { BulkTranscriptionImportModal } from './components/BulkTranscriptionImportModal/BulkTranscriptionImportModal';
import { consumeBulkImportReopenFlag } from './components/BulkTranscriptionImportModal/InlineConnectorSetup';
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
  const [showBulkImport, setShowBulkImport] = useState(false);
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
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [importInitialProvider, setImportInitialProvider] = useState<string | undefined>(undefined);
  const [importProviders, setImportProviders] = useState<{ outlook: boolean; gmail: boolean; transcription: boolean }>({ outlook: false, gmail: false, transcription: false });
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const addToast = (toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...toast, id: Date.now().toString() }]);
  };

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
    if (!showActions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showActions]);

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

  // After an OAuth callback that redirected back to this page, the
  // setup flow stamps a localStorage flag — restore the modal state
  // automatically so the user lands back where they were.
  useEffect(() => {
    if (consumeBulkImportReopenFlag()) {
      setShowBulkImport(true);
    }
  }, []);

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
    // No more pre-modal gate. The bulk-import modal now embeds an
    // `<InlineConnectorSetup>` that surfaces a connect panel when no
    // provider is configured — keeps the UX in the modal rather than
    // bouncing the user to /reglages and back.
    setImportInitialProvider(provider);
    setShowBulkImport(true);
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
        <div ref={actionsRef} className="suivitess-exports">
          <button
            type="button"
            className="module-header-btn"
            onClick={() => setShowActions(v => !v)}
            aria-haspopup="menu"
            aria-expanded={showActions}
          >
            Actions
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showActions && (
            <div className="suivitess-exports-menu" role="menu">
              {/* ── Importer ── */}
              <div className="suivitess-exports-group-title">Importer</div>
              {/* "Import" always shows — the modal itself handles the
                  empty-providers case. openImport() gates on
                  importProviders : if none is configured, it shows a
                  toast explaining what's missing and redirects to
                  /reglages. Matches DocumentSelector's "Importer &
                  ranger" behavior so the two pages feel consistent. */}
              <button type="button" className="suivitess-exports-item" onClick={() => { setShowActions(false); openImport(); }}>
                Import
              </button>
              {importProviders.gmail && (
                <button type="button" className="suivitess-exports-item" onClick={() => { setShowActions(false); openImport('gmail'); }}>
                  Gmail
                </button>
              )}
              {importProviders.outlook && (
                <button type="button" className="suivitess-exports-item" onClick={() => { setShowActions(false); openImport('outlook'); }}>
                  Outlook
                </button>
              )}

              <div className="suivitess-exports-divider" />

              {/* ── Exporter ── */}
              <div className="suivitess-exports-group-title">Exporter</div>
              {exportJsonFn && (
                <button type="button" className="suivitess-exports-item" onClick={() => { setShowActions(false); exportJsonFn(); }}>
                  JSON
                </button>
              )}
              {copyFn && (
                <button type="button" className="suivitess-exports-item" onClick={() => { setShowActions(false); copyFn(); }}>
                  Tableau
                </button>
              )}

              <div className="suivitess-exports-divider" />

              {/* ── IA ── */}
              <div className="suivitess-exports-group-title">
                IA{connectedAIs.length === 1 ? ` · ${connectedAIs[0].label}` : ''}
              </div>
              {connectedAIs.length > 0 ? (
                <>
                  {connectedAIs.length > 1 && (
                    <div className="suivitess-exports-item" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>Modèle</span>
                      <select
                        className="suivitess-ai-picker__select"
                        value={selectedAI}
                        onChange={e => setSelectedAI(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1 }}
                      >
                        {connectedAIs.map(ai => (
                          <option key={ai.id} value={ai.id}>{ai.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button type="button" className="suivitess-exports-item" onClick={() => { setShowActions(false); setShowAnalysis(true); }}>
                    Analyser les sujets
                  </button>
                  {docId && (
                    <button type="button" className="suivitess-exports-item" onClick={() => { setShowActions(false); setShowEmailModal(true); }}>
                      Générer un email récap
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className="suivitess-exports-item" onClick={() => { setShowActions(false); navigate('/reglages'); }}>
                  Connecter une IA
                </button>
              )}
            </div>
          )}
        </div>
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
      {showBulkImport && docId && (
        // Per-document import : reuses the global bulk-import modal
        // but scoped to this document. Skips the place-in-reviews
        // skill (useless when the destination doc is pre-known) and
        // locks the review pill on this doc.
        <BulkTranscriptionImportModal
          scopedDocumentId={docId}
          onClose={() => { setShowBulkImport(false); setImportInitialProvider(undefined); }}
          onDone={() => {
            setRefreshKey(k => k + 1);
            setShowBulkImport(false);
            setImportInitialProvider(undefined);
          }}
        />
      )}
      {showAnalysis && docId && (
        <SubjectAnalysisModal
          documentId={docId}
          onClose={() => setShowAnalysis(false)}
          onDone={() => { setRefreshKey(k => k + 1); setShowAnalysis(false); }}
        />
      )}
      <ToastContainer toasts={toasts} onClose={(id) => setToasts(t => t.filter(x => x.id !== id))} />
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
