import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import CopyPage from './pages/CopyPage';
import Admin from './pages/Admin';

type View = 'copy' | 'admin';

export default function App() {
  const auth = useAuth();
  const [view, setView] = useState<View>('copy');

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
            <ViewTab active={view === 'copy'} onClick={() => setView('copy')}>
              Copiar
            </ViewTab>
            <ViewTab active={view === 'admin'} onClick={() => setView('admin')}>
              Sellers
            </ViewTab>
          </nav>
        </div>

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
      </header>

      {/* Content */}
      <div className="animate-in">
        {view === 'copy' && (
          <CopyPage sellers={auth.sellers} headers={auth.headers} />
        )}
        {view === 'admin' && (
          <Admin
            sellers={auth.sellers}
            loadSellers={auth.loadSellers}
            disconnectSeller={auth.disconnectSeller}
          />
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
