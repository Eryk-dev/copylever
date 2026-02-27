import { useState, useCallback, useEffect } from 'react';
import { API_BASE, type Seller } from '../lib/api';

const TOKEN_KEY = 'copy-auth-token';

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY);
  });
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loadingSellers, setLoadingSellers] = useState(false);

  const isAuthenticated = !!token;

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['X-Auth-Token'] = token;
    return h;
  }, [token]);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setToken(data.token);
      localStorage.setItem(TOKEN_KEY, data.token);
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    if (token) {
      fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'X-Auth-Token': token },
      }).catch(() => {});
    }
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
    setSellers([]);
  }, [token]);

  const loadSellers = useCallback(async () => {
    if (!token) return;
    setLoadingSellers(true);
    try {
      const res = await fetch(`${API_BASE}/api/sellers`, {
        headers: headers(),
        cache: 'no-store',
      });
      if (res.status === 401) { logout(); return; }
      const data = await res.json();
      setSellers(data);
    } catch (e) {
      console.error('Failed to load sellers:', e);
    } finally {
      setLoadingSellers(false);
    }
  }, [token, headers, logout]);

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

  // Auto-load sellers on auth
  useEffect(() => {
    if (isAuthenticated) {
      loadSellers();
    }
  }, [isAuthenticated, loadSellers]);

  // Refresh on visibility change
  useEffect(() => {
    if (!isAuthenticated) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadSellers();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isAuthenticated, loadSellers]);

  return {
    isAuthenticated,
    token,
    login,
    logout,
    sellers,
    loadingSellers,
    loadSellers,
    disconnectSeller,
    headers,
  };
}
