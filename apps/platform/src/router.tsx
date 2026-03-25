import { lazy, Suspense, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { LoadingSpinner, SharedNav } from '@boilerplate/shared/components';
import { LandingPage } from './modules/gateway/components/LandingPage';
import { AdminPage } from './modules/gateway/components/AdminPage';

// Lazy load modules
const ProductsApp = lazy(() => import('./modules/products/App'));
const CongesApp = lazy(() => import('./modules/conges/App'));
const RoadmapApp = lazy(() => import('./modules/roadmap/App'));
const SuivitessApp = lazy(() => import('./modules/suivitess/App'));

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

function HomePage({ onNavigate, user }: { onNavigate?: (path: string) => void; user?: User | null }) {
  const [showAdmin, setShowAdmin] = useState(false);

  // Admin view
  if (showAdmin && user?.isAdmin) {
    return (
      <>
        <SharedNav allowedAppIds={user.permissions} onNavigate={onNavigate}>
          <div className="gateway-nav-actions">
            <span className="nav-user">{user.email}</span>
          </div>
        </SharedNav>
        <main style={{ paddingTop: 0 }}>
          <AdminPage onBack={() => setShowAdmin(false)} />
        </main>
      </>
    );
  }

  // Landing
  return (
    <>
      <SharedNav allowedAppIds={user?.permissions} onNavigate={onNavigate}>
        <div className="gateway-nav-actions">
          {user?.isAdmin && (
            <button className="nav-btn admin-btn" onClick={() => setShowAdmin(true)}>
              Administration
            </button>
          )}
          <span className="nav-user">{user?.email}</span>
        </div>
      </SharedNav>
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
          path="/products/*"
          element={
            <SuspenseWrapper>
              <ProductsApp onNavigate={onNavigate} embedMode embedId={embedId} />
            </SuspenseWrapper>
          }
        />
        <Route
          path="/roadmap/*"
          element={
            <SuspenseWrapper>
              <RoadmapApp onNavigate={onNavigate} embedMode embedId={embedId} />
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
        path="/products/*"
        element={
          <SuspenseWrapper>
            <ProductsApp onNavigate={onNavigate} />
          </SuspenseWrapper>
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
