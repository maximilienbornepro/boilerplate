import { lazy, Suspense, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { LoadingSpinner, SharedNav } from '@boilerplate/shared/components';
import { LandingPage } from './modules/gateway/components/LandingPage';
import { AdminPage } from './modules/gateway/components/AdminPage';
import { ConnectorsPage } from './modules/gateway/components/ConnectorsPage';
import { SettingsPage } from './modules/gateway/components/SettingsPage/SettingsPage';

// Lazy load modules
const CongesApp = lazy(() => import('./modules/conges/App'));
const RoadmapApp = lazy(() => import('./modules/roadmap/App'));
const SuivitessApp = lazy(() => import('./modules/suivitess/App'));
const DeliveryApp = lazy(() => import('./modules/delivery/App'));
const MonCvApp = lazy(() => import('./modules/mon-cv/App'));
const RagApp = lazy(() => import('./modules/rag/App'));
const AiLogsApp = lazy(() => import('./modules/ai-logs/App'));
const AiRoutingApp = lazy(() => import('./modules/ai-routing/App'));
const AiEvalsApp = lazy(() => import('./modules/ai-evals/App'));
const AiPlaygroundApp = lazy(() => import('./modules/ai-playground/App'));
const PromptLogsApp = lazy(() => import('./modules/prompt-logs/App'));
const AdminFeaturesApp = lazy(() => import('./modules/admin-features/App'));
const DesignSystemApp = lazy(() => import('./modules/design-system/App'));
const UxPreviewSandbox = lazy(() => import('./ux-preview/Preview'));
const DemoApp = lazy(() => import('./modules/demo/App'));
const LandingDemoModule = lazy(() => import('./modules/demo/LandingDemo').then(m => ({ default: () => <m.LandingDemo /> })));

interface User {
  id: number;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  permissions: string[];
}

interface AppRouterProps {
  onNavigate?: (path: string) => void;
  user?: User | null;
  onLogout?: () => void;
  embedMode?: boolean;
  embedId?: string;
}

const SuspenseWrapper = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<LoadingSpinner size="lg" message="Chargement..." fullPage />}>
    {children}
  </Suspense>
);

/** Admin-only drawer links — mirrored from Layout so they show up on pages
 *  (landing, settings) that use SharedNav directly instead of going through
 *  the shared Layout wrapper. */
function adminDrawerLinks(user?: User | null) {
  return user?.isAdmin
    ? [
        { label: 'Logs IA',          path: '/ai-logs',         color: '#14b8a6' }, // teal
        { label: 'Routing IA',       path: '/ai-routing',      color: '#0ea5e9' }, // sky
        { label: 'Évaluations IA',   path: '/ai-evals',        color: '#f43f5e' }, // rose
        { label: 'Playground IA',    path: '/ai-playground',   color: '#a855f7' }, // purple
        { label: 'Logs Prompts',     path: '/prompt-logs',     color: '#eab308' }, // amber
        { label: 'Fonctionnalités',  path: '/admin-features',  color: '#f97316' }, // orange
      ]
    : undefined;
}

function HomePage({ onNavigate, user }: { onNavigate?: (path: string) => void; user?: User | null }) {
  return (
    <>
      <SharedNav allowedAppIds={user?.permissions} onNavigate={onNavigate} extraDrawerLinks={adminDrawerLinks(user)} />
      <main>
        <LandingPage onNavigate={onNavigate} />
      </main>
    </>
  );
}

export function AppRouter({ onNavigate, user, onLogout, embedMode, embedId }: AppRouterProps) {
  // Embed mode: render module directly without nav
  if (embedMode && embedId) {
    return (
      <Routes>
        <Route
          path="/roadmap/*"
          element={
            <SuspenseWrapper>
              <RoadmapApp onNavigate={onNavigate} embedMode embedId={embedId} />
            </SuspenseWrapper>
          }
        />
        <Route
          path="/mon-cv/*"
          element={
            <SuspenseWrapper>
              <MonCvApp onNavigate={onNavigate} embedMode embedId={embedId} />
            </SuspenseWrapper>
          }
        />
        <Route
          path="/rag/*"
          element={
            <SuspenseWrapper>
              <RagApp onNavigate={onNavigate} embedMode embedId={embedId} />
            </SuspenseWrapper>
          }
        />
        <Route
          path="*"
          element={
            <div className="embed-error">
              <p>Module non trouvé pour l'embed</p>
            </div>
          }
        />
      </Routes>
    );
  }

  // Normal mode with authentication
  return (
    <Routes>
      <Route
        path="/"
        element={<HomePage onNavigate={onNavigate} user={user} />}
      />
      <Route
        path="/reglages"
        element={
          <>
            <SharedNav allowedAppIds={user?.permissions} onNavigate={onNavigate} extraDrawerLinks={adminDrawerLinks(user)} />
            <main style={{ paddingTop: 0 }}>
              <SettingsPage onBack={() => onNavigate ? onNavigate('/') : (window.location.href = '/')} user={user} />
            </main>
          </>
        }
      />
      <Route
        path="/settings/connectors"
        element={
          <>
            <SharedNav allowedAppIds={user?.permissions} onNavigate={onNavigate} extraDrawerLinks={adminDrawerLinks(user)} />
            <main style={{ paddingTop: 0 }}>
              <ConnectorsPage onBack={() => onNavigate ? onNavigate('/') : (window.location.href = '/')} />
            </main>
          </>
        }
      />
      <Route
        path="/conges/*"
        element={
          <SuspenseWrapper>
            <CongesApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/roadmap/*"
        element={
          <SuspenseWrapper>
            <RoadmapApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/suivitess/*"
        element={
          <SuspenseWrapper>
            <SuivitessApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/delivery/*"
        element={
          <SuspenseWrapper>
            <DeliveryApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/mon-cv/*"
        element={
          <SuspenseWrapper>
            <MonCvApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/rag/*"
        element={
          <SuspenseWrapper>
            <RagApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/demo/*"
        element={
          <SuspenseWrapper>
            <DemoApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/landing-demo"
        element={
          <SuspenseWrapper>
            <LandingDemoModule />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/ai-logs"
        element={
          <SuspenseWrapper>
            <AiLogsApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/ai-logs/:logId"
        element={
          <SuspenseWrapper>
            <AiLogsApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/ai-routing"
        element={
          <SuspenseWrapper>
            <AiRoutingApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/ai-routing/:logId"
        element={
          <SuspenseWrapper>
            <AiRoutingApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/ai-evals"
        element={
          <SuspenseWrapper>
            <AiEvalsApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/ai-evals/:datasetId"
        element={
          <SuspenseWrapper>
            <AiEvalsApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/ai-playground"
        element={
          <SuspenseWrapper>
            <AiPlaygroundApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/prompt-logs"
        element={
          <SuspenseWrapper>
            <PromptLogsApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/admin-features"
        element={
          <SuspenseWrapper>
            <AdminFeaturesApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/design-system/*"
        element={
          <SuspenseWrapper>
            <DesignSystemApp onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="/ux-preview"
        element={
          <SuspenseWrapper>
            <UxPreviewSandbox onNavigate={onNavigate} />
          </SuspenseWrapper>
        }
      />
      <Route
        path="*"
        element={
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <h1>404</h1>
            <p>Page non trouvée</p>
            <a href="/">Retour à l'accueil</a>
          </div>
        }
      />
    </Routes>
  );
}

export default AppRouter;
