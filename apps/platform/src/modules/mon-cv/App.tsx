import { useState, useEffect, useCallback } from 'react';
import { Layout } from '@boilerplate/shared/components';
import { CVListPage } from './components/CVListPage/CVListPage';
import { MyProfilePage } from './components/MyProfilePage';
import { AdaptCVPage } from './components/AdaptCVPage';
import { AdaptationsListPage } from './components/AdaptationsListPage/AdaptationsListPage';
import { AdaptationDetailPage } from './components/AdaptationDetailPage/AdaptationDetailPage';
import { EmbedView } from './components/EmbedView/EmbedView';
import type { CV } from './types';
import { createEmptyCV } from './types';
import * as api from './services/api';
import './index.css';

type View =
  | 'cv-list'
  | 'profile'
  | 'adapt'
  | 'adaptations-list'
  | 'adaptation-detail';

interface MonCvAppProps {
  onNavigate?: (path: string) => void;
  embedMode?: boolean;
  embedId?: string;
}

// Inner component — always mounts with hooks (no conditional early return)
function MonCvMain({ onNavigate }: { onNavigate?: (path: string) => void }) {
  // Default landing is the CV list
  const [view, setView] = useState<View>('cv-list');
  const [cv, setCv] = useState<CV | null>(null);
  const [selectedCvId, setSelectedCvId] = useState<number | null>(null);
  const [selectedAdaptationId, setSelectedAdaptationId] = useState<number | null>(null);

  // Handle internal navigation
  const handleNavigate = useCallback((path: string) => {
    if (path === '/mon-cv' || path === '/mon-cv/') {
      setView('cv-list');
    } else if (path.startsWith('/mon-cv/profile/')) {
      const cvId = parseInt(path.split('/').pop() || '0', 10);
      if (cvId) { setSelectedCvId(cvId); setView('profile'); }
    } else if (path === '/mon-cv/adapt') {
      setView('adapt');
    } else if (path.startsWith('/mon-cv/adaptations/detail/')) {
      const id = parseInt(path.split('/').pop() || '0', 10);
      if (id) { setSelectedAdaptationId(id); setView('adaptation-detail'); }
    } else if (path.startsWith('/mon-cv/adaptations/')) {
      const cvId = parseInt(path.split('/').pop() || '0', 10);
      if (cvId) { setSelectedCvId(cvId); setView('adaptations-list'); }
    } else if (onNavigate) {
      onNavigate(path);
    }
  }, [onNavigate]);

  // Load the selected CV when entering adapt view
  useEffect(() => {
    if (view === 'adapt') {
      const loader = selectedCvId ? api.fetchCV(selectedCvId) : api.fetchDefaultCV();
      loader.then(setCv).catch(console.error);
    }
  }, [view, selectedCvId]);

  // Navigate to edit a specific CV
  const handleEditCv = useCallback((cvId: number) => {
    setSelectedCvId(cvId);
    setView('profile');
  }, []);

  // Navigate to adapt a specific CV
  const handleAdaptCv = useCallback((cvId: number) => {
    setSelectedCvId(cvId);
    setView('adapt');
  }, []);

  // Navigate to adaptations list for a CV
  const handleAdaptationsCv = useCallback((cvId: number) => {
    setSelectedCvId(cvId);
    setView('adaptations-list');
  }, []);

  // Called when adaptation is saved — go to detail
  const handleAdaptationSaved = useCallback((adaptationId: number) => {
    setSelectedAdaptationId(adaptationId);
    setView('adaptation-detail');
  }, []);

  // Render based on current view
  const renderContent = () => {
    switch (view) {
      case 'cv-list':
        return (
          <CVListPage
            onEdit={handleEditCv}
            onAdapt={handleAdaptCv}
            onAdaptations={handleAdaptationsCv}
            onBack={() => onNavigate?.('/')}
          />
        );

      case 'profile':
        return (
          <MyProfilePage
            cvId={selectedCvId ?? undefined}
            onNavigate={handleNavigate}
          />
        );

      case 'adapt':
        return (
          <AdaptCVPage
            cvId={selectedCvId ?? (cv?.id ?? 0)}
            cvData={cv?.cvData || createEmptyCV()}
            onSaved={handleAdaptationSaved}
            onCancel={() => setView(selectedCvId ? 'profile' : 'cv-list')}
          />
        );

      case 'adaptations-list':
        return (
          <AdaptationsListPage
            cvId={selectedCvId ?? 0}
            cvName={cv?.name || 'CV'}
            onAdapt={() => {
              if (selectedCvId) {
                api.fetchCV(selectedCvId)
                  .then(loadedCv => { setCv(loadedCv); setView('adapt'); })
                  .catch(console.error);
              }
            }}
            onView={adaptationId => {
              setSelectedAdaptationId(adaptationId);
              setView('adaptation-detail');
            }}
            onBack={() => setView('cv-list')}
          />
        );

      case 'adaptation-detail':
        return (
          <AdaptationDetailPage
            adaptationId={selectedAdaptationId ?? 0}
            onBack={() => {
              if (selectedCvId) setView('adaptations-list');
              else setView('cv-list');
            }}
          />
        );

      default:
        return (
          <CVListPage
            onEdit={handleEditCv}
            onAdapt={handleAdaptCv}
            onAdaptations={handleAdaptationsCv}
            onBack={() => onNavigate?.('/')}
          />
        );
    }
  };

  return (
    <Layout appId="mon-cv" variant="full-width" onNavigate={handleNavigate}>
      {renderContent()}
    </Layout>
  );
}

export default function MonCvApp({ onNavigate, embedMode, embedId }: MonCvAppProps) {
  // Embed mode: render minimal view (no hooks needed)
  if (embedMode && embedId) {
    return <EmbedView itemId={embedId} />;
  }
  // Normal mode: delegate to inner component that manages all hooks
  return <MonCvMain onNavigate={onNavigate} />;
}
