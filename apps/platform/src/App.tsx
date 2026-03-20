import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './modules/gateway/context/AuthContext';
import { LoginPage } from './modules/gateway/components/LoginPage';
import { RegisterPage } from './modules/gateway/components/RegisterPage';
import { LoadingSpinner } from '@boilerplate/shared/components';
import { useSharedTheme } from '@boilerplate/shared/hooks';
import { AppRouter } from './router';
import './modules/gateway/App.css';

type AuthPage = 'login' | 'register';

function AppContent() {
  const { user, loading, logout } = useAuth();
  // Apply theme globally (login, register, all pages)
  useSharedTheme();
  const [authPage, setAuthPage] = useState<AuthPage>(() => {
    if (window.location.pathname === '/register') {
      return 'register';
    }
    return 'login';
  });
  const navigate = useNavigate();

  if (loading) {
    return <LoadingSpinner size="lg" message="Chargement..." fullPage />;
  }

  // Not logged in: show login or register
  if (!user) {
    if (authPage === 'register') {
      return <RegisterPage onSwitchToLogin={() => setAuthPage('login')} />;
    }
    return <LoginPage onSwitchToRegister={() => setAuthPage('register')} />;
  }

  // Logged in but not active
  if (!user.isActive) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">Compte en attente</h1>
          <p className="auth-message">
            Votre compte n'a pas encore été validé.
            <br />
            <strong>Contactez un administrateur pour avoir les droits suffisants.</strong>
          </p>
          <button className="auth-button secondary" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  // Authenticated: show all apps
  return (
    <AppRouter
      onNavigate={(path) => navigate(path)}
      user={user}
      onLogout={logout}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
