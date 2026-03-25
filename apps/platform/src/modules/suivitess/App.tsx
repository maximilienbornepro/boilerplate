import { useState, useCallback } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { Layout, ModuleHeader } from '@boilerplate/shared/components';
import { ReviewWizard } from './components/ReviewWizard/ReviewWizard';
import { DocumentSelector } from './components/DocumentSelector/DocumentSelector';
import { HistoryPanel } from './components/HistoryPanel/HistoryPanel';

function DocumentReview({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const [copyFn, setCopyFn] = useState<(() => void) | null>(null);
  const [saveFn, setSaveFn] = useState<(() => Promise<void>) | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const handleBack = () => {
    navigate('/suivitess');
  };

  const handleCopyReady = useCallback((fn: (() => void) | null) => {
    setCopyFn(() => fn);
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
        {saveFn && (
          <button
            className="module-header-btn"
            onClick={handleSaveAll}
            disabled={isSaving}
          >
            {isSaving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        )}
        {copyFn && (
          <button
            className="module-header-btn module-header-btn-primary"
            onClick={copyFn}
          >
            Copier
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
      <ReviewWizard
        key={refreshKey}
        docId={docId}
        onBack={handleBack}
        onCopyReady={handleCopyReady}
        onSaveAllReady={handleSaveAllReady}
        onUnsavedChange={setHasUnsavedChanges}
      />
      {showHistory && docId && (
        <HistoryPanel
          documentId={docId}
          onClose={() => setShowHistory(false)}
          onRestore={handleRestore}
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
      <ModuleHeader
        title="SuiviTess"
        onBack={handleBack}
      />
      <DocumentSelector onSelect={handleSelect} />
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
