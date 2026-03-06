import { useState } from 'react';
import { API_BASE } from '../lib/api';

interface Props {
  token: string;
  onNavigateToLogin: () => void;
}

export default function ResetPassword({ token, onNavigateToLogin }: Props) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [shake, setShake] = useState(false);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || !confirmPassword.trim()) return;

    if (password !== confirmPassword) {
      setError('Senhas não conferem');
      triggerShake();
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        setError('Link expirado. Solicite um novo.');
        triggerShake();
      }
    } catch {
      setError('Erro de conexão');
      triggerShake();
    }
    setLoading(false);
  };

  const inputStyle = (hasError: boolean) => ({
    width: '100%',
    padding: 'var(--space-3) var(--space-4)',
    background: 'var(--paper)',
    border: `1px solid ${hasError ? 'var(--danger)' : 'var(--line)'}`,
    borderRadius: 6,
    color: 'var(--ink)',
    fontSize: 'var(--text-base)',
  });

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
    }}>
      <div
        className="animate-in"
        style={{
          background: 'var(--surface)',
          borderRadius: 12,
          padding: 'var(--space-12)',
          width: '100%',
          maxWidth: 380,
          border: '1px solid var(--line)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          animation: shake ? 'shake 0.4s ease-in-out' : undefined,
        }}
      >
        <img
          src="/logo-lever.svg"
          alt="Copy Anúncios"
          className="lp-logo-img"
          style={{ height: 36, display: 'block', margin: '0 auto var(--space-2)' }}
        />
        <h1 style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 700,
          letterSpacing: 'var(--tracking-tight)',
          color: 'var(--ink)',
          textAlign: 'center',
          marginBottom: 'var(--space-1)',
        }}>
          Copy Anúncios
        </h1>
        <p style={{
          color: 'var(--ink-faint)',
          textAlign: 'center',
          marginBottom: 'var(--space-8)',
          fontSize: 'var(--text-sm)',
        }}>
          Redefinir senha
        </p>

        {success ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{
              color: 'var(--ink-muted)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-6)',
            }}>
              Senha alterada com sucesso
            </p>
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="btn-primary"
              style={{
                padding: 'var(--space-3) var(--space-6)',
                fontSize: 'var(--text-base)',
              }}
            >
              Ir para login
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="Nova senha"
                autoFocus
                autoComplete="new-password"
                className="input-base"
                style={inputStyle(!!error)}
              />

              <input
                type="password"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                placeholder="Confirmar senha"
                autoComplete="new-password"
                className="input-base"
                style={inputStyle(!!error)}
              />

              {error && (
                <p className="animate-in" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !password.trim() || !confirmPassword.trim()}
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: 'var(--space-3) var(--space-6)',
                  fontSize: 'var(--text-base)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                {loading && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--paper)' }} />}
                {loading ? 'Redefinindo...' : 'Redefinir'}
              </button>
            </form>

            <button
              type="button"
              onClick={onNavigateToLogin}
              style={{
                display: 'block',
                margin: 'var(--space-4) auto 0',
                background: 'none',
                border: 'none',
                color: 'var(--ink-faint)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                textDecoration: 'underline',
                opacity: 0.7,
              }}
            >
              Voltar ao login
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        .lp-logo-img { filter: none; }
        @media (prefers-color-scheme: dark) {
          .lp-logo-img { filter: invert(1); }
        }
      `}</style>
    </div>
  );
}
