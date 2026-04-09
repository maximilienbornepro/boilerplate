import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';

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

export default useGatewayAuth;
