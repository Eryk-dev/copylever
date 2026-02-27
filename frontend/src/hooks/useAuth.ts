import { useState, useCallback, useEffect } from 'react';
import { API_BASE, type Seller } from '../lib/api';

const TOKEN_KEY = 'copy-auth-token';

export interface UserPermission {
  seller_slug: string;
  can_copy_from: boolean;
  can_copy_to: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'operator';
  can_run_compat: boolean;
  permissions: UserPermission[];
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY);
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loadingSellers, setLoadingSellers] = useState(false);

  const isAuthenticated = !!token && !!user;

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['X-Auth-Token'] = token;
    return h;
  }, [token]);

  const clearAuth = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    setSellers([]);
  }, []);

  const fetchMe = useCallback(async (t: string): Promise<AuthUser | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { 'X-Auth-Token': t },
      });
      if (res.status === 401) {
        clearAuth();
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, [clearAuth]);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const newToken = data.token;
      setToken(newToken);
      localStorage.setItem(TOKEN_KEY, newToken);
      const me = await fetchMe(newToken);
      if (!me) return false;
      setUser(me);
      return true;
    } catch {
      return false;
    }
  }, [fetchMe]);

  const logout = useCallback(() => {
    if (token) {
      fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'X-Auth-Token': token },
      }).catch(() => {});
    }
    clearAuth();
  }, [token, clearAuth]);

  const loadSellers = useCallback(async () => {
    if (!token) return;
    setLoadingSellers(true);
    try {
      const res = await fetch(`${API_BASE}/api/sellers`, {
        headers: headers(),
        cache: 'no-store',
      });
      if (res.status === 401) { clearAuth(); return; }
      const data = await res.json();
      setSellers(data);
    } catch (e) {
      console.error('Failed to load sellers:', e);
    } finally {
      setLoadingSellers(false);
    }
  }, [token, headers, clearAuth]);

  const disconnectSeller = useCallback(async (slug: string) => {
    if (!token) return;
    try {
      await fetch(`${API_BASE}/api/sellers/${slug}`, {
        method: 'DELETE',
        headers: headers(),
      });
      await loadSellers();
    } catch (e) {
      console.error('Failed to disconnect seller:', e);
    }
  }, [token, headers, loadSellers]);

  // Fetch user on mount if token exists
  useEffect(() => {
    if (token && !user) {
      fetchMe(token).then(me => {
        if (me) setUser(me);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load sellers when user is available
  useEffect(() => {
    if (token && user) {
      loadSellers();
    }
  }, [token, user, loadSellers]);

  // Refresh on visibility change
  useEffect(() => {
    if (!token || !user) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadSellers();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [token, user, loadSellers]);

  return {
    isAuthenticated,
    token,
    user,
    login,
    logout,
    sellers,
    loadingSellers,
    loadSellers,
    disconnectSeller,
    headers,
  };
}
