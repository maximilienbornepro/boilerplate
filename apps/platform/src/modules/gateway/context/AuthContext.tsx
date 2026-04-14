import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

interface User {
  id: number;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  permissions: string[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      setUser(data.user);
    } catch {
      setUser(null);
    }
  };

  // On mount, try to fetch the user. If the backend isn't ready yet
  // (network error), retry a few times before giving up — this avoids
  // the "Erreur de connexion" flash when the frontend starts before
  // the backend in local dev.
  useEffect(() => {
    let cancelled = false;
    const MAX_RETRIES = 8;
    const RETRY_DELAY = 800; // ms

    async function init() {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const res = await fetch('/api/auth/me', { credentials: 'include' });
          if (cancelled) return;
          const data = await res.json();
          setUser(data.user);
          return;
        } catch {
          // Network error — backend probably not ready yet
          if (cancelled) return;
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY));
          }
        }
      }
      // All retries exhausted — no backend available
      if (!cancelled) setUser(null);
    }

    init().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = async (email: string, password: string) => {
    const MAX_LOGIN_RETRIES = 3;
    const RETRY_DELAY = 1000;

    for (let attempt = 0; attempt < MAX_LOGIN_RETRIES; attempt++) {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          credentials: 'include',
        });
        const data = await res.json();

        if (!res.ok) {
          return { success: false, error: data.error };
        }

        setUser(data.user);
        return { success: true };
      } catch {
        if (attempt < MAX_LOGIN_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY));
          continue;
        }
        return { success: false, error: 'Erreur de connexion' };
      }
    }
    return { success: false, error: 'Erreur de connexion' };
  };

  const register = async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error };
      }

      return { success: true, message: data.message };
    } catch {
      return { success: false, error: 'Erreur lors de la création du compte' };
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
