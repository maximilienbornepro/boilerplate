import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { LoadingSpinner } from '../components/LoadingSpinner/LoadingSpinner.js';

interface User {
  id: number;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  permissions: string[];
}

interface GatewayAuthContext {
  user: User | null;
  loading: boolean;
  error: string | null;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<GatewayAuthContext | null>(null);

/**
 * Provider that fetches /api/auth/me and exposes user to all shared hooks.
 * Wrap the app root with this to enable useGatewayUser in every module.
 */
export function GatewayAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      setUser(data.user ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auth error');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useGatewayAuth(): GatewayAuthContext {
  const context = useContext(AuthContext);
  if (!context) {
    // Return a default context if not wrapped in provider
    return {
      user: null,
      loading: true,
      error: null,
      logout: async () => {},
      refreshUser: async () => {},
    };
  }
  return context;
}

export function useGatewayUser() {
  const { user, loading, error } = useGatewayAuth();
  return { user, loading, error };
}

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
  requireAdmin?: boolean;
  requirePermission?: string;
}

export function AuthGuard({
  children,
  fallback,
  requireAdmin = false,
  requirePermission,
}: AuthGuardProps) {
  const { user, loading } = useGatewayAuth();

  if (loading) {
    return <LoadingSpinner size="lg" message="Chargement..." fullPage />;
  }

  if (!user) {
    if (fallback) return <>{fallback}</>;
    // Redirect to login
    window.location.href = '/';
    return null;
  }

  if (requireAdmin && !user.isAdmin) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Acces refuse</h2>
        <p>Vous n'avez pas les droits administrateur.</p>
      </div>
    );
  }

  if (requirePermission && !user.permissions.includes(requirePermission)) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Acces refuse</h2>
        <p>Vous n'avez pas la permission requise: {requirePermission}</p>
      </div>
    );
  }

  return <>{children}</>;
}

export default useGatewayAuth;
