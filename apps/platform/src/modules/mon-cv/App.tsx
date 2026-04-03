import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
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

interface MonCvAppProps {
  onNavigate?: (path: string) => void;
  embedMode?: boolean;
  embedId?: string;
}

export default function MonCvApp({ onNavigate, embedMode, embedId }: MonCvAppProps) {
  if (embedMode && embedId) {
    return <EmbedView itemId={embedId} />;
  }
  return (
    <Layout appId="mon-cv" variant="full-width" onNavigate={onNavigate}>
      <Routes>
        <Route path="/:cvId/adaptations/:adaptationId" element={<AdaptationDetailRoute onNavigate={onNavigate} />} />
        <Route path="/:cvId/adaptations" element={<AdaptationsListRoute onNavigate={onNavigate} />} />
        <Route path="/:cvId/adapt" element={<AdaptCVRoute onNavigate={onNavigate} />} />
        <Route path="/:cvId" element={<CVEditRoute onNavigate={onNavigate} />} />
        <Route path="/" element={<CVListRoute onNavigate={onNavigate} />} />
      </Routes>
    </Layout>
  );
}

function CVListRoute({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const navigate = useNavigate();
  return (
    <CVListPage
      onEdit={(cvId) => navigate(`/mon-cv/${cvId}`)}
      onAdapt={(cvId) => navigate(`/mon-cv/${cvId}/adapt`)}
      onAdaptations={(cvId) => navigate(`/mon-cv/${cvId}/adaptations`)}
      onBack={() => onNavigate?.('/')}
    />
  );
}

function CVEditRoute({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { cvId } = useParams<{ cvId: string }>();
  const navigate = useNavigate();
  return (
    <MyProfilePage
      cvId={cvId ? parseInt(cvId, 10) : undefined}
      onNavigate={(path) => {
        if (path.startsWith('/mon-cv')) navigate(path);
        else if (onNavigate) onNavigate(path);
        else navigate(path);
      }}
    />
  );
}

function AdaptCVRoute({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { cvId } = useParams<{ cvId: string }>();
  const navigate = useNavigate();
  const [cv, setCv] = useState<CV | null>(null);

  useEffect(() => {
    if (!cvId) return;
    api.fetchCV(parseInt(cvId, 10)).then(setCv).catch(() => navigate('/mon-cv'));
  }, [cvId]);

  if (!cv) return null;

  return (
    <AdaptCVPage
      cvId={cv.id}
      cvData={cv.cvData || createEmptyCV()}
      onSaved={(adaptationId) => navigate(`/mon-cv/${cvId}/adaptations/${adaptationId}`)}
      onCancel={() => navigate(`/mon-cv/${cvId}`)}
    />
  );
}

function AdaptationsListRoute({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { cvId } = useParams<{ cvId: string }>();
  const navigate = useNavigate();
  const [cvName, setCvName] = useState('CV');

  useEffect(() => {
    if (!cvId) return;
    api.fetchCV(parseInt(cvId, 10)).then(cv => setCvName(cv.name)).catch(() => {});
  }, [cvId]);

  return (
    <AdaptationsListPage
      cvId={parseInt(cvId || '0', 10)}
      cvName={cvName}
      onAdapt={() => navigate(`/mon-cv/${cvId}/adapt`)}
      onView={(adaptationId) => navigate(`/mon-cv/${cvId}/adaptations/${adaptationId}`)}
      onBack={() => navigate('/mon-cv')}
    />
  );
}

function AdaptationDetailRoute({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { cvId, adaptationId } = useParams<{ cvId: string; adaptationId: string }>();
  const navigate = useNavigate();
  return (
    <AdaptationDetailPage
      adaptationId={parseInt(adaptationId || '0', 10)}
      onBack={() => navigate(`/mon-cv/${cvId}/adaptations`)}
    />
  );
}
