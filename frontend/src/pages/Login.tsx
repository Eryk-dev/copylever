import { useState } from 'react';

interface Props {
  onLogin: (password: string) => Promise<boolean>;
}

export default function Login({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    const success = await onLogin(password);
    if (!success) setError('Senha incorreta');
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
    }}>
      <div style={{
        background: 'var(--surface)',
        borderRadius: 12,
        padding: 'var(--space-12)',
        width: '100%',
        maxWidth: 380,
      }}>
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
          Acesse com sua senha
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Senha"
            autoFocus
            style={{
              width: '100%',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--paper)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              color: 'var(--ink)',
              fontSize: 'var(--text-base)',
              outline: 'none',
            }}
          />

          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            style={{
              width: '100%',
              padding: 'var(--space-3) var(--space-6)',
              background: 'var(--ink)',
              color: 'var(--paper)',
              borderRadius: 6,
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              opacity: (loading || !password.trim()) ? 0.4 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
