import { useState, useMemo, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { API_BASE } from './lib/api';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import CopyPage from './pages/CopyPage';
import Admin from './pages/Admin';
import UsersPage from './pages/UsersPage';
import CompatPage from './pages/CompatPage';
import ShopeeCopyPage from './pages/ShopeeCopyPage';
import SuperAdminPage from './pages/SuperAdminPage';
import BillingPage from './pages/BillingPage';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';

type View = 'copy' | 'shopee' | 'admin' | 'compat' | 'super';
type AdminSubView = 'sellers' | 'users' | 'billing';
type AuthView = 'landing' | 'login' | 'signup' | 'forgot' | 'reset';

export default function App() {
  const auth = useAuth();
  const [view, setView] = useState<View>('copy');
  const [adminSubView, setAdminSubView] = useState<AdminSubView>('sellers');
  const [authView, setAuthView] = useState<AuthView>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset_token')) return 'reset';
    return 'landing';
  });
  const [resetToken, setResetToken] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('reset_token') || '';
  });
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [paymentActive, setPaymentActive] = useState(true);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [paywallLoading, setPaywallLoading] = useState(false);
  const [connectingMl, setConnectingMl] = useState(false);
  const [quickStartDismissed, setQuickStartDismissed] = useState(true);
  const [trialCopiesUsed, setTrialCopiesUsed] = useState(0);
  const [trialCopiesLimit, setTrialCopiesLimit] = useState(20);
  const [trialActive, setTrialActive] = useState(false);
  const [trialExhausted, setTrialExhausted] = useState(false);

  const quickStartStorageKey = auth.user ? `copy-anuncios:quickstart-dismissed:${auth.user.org_id}` : null;

  // Reset to landing page on logout
  useEffect(() => {
    if (!auth.isAuthenticated && authView !== 'reset') {
      setAuthView('landing');
    }
  }, [auth.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (data) {
          setPaymentActive(data.payment_active);
          setTrialCopiesUsed(data.trial_copies_used ?? 0);
          setTrialCopiesLimit(data.trial_copies_limit ?? 20);
          setTrialActive(data.trial_active ?? false);
          setTrialExhausted(data.trial_exhausted ?? false);
        }
      })
      .catch(() => setBillingAvailable(false));
  }, [auth.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quickStartStorageKey) {
      setQuickStartDismissed(true);
      return;
    }
    setQuickStartDismissed(localStorage.getItem(quickStartStorageKey) === '1');
  }, [quickStartStorageKey]);

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
            setTrialActive(false);
            setTrialExhausted(false);
            clearInterval(interval);
            window.history.replaceState(null, '', window.location.pathname);
          } else if (attempts >= maxAttempts) {
            clearInterval(interval);
            setBillingMessage('Pagamento em processamento. Atualize a página em alguns segundos.');
            window.history.replaceState(null, '', window.location.pathname);
          }
        })
        .catch(() => {
          if (attempts >= maxAttempts) {
            clearInterval(interval);
            setBillingMessage('Pagamento em processamento. Atualize a página em alguns segundos.');
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
      tabs.push('shopee');
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

  const showQuickStart = Boolean(
    auth.user &&
    auth.user.role === 'admin' &&
    !auth.user.is_super_admin &&
    !quickStartDismissed &&
    auth.sellers.length > 0
  );

  // Wait for auth to resolve — show themed blank screen to avoid flash
  if (auth.initializing) return <div style={{ minHeight: '100vh', background: 'var(--paper)' }} />;

  if (!auth.isAuthenticated) {
    if (authView === 'landing') {
      return (
        <LandingPage
          onNavigateToLogin={() => setAuthView('login')}
          onNavigateToSignup={() => setAuthView('signup')}
        />
      );
    }
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

  // Paywall: billing configured, not paid, trial exhausted, not super-admin
  if (billingAvailable && !paymentActive && trialExhausted && !auth.user?.is_super_admin) {
    const handlePaywallSubscribe = async () => {
      setPaywallLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/billing/create-checkout`, {
          method: 'POST',
          headers: auth.headers(),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setBillingMessage(data?.detail || 'Erro ao criar sessão de checkout');
          return;
        }
        const data = await res.json();
        window.location.href = data.checkout_url;
      } catch {
        setBillingMessage('Erro de conexão');
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
        <style>{`
          .lp-logo-img { filter: none; }
          @media (prefers-color-scheme: dark) {
            .lp-logo-img { filter: invert(1); }
          }
        `}</style>
        <div className="animate-in" style={{
          width: '100%',
          maxWidth: 480,
        }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
            <img src="/logo-lever.svg" alt="Copy Anúncios" className="lp-logo-img" style={{ height: 36, display: 'block', margin: '0 auto var(--space-2)' }} />
            <h1 style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--ink)',
              marginBottom: 'var(--space-2)',
            }}>
              Copy Anúncios
            </h1>
            <p style={{
              color: 'var(--ink-muted)',
              fontSize: 'var(--text-sm)',
            }}>
              Você usou suas {trialCopiesLimit} cópias gratuitas. Assine para continuar copiando.
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
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', marginLeft: 'var(--space-1)' }}>/mês</span>
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--line)', margin: '0 calc(-1 * var(--space-2))', marginBottom: 'var(--space-5)' }} />

            {/* Features */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
              {[
                'Cópia ilimitada de anúncios',
                'Cópia de compatibilidades veiculares',
                'Múltiplas contas do Mercado Livre',
                'Usuários e permissões por conta',
                'Dimensões e atributos automáticos',
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
              {paywallLoading ? 'Redirecionando...' : 'Começar agora'}
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

  // Empty state: no sellers connected yet — show connect screen
  if (auth.sellers.length === 0 && auth.shopeeSellers.length === 0 && auth.user?.role === 'admin' && !auth.user?.is_super_admin) {
    const handleConnectMl = async () => {
      setConnectingMl(true);
      try {
        const res = await fetch(`${API_BASE}/api/ml/install`, { headers: auth.headers() });
        if (!res.ok) {
          setConnectingMl(false);
          return;
        }
        const data = await res.json();
        if (data.redirect_url) window.location.href = data.redirect_url;
      } catch {
        setConnectingMl(false);
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
        <style>{`
          .lp-logo-img { filter: none; }
          @media (prefers-color-scheme: dark) {
            .lp-logo-img { filter: invert(1); }
          }
        `}</style>
        <div className="animate-in" style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
          <img src="/logo-lever.svg" alt="Copy Anúncios" className="lp-logo-img" style={{ height: 32, display: 'block', margin: '0 auto var(--space-6)' }} />

          <h1 style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--ink)',
            marginBottom: 'var(--space-2)',
          }}>
            Conecte sua conta
          </h1>
          <p style={{
            color: 'var(--ink-muted)',
            fontSize: 'var(--text-sm)',
            lineHeight: 1.6,
            marginBottom: 'var(--space-8)',
          }}>
            Para começar a copiar anúncios, conecte pelo menos uma conta do Mercado Livre.
          </p>

          <button
            onClick={handleConnectMl}
            disabled={connectingMl}
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
            {connectingMl && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--paper)' }} />}
            {connectingMl ? 'Redirecionando...' : 'Conectar conta do Mercado Livre'}
          </button>

          <div style={{ marginTop: 'var(--space-6)' }}>
            <button
              onClick={auth.logout}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--ink-faint)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                textDecoration: 'underline',
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
    <div className="app-shell" style={{
      width: '100%',
      maxWidth: 960,
      margin: '0 auto',
      padding: 'clamp(16px, 3vw, 48px) var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-8)',
      minHeight: '100vh',
    }}>
      <style>{`
        .lp-logo-img { filter: none; }
        @media (prefers-color-scheme: dark) {
          .lp-logo-img { filter: invert(1); }
        }
      `}</style>
      {/* Header */}
      <header className="app-header" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        flexWrap: 'wrap',
      }}>
        <div className="app-header-brand" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
            <img src="/logo-lever.svg" alt="Copy Anúncios" className="lp-logo-img" style={{ height: 28, display: 'block' }} />
            <h1 style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 700,
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--ink)',
            }}>
              Copy Anúncios
            </h1>
          </div>
          <nav className="app-header-nav" style={{
            display: 'flex',
            gap: 2,
            background: 'var(--surface)',
            borderRadius: 8,
            padding: 2,
            flexWrap: 'wrap',
          }}>
            {visibleTabs.includes('copy') && (
              <ViewTab active={activeView === 'copy'} onClick={() => setView('copy')}>
                Cópia
              </ViewTab>
            )}
            {visibleTabs.includes('shopee') && (
              <ViewTab active={activeView === 'shopee'} onClick={() => setView('shopee')}>
                Shopee
              </ViewTab>
            )}
            {visibleTabs.includes('compat') && (
              <ViewTab active={activeView === 'compat'} onClick={() => setView('compat')}>
                Compatibilidade
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

        <div className="app-header-user" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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

      {/* Trial Progress Banner */}
      {trialActive && !auth.user?.is_super_admin && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 'var(--space-3) var(--space-4)',
          fontSize: 'var(--text-sm)',
          color: 'var(--ink)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontWeight: 600 }}>
              Período de teste gratuito
              </span>
              <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-xs)' }}>
              {trialCopiesUsed}/{trialCopiesLimit} cópias usadas
              </span>
            </div>
          <div style={{
            height: 6,
            background: 'var(--line)',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, (trialCopiesUsed / trialCopiesLimit) * 100)}%`,
              background: trialCopiesUsed >= trialCopiesLimit * 0.8 ? 'var(--warning, #f59e0b)' : 'var(--success, #22c55e)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
          {auth.user?.role === 'admin' && trialCopiesUsed >= trialCopiesLimit * 0.5 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <button
                className="btn-ghost"
                style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}
                onClick={() => { setView('admin'); setAdminSubView('billing'); }}
              >
                Assinar plano
              </button>
            </div>
          )}
        </div>
      )}

      {/* Payment Banner */}
      {billingAvailable && !paymentActive && !trialActive && auth.user?.role === 'admin' && !auth.user?.is_super_admin && (
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

      {showQuickStart && (
        <QuickStartGuide
          canOpenCompat={visibleTabs.includes('compat')}
          onDismiss={() => {
            if (!quickStartStorageKey) return;
            localStorage.setItem(quickStartStorageKey, '1');
            setQuickStartDismissed(true);
          }}
          onOpenCompat={() => setView('compat')}
          onOpenCopy={() => setView('copy')}
          onOpenSellers={() => {
            setView('admin');
            setAdminSubView('sellers');
          }}
        />
      )}

      {/* Content */}
      <div className="animate-in">
        {activeView === 'copy' && (
          <CopyPage sellers={auth.sellers} headers={auth.headers} user={auth.user} />
        )}
        {activeView === 'shopee' && (
          <ShopeeCopyPage shopeeSellers={auth.shopeeSellers} headers={auth.headers} user={auth.user} />
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
                shopeeSellers={auth.shopeeSellers}
                loadShopeeSellers={auth.loadShopeeSellers}
                disconnectShopeeSeller={auth.disconnectShopeeSeller}
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

function QuickStartGuide({
  canOpenCompat,
  onDismiss,
  onOpenCompat,
  onOpenCopy,
  onOpenSellers,
}: {
  canOpenCompat: boolean;
  onDismiss: () => void;
  onOpenCompat: () => void;
  onOpenCopy: () => void;
  onOpenSellers: () => void;
}) {
  return (
    <div className="card" style={{
      background: 'linear-gradient(180deg, rgba(35, 216, 211, 0.08), transparent 100%), var(--surface)',
      borderRadius: 12,
      padding: 'var(--space-5)',
      border: '1px solid var(--line)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
        flexWrap: 'wrap',
      }}>
        <div>
          <p style={{
            fontSize: 'var(--text-xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--positive)',
            fontWeight: 700,
            marginBottom: 'var(--space-2)',
          }}>
            Primeiro uso
          </p>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 700,
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--ink)',
            marginBottom: 'var(--space-1)',
          }}>
            Guia rápido para começar sem fricção
          </h2>
          <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)', maxWidth: 560 }}>
            Seu workspace já está pronto para operar. Siga estes três passos para validar sellers, conferir anúncios e fazer a primeira execução com mais segurança.
          </p>
        </div>

        <button className="btn-ghost" onClick={onDismiss} style={{ padding: '6px 12px', fontSize: 'var(--text-xs)' }}>
          Entendi
        </button>
      </div>

      <div className="quickstart-grid">
        <QuickStartStep
          step="1"
          title="Revise sellers conectados"
          description="Abra Admin > Sellers para conectar novas contas do Mercado Livre ou revisar tokens antes de operar em produção."
          actionLabel="Abrir sellers"
          onAction={onOpenSellers}
        />
        <QuickStartStep
          step="2"
          title="Cole IDs e confira o preview"
          description="Na aba Cópia, cole os IDs dos anúncios, valide a origem detectada e revise o preview antes de enviar o lote."
          actionLabel="Abrir cópia"
          onAction={onOpenCopy}
        />
        <QuickStartStep
          step="3"
          title={canOpenCompat ? 'Execute copy ou compatibilidade' : 'Dispare sua primeira cópia'}
          description={canOpenCompat
            ? 'Use a aba Compatibilidade para replicar SKUs em lote ou finalize a cópia completa com histórico em tempo real.'
            : 'Selecione origem, destinos e acompanhe o histórico em tempo real para validar a primeira execução.'}
          actionLabel={canOpenCompat ? 'Abrir compatibilidade' : 'Voltar para cópia'}
          onAction={canOpenCompat ? onOpenCompat : onOpenCopy}
        />
      </div>
    </div>
  );
}

function QuickStartStep({
  step,
  title,
  description,
  actionLabel,
  onAction,
}: {
  step: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div style={{
      background: 'var(--paper)',
      border: '1px solid var(--line)',
      borderRadius: 10,
      padding: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'var(--ink)',
          color: 'var(--paper)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {step}
        </span>
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--ink)' }}>{title}</h3>
      </div>

      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', lineHeight: 1.6 }}>
        {description}
      </p>

      <button className="btn-ghost" onClick={onAction} style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: 'var(--text-xs)' }}>
        {actionLabel}
      </button>
    </div>
  );
}
