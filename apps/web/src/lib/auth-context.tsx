'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo } from 'react';

import { authClient, clearApiToken, getApiToken } from './auth-client';
import { API_BASE } from './utils';

export interface User {
  id: string;
  email: string;
  name: string;
  image: string | null;
  plan: string;
}

export interface ApiResult<T> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  /** Human-readable message from the API error envelope (API_CONTRACT_V2 §2). */
  error?: string;
  code?: string;
  status?: number;
}

export type ApiFetch = <T>(path: string, options?: RequestInit) => Promise<ApiResult<T>>;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  apiFetch: ApiFetch;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  apiFetch: () => Promise.resolve({ success: false, error: 'Not initialized' }),
  signOut: () => Promise.resolve(),
});

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

/**
 * Session from Better Auth (cookie on the web origin) + a short-lived Bearer JWT for the API.
 * Replaces the v0.1 localStorage user id and `x-user-id` header (SEC-01/02). P09 replaces this
 * with the typed client + TanStack Query (ADR-0010).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const user = useMemo<User | null>(() => {
    if (!session?.user) return null;
    const u = session.user as typeof session.user & { plan?: string | null };
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image ?? null,
      plan: u.plan ?? 'FREE',
    };
  }, [session]);

  const apiFetch = useCallback<ApiFetch>(
    async <T,>(path: string, options?: RequestInit): Promise<ApiResult<T>> => {
      const call = async (forceRefresh: boolean) => {
        const token = await getApiToken({ forceRefresh });
        return fetch(`${API_BASE}${path}`, {
          ...options,
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headersToRecord(options?.headers),
          },
        });
      };
      try {
        let res = await call(false);
        if (res.status === 401) {
          // Refresh the JWT once (expired/rotated), then give up and sign in again.
          res = await call(true);
          if (res.status === 401) {
            clearApiToken();
            router.push(`/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
          }
        }
        const body = (await res.json().catch(() => ({}))) as Envelope<T>;
        if (res.ok && body.success) {
          return { success: true, data: body.data, meta: body.meta, status: res.status };
        }
        return {
          success: false,
          error: body.error?.message ?? `Request failed (${res.status})`,
          code: body.error?.code,
          status: res.status,
        };
      } catch {
        return { success: false, error: 'Network error' };
      }
    },
    [router],
  );

  const signOut = useCallback(async () => {
    clearApiToken();
    await authClient.signOut();
    router.push('/sign-in');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading: isPending, apiFetch, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
