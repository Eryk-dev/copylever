import { useState, useCallback, useEffect } from 'react';
import { API_BASE, type Seller, type ShopeeSeller } from '../lib/api';
import { SHOPEE_ENABLED } from '../lib/features';

const TOKEN_KEY = 'copy-auth-token';

export interface UserPermission {
  seller_slug: string;
  can_copy_from: boolean;
  can_copy_to: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'operator';
  org_id: string;
  org_name: string;
  is_super_admin: boolean;
  can_run_compat: boolean;
  permissions: UserPermission[];
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY);
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [shopeeSellers, setShopeeSellers] = useState<ShopeeSeller[]>([]);
  const [loadingSellers, setLoadingSellers] = useState(false);
  const [initializing, setInitializing] = useState(() => !!localStorage.getItem(TOKEN_KEY));

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
    setShopeeSellers([]);
  }, []);

  const fetchMe = useCallback(async (t: string): Promise<AuthUser | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { 'X-Auth-Token': t },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.status === 401) {
        clearAuth();
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  }, [clearAuth]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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

  const signup = useCallback(async (email: string, password: string, companyName: string): Promise<{success: boolean, error?: string}> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, company_name: companyName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return { success: false, error: data?.detail || 'Erro ao criar conta' };
      }
      const data = await res.json();
      const newToken = data.token;
      setToken(newToken);
      localStorage.setItem(TOKEN_KEY, newToken);
      const me = await fetchMe(newToken);
      if (!me) return { success: false, error: 'Erro ao criar conta' };
      setUser(me);
      return { success: true };
    } catch {
      return { success: false, error: 'Erro de conexao' };
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${API_BASE}/api/sellers`, {
        headers: headers(),
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.status === 401) { clearAuth(); return; }
      const data = await res.json();
      setSellers(data);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof DOMException && e.name === 'AbortError') return;
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

  const loadShopeeSellers = useCallback(async () => {
    if (!token) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${API_BASE}/api/shopee/sellers`, {
        headers: headers(),
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.status === 401) { clearAuth(); return; }
      const data = await res.json();
      setShopeeSellers(data);
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error('Failed to load Shopee sellers:', e);
    }
  }, [token, headers, clearAuth]);

  const disconnectShopeeSeller = useCallback(async (slug: string) => {
    if (!token) return;
    try {
      await fetch(`${API_BASE}/api/shopee/sellers/${slug}`, {
        method: 'DELETE',
        headers: headers(),
      });
      await loadShopeeSellers();
    } catch (e) {
      console.error('Failed to disconnect Shopee seller:', e);
    }
  }, [token, headers, loadShopeeSellers]);

  // Fetch user on mount if token exists
  useEffect(() => {
    if (token && !user) {
      fetchMe(token).then(me => {
        if (me) setUser(me);
      }).finally(() => setInitializing(false));
    } else {
      setInitializing(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load sellers when user is available
  useEffect(() => {
    if (token && user) {
      loadSellers();
      if (SHOPEE_ENABLED) loadShopeeSellers();
    }
  }, [token, user, loadSellers, loadShopeeSellers]);

  // Refresh on visibility change
  useEffect(() => {
    if (!token || !user) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadSellers();
        if (SHOPEE_ENABLED) void loadShopeeSellers();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [token, user, loadSellers, loadShopeeSellers]);

  return {
    isAuthenticated,
    initializing,
    token,
    user,
    login,
    signup,
    logout,
    sellers,
    loadingSellers,
    loadSellers,
    disconnectSeller,
    shopeeSellers,
    loadShopeeSellers,
    disconnectShopeeSeller,
    headers,
  };
}
