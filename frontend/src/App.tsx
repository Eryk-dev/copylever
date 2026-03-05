import { useState, useMemo, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { API_BASE } from './lib/api';
import Login from './pages/Login';
import Signup from './pages/Signup';
import CopyPage from './pages/CopyPage';
import Admin from './pages/Admin';
import UsersPage from './pages/UsersPage';
import CompatPage from './pages/CompatPage';
import SuperAdminPage from './pages/SuperAdminPage';
import BillingPage from './pages/BillingPage';

type View = 'copy' | 'admin' | 'compat' | 'super';
type AdminSubView = 'sellers' | 'users' | 'billing';
type AuthView = 'login' | 'signup';

export default function App() {
  const auth = useAuth();
  const [view, setView] = useState<View>('copy');
  const [adminSubView, setAdminSubView] = useState<AdminSubView>('sellers');
  const [authView, setAuthView] = useState<AuthView>('login');
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [paymentActive, setPaymentActive] = useState(true);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    fetch(`${API_BASE}/api/billing/status`, { headers: auth.headers() })
      .then(res => {
        if (res.status === 503) { setBillingAvailable(false); return null; }
        if (!res.ok) { setBillingAvailable(false); return null; }
        setBillingAvailable(true);
        return res.json();
      })
      .then(data => {
        if (data) setPaymentActive(data.payment_active);
      })
      .catch(() => setBillingAvailable(false));
  }, [auth.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleTabs = useMemo(() => {
    if (!auth.user) return [] as View[];
    const tabs: View[] = [];
    const u = auth.user;

    // Show Copiar tab if admin or has at least one can_copy_from AND one can_copy_to
    if (u.role === 'admin' ||
        (u.permissions.some(p => p.can_copy_from) && u.permissions.some(p => p.can_copy_to))) {
      tabs.push('copy');
    }

    // Show Compat tab if admin or can_run_compat
    if (u.role === 'admin' || u.can_run_compat) {
      tabs.push('compat');
    }

    // Show Admin tab only for admins
    if (u.role === 'admin') {
      tabs.push('admin');
    }

    // Show Plataforma tab for super-admins
    if (u.is_super_admin) {
      tabs.push('super');
    }

    return tabs;
  }, [auth.user]);

  // Redirect to first available tab if current tab is not visible
  const activeView = visibleTabs.includes(view)
    ? view
    : visibleTabs[0] ?? 'copy';

  if (!auth.isAuthenticated) {
    if (authView === 'signup') {
      return (
        <Signup
          onSignup={auth.signup}
          onNavigateToLogin={() => setAuthView('login')}
        />
      );
    }
    return (
      <Login
        onLogin={auth.login}
        onNavigateToSignup={() => setAuthView('signup')}
      />
    );
  }

  // Paywall: billing configured, not paid, not super-admin
  if (billingAvailable && !paymentActive && !auth.user?.is_super_admin) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
      }}>
        <div className="animate-in" style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 'var(--space-12)',
          width: '100%',
          maxWidth: 420,
          textAlign: 'center',
        }}>
          <h1 style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 700,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--ink)',
            marginBottom: 'var(--space-2)',
          }}>
            Copy Anuncios
          </h1>
          <p style={{
            color: 'var(--ink-muted)',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-6)',
          }}>
            {auth.user?.org_name || 'Sua empresa'}
          </p>
          <div style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 8,
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
          }}>
            <p style={{ color: 'var(--ink)', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
              Assinatura necessaria
            </p>
            <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-xs)' }}>
              Para usar o Copy Anuncios, ative sua assinatura.
            </p>
          </div>
          <BillingPage headers={auth.headers} />
          <button
            onClick={auth.logout}
            className="btn-ghost"
            style={{
              marginTop: 'var(--space-4)',
              padding: '6px 12px',
              fontSize: 'var(--text-xs)',
            }}
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      maxWidth: 960,
      margin: '0 auto',
      padding: 'clamp(16px, 3vw, 48px) var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-8)',
      minHeight: '100vh',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <h1 style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 700,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--ink)',
          }}>
            Copy Anuncios
          </h1>
          <nav style={{
            display: 'flex',
            gap: 2,
            background: 'var(--surface)',
            borderRadius: 8,
            padding: 2,
          }}>
            {visibleTabs.includes('copy') && (
              <ViewTab active={activeView === 'copy'} onClick={() => setView('copy')}>
                Copiar
              </ViewTab>
            )}
            {visibleTabs.includes('compat') && (
              <ViewTab active={activeView === 'compat'} onClick={() => setView('compat')}>
                Compat
              </ViewTab>
            )}
            {visibleTabs.includes('admin') && (
              <ViewTab active={activeView === 'admin'} onClick={() => setView('admin')}>
                Admin
              </ViewTab>
            )}
            {visibleTabs.includes('super') && (
              <ViewTab active={activeView === 'super'} onClick={() => setView('super')}>
                Plataforma
              </ViewTab>
            )}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {auth.user && (
            <span style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-muted)',
            }}>
              {auth.user.username}{auth.user.org_name ? ` - ${auth.user.org_name}` : ''}
            </span>
          )}
          <button
            onClick={auth.logout}
            className="btn-ghost"
            style={{
              padding: '6px 12px',
              fontSize: 'var(--text-xs)',
            }}
          >
            Sair
          </button>
        </div>
      </header>

      {/* Payment Banner */}
      {billingAvailable && !paymentActive && auth.user?.role === 'admin' && !auth.user?.is_super_admin && (
        <div style={{
          background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 8,
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 'var(--text-sm)',
          color: 'var(--ink)',
        }}>
          <span>Assinatura pendente</span>
          <button
            className="btn-ghost"
            style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}
            onClick={() => { setView('admin'); setAdminSubView('billing'); }}
          >
            Ver assinatura
          </button>
        </div>
      )}

      {/* Content */}
      <div className="animate-in">
        {activeView === 'copy' && (
          <CopyPage sellers={auth.sellers} headers={auth.headers} user={auth.user} />
        )}
        {activeView === 'admin' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <nav style={{ display: 'flex', gap: 2, background: 'var(--surface)', borderRadius: 8, padding: 2, alignSelf: 'flex-start' }}>
              <ViewTab active={adminSubView === 'sellers'} onClick={() => setAdminSubView('sellers')}>
                Sellers
              </ViewTab>
              <ViewTab active={adminSubView === 'users'} onClick={() => setAdminSubView('users')}>
                Usuários
              </ViewTab>
              {billingAvailable && (
                <ViewTab active={adminSubView === 'billing'} onClick={() => setAdminSubView('billing')}>
                  Assinatura
                </ViewTab>
              )}
            </nav>
            {adminSubView === 'sellers' && (
              <Admin
                sellers={auth.sellers}
                loadSellers={auth.loadSellers}
                disconnectSeller={auth.disconnectSeller}
                headers={auth.headers}
              />
            )}
            {adminSubView === 'users' && auth.user && (
              <UsersPage headers={auth.headers} currentUserId={auth.user.id} />
            )}
            {adminSubView === 'billing' && billingAvailable && (
              <BillingPage headers={auth.headers} />
            )}
          </div>
        )}
        {activeView === 'compat' && (
          <CompatPage sellers={auth.sellers} headers={auth.headers} />
        )}
        {activeView === 'super' && (
          <SuperAdminPage headers={auth.headers} />
        )}
      </div>
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: 6,
        fontSize: 'var(--text-sm)',
        fontWeight: active ? 600 : 400,
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink-muted)',
        border: 'none',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}
