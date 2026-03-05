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
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

type View = 'copy' | 'admin' | 'compat' | 'super';
type AdminSubView = 'sellers' | 'users' | 'billing';
type AuthView = 'login' | 'signup' | 'forgot' | 'reset';

export default function App() {
  const auth = useAuth();
  const [view, setView] = useState<View>('copy');
  const [adminSubView, setAdminSubView] = useState<AdminSubView>('sellers');
  const [authView, setAuthView] = useState<AuthView>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset_token')) return 'reset';
    return 'login';
  });
  const [resetToken, setResetToken] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('reset_token') || '';
  });
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [paymentActive, setPaymentActive] = useState(true);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [paywallLoading, setPaywallLoading] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('onboarding-done'));

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

  // Auto-detect payment after Stripe return
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);

    if (params.get('billing') === 'cancel') {
      setBillingMessage('Assinatura cancelada');
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    if (params.get('billing') !== 'success') return;

    let attempts = 0;
    const maxAttempts = 10;
    const interval = setInterval(() => {
      attempts++;
      fetch(`${API_BASE}/api/billing/status`, { headers: auth.headers() })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.payment_active) {
            setPaymentActive(true);
            clearInterval(interval);
            window.history.replaceState(null, '', window.location.pathname);
          } else if (attempts >= maxAttempts) {
            clearInterval(interval);
            setBillingMessage('Pagamento em processamento. Atualize a pagina em alguns segundos.');
            window.history.replaceState(null, '', window.location.pathname);
          }
        })
        .catch(() => {
          if (attempts >= maxAttempts) {
            clearInterval(interval);
            setBillingMessage('Pagamento em processamento. Atualize a pagina em alguns segundos.');
            window.history.replaceState(null, '', window.location.pathname);
          }
        });
    }, 2000);

    return () => clearInterval(interval);
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
    if (authView === 'forgot') {
      return (
        <ForgotPassword
          onNavigateToLogin={() => setAuthView('login')}
        />
      );
    }
    if (authView === 'reset' && resetToken) {
      return (
        <ResetPassword
          token={resetToken}
          onNavigateToLogin={() => {
            setAuthView('login');
            setResetToken('');
            window.history.replaceState(null, '', window.location.pathname);
          }}
        />
      );
    }
    return (
      <Login
        onLogin={auth.login}
        onNavigateToSignup={() => setAuthView('signup')}
        onNavigateToForgotPassword={() => setAuthView('forgot')}
      />
    );
  }

  // Paywall: billing configured, not paid, not super-admin
  if (billingAvailable && !paymentActive && !auth.user?.is_super_admin) {
    const handlePaywallSubscribe = async () => {
      setPaywallLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/billing/create-checkout`, {
          method: 'POST',
          headers: auth.headers(),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setBillingMessage(data?.detail || 'Erro ao criar sessao de checkout');
          return;
        }
        const data = await res.json();
        window.location.href = data.checkout_url;
      } catch {
        setBillingMessage('Erro de conexao');
      } finally {
        setPaywallLoading(false);
      }
    };

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
      }}>
        <div className="animate-in" style={{
          width: '100%',
          maxWidth: 480,
        }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
            <h1 style={{
              fontSize: 'var(--text-2xl)',
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
            }}>
              Copie anuncios entre contas do Mercado Livre em segundos
            </p>
          </div>

          {/* Pricing card */}
          <div style={{
            background: 'var(--surface)',
            borderRadius: 16,
            padding: 'var(--space-8)',
            border: '1px solid var(--line)',
          }}>
            {/* Plan name + price */}
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
              <p style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.08em',
                color: 'var(--ink-muted)',
                marginBottom: 'var(--space-3)',
              }}>
                Plano Profissional
              </p>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 'var(--space-1)' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', fontWeight: 500 }}>R$</span>
                <span style={{ fontSize: 40, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.03em', lineHeight: 1 }}>349</span>
                <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--ink)' }}>,90</span>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', marginLeft: 'var(--space-1)' }}>/mes</span>
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--line)', margin: '0 calc(-1 * var(--space-2))', marginBottom: 'var(--space-5)' }} />

            {/* Features */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
              {[
                'Copia ilimitada de anuncios',
                'Copia de compatibilidades veiculares',
                'Multiplas contas do Mercado Livre',
                'Usuarios e permissoes por conta',
                'Dimensoes e atributos automaticos',
              ].map((feature) => (
                <div key={feature} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M13.3 4.3L6 11.6L2.7 8.3" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{feature}</span>
                </div>
              ))}
            </div>

            {/* CTA */}
            <button
              onClick={handlePaywallSubscribe}
              disabled={paywallLoading}
              className="btn-primary"
              style={{
                width: '100%',
                padding: '14px 24px',
                fontSize: 'var(--text-base)',
                fontWeight: 600,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
              }}
            >
              {paywallLoading && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--paper)' }} />}
              {paywallLoading ? 'Redirecionando...' : 'Comecar agora'}
            </button>

            {/* Trust signals */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-4)',
              marginTop: 'var(--space-4)',
            }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>
                Cancele quando quiser
              </span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--ink-faint)', flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>
                Pagamento seguro via Stripe
              </span>
            </div>

            {billingMessage && (
              <p style={{
                color: 'var(--ink-muted)',
                fontSize: 'var(--text-sm)',
                textAlign: 'center',
                marginTop: 'var(--space-4)',
              }}>
                {billingMessage}
              </p>
            )}
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: 'var(--space-6)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>
              Conectado como {auth.user?.username}
              {auth.user?.org_name ? ` — ${auth.user.org_name}` : ''}
            </span>
            <span style={{ margin: '0 var(--space-2)', color: 'var(--ink-faint)' }}>·</span>
            <button
              onClick={auth.logout}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--ink-faint)',
                fontSize: 'var(--text-xs)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Sair
            </button>
          </div>
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

      {/* Onboarding Guide */}
      {showOnboarding && !auth.user?.is_super_admin && (
        <div style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 'var(--space-6)',
        }}>
          <h2 style={{
            fontSize: 'var(--text-base)',
            fontWeight: 700,
            color: 'var(--ink)',
            marginBottom: 'var(--space-4)',
          }}>
            Bem-vindo ao Copy Anuncios!
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
              <strong style={{ color: 'var(--ink)' }}>1.</strong> Conecte sua conta do Mercado Livre na aba Admin &gt; Sellers
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
              <strong style={{ color: 'var(--ink)' }}>2.</strong> Cole os IDs dos anuncios que deseja copiar
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
              <strong style={{ color: 'var(--ink)' }}>3.</strong> Selecione origem e destino e clique Copiar
            </p>
          </div>
          <button
            onClick={() => {
              localStorage.setItem('onboarding-done', 'true');
              setShowOnboarding(false);
            }}
            className="btn-primary"
            style={{ marginTop: 'var(--space-4)', padding: '8px 20px', fontSize: 'var(--text-sm)' }}
          >
            Entendi
          </button>
        </div>
      )}

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
