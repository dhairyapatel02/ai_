'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { API_BASE } from './utils';

interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  plan: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  apiFetch: <T>(path: string, options?: RequestInit) => Promise<{ success: boolean; data?: T; error?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  apiFetch: async () => ({ success: false, error: 'Not initialized' }),
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const apiFetch = useCallback(async <T,>(path: string, options?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> => {
    const userId = user?.id || localStorage.getItem('devimpact_user_id') || '';
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          ...options?.headers,
        },
      });
      return res.json();
    } catch {
      return { success: false, error: 'Network error' };
    }
  }, [user?.id]);

  useEffect(() => {
    async function init() {
      const storedId = localStorage.getItem('devimpact_user_id');
      if (storedId) {
        try {
          const res = await fetch(`${API_BASE}/auth/me`, {
            headers: { 'x-user-id': storedId },
          });
          const json = await res.json();
          if (json.success && json.data) {
            setUser(json.data);
            setLoading(false);
            return;
          }
        } catch {
          // fall through to dev-login
        }
      }

      try {
        const res = await fetch(`${API_BASE}/auth/dev-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        if (json.success && json.data) {
          localStorage.setItem('devimpact_user_id', json.data.id);
          setUser(json.data);
        }
      } catch {
        // API not available - show app without auth
      }
      setLoading(false);
    }
    init();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, apiFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
