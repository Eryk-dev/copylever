import { useState } from 'react';
import { API_BASE } from '../lib/api';

interface Props {
  onLogin: (username: string, password: string) => Promise<boolean>;
}

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError('');

    // Admin-promote flow
    if (showAdmin && masterPassword.trim()) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/admin-promote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            password,
            master_password: masterPassword,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.detail || 'Erro ao promover admin');
          triggerShake();
          setLoading(false);
          return;
        }
        // Admin created/promoted — now auto-login
        const success = await onLogin(username.trim(), password);
        if (!success) {
          setError('Admin criado, mas falha ao fazer login');
          triggerShake();
        }
      } catch {
        setError('Erro de conexão');
        triggerShake();
      }
      setLoading(false);
      return;
    }

    // Normal login flow
    const success = await onLogin(username.trim(), password);
    if (!success) {
      setError('Credenciais inválidas');
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
          animation: shake ? 'shake 0.4s ease-in-out' : undefined,
        }}
      >
        <h1 style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 700,
          letterSpacing: 'var(--tracking-tight)',
          color: 'var(--ink)',
          textAlign: 'center',
          marginBottom: 'var(--space-1)',
        }}>
          Copy Anuncios
        </h1>
        <p style={{
          color: 'var(--ink-faint)',
          textAlign: 'center',
          marginBottom: 'var(--space-8)',
          fontSize: 'var(--text-sm)',
        }}>
          Acesse com seu usuário e senha
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(''); }}
            placeholder="Usuário"
            autoFocus
            autoComplete="username"
            className="input-base"
            style={inputStyle(!!error)}
          />

          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            placeholder="Senha"
            autoComplete="current-password"
            className="input-base"
            style={inputStyle(!!error)}
          />

          {showAdmin && (
            <input
              type="password"
              value={masterPassword}
              onChange={e => { setMasterPassword(e.target.value); setError(''); }}
              placeholder="Senha Master"
              className="input-base animate-in"
              style={inputStyle(!!error)}
            />
          )}

          {error && (
            <p className="animate-in" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim()}
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
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => { setShowAdmin(!showAdmin); setMasterPassword(''); setError(''); }}
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
          {showAdmin ? 'Voltar ao login normal' : 'Acesso Admin'}
        </button>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
