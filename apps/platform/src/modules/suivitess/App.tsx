import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout, ModuleHeader } from '@boilerplate/shared/components';
import './index.css';
import { ReviewWizard } from './components/ReviewWizard/ReviewWizard';
import { DocumentSelector } from './components/DocumentSelector/DocumentSelector';
import { HistoryPanel } from './components/HistoryPanel/HistoryPanel';
import { RecorderBar } from './components/RecorderBar/RecorderBar';
import { SuggestionsPanel } from './components/SuggestionsPanel/SuggestionsPanel';
import { TranscriptionImportModal } from './components/TranscriptionImportModal/TranscriptionImportModal';

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
  const [showTranscriptionImport, setShowTranscriptionImport] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showExports, setShowExports] = useState(false);
  const exportsRef = useRef<HTMLDivElement>(null);

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
    // Trigger a refresh of the ReviewWizard
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
          className={`module-header-btn${showRecorder ? ' module-header-btn-active' : ''}`}
          onClick={() => setShowRecorder(v => !v)}
          title="Connecter un call Teams"
        >
          Teams
        </button>
        <button
          className="module-header-btn"
          onClick={() => setShowTranscriptionImport(true)}
          title="Importer une transcription (Fathom, Otter...)"
        >
          Transcription
        </button>
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
      {showTranscriptionImport && docId && (
        <TranscriptionImportModal
          documentId={docId}
          onClose={() => setShowTranscriptionImport(false)}
          onImported={() => setRefreshKey(k => k + 1)}
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
