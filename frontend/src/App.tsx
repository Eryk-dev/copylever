import { useState, useMemo } from 'react';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import CopyPage from './pages/CopyPage';
import Admin from './pages/Admin';
import UsersPage from './pages/UsersPage';
import CompatPage from './pages/CompatPage';

type View = 'copy' | 'admin' | 'compat';
type AdminSubView = 'sellers' | 'users';

export default function App() {
  const auth = useAuth();
  const [view, setView] = useState<View>('copy');
  const [adminSubView, setAdminSubView] = useState<AdminSubView>('sellers');

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

    return tabs;
  }, [auth.user]);

  // Redirect to first available tab if current tab is not visible
  const activeView = visibleTabs.includes(view)
    ? view
    : visibleTabs[0] ?? 'copy';

  if (!auth.isAuthenticated) {
    return <Login onLogin={auth.login} />;
  }

  return (
    <div style={{
      width: '100%',
      maxWidth: 720,
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
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {auth.user && (
            <span style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-muted)',
            }}>
              {auth.user.username}
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

      {/* Content */}
      <div className="animate-in">
        {activeView === 'copy' && (
          <CopyPage sellers={auth.sellers} headers={auth.headers} />
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
            </nav>
            {adminSubView === 'sellers' && (
              <Admin
                sellers={auth.sellers}
                loadSellers={auth.loadSellers}
                disconnectSeller={auth.disconnectSeller}
              />
            )}
            {adminSubView === 'users' && auth.user && (
              <UsersPage headers={auth.headers} currentUserId={auth.user.id} />
            )}
          </div>
        )}
        {activeView === 'compat' && (
          <CompatPage sellers={auth.sellers} headers={auth.headers} />
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
