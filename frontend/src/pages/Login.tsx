import { useState } from 'react';

interface Props {
  onLogin: (password: string) => Promise<boolean>;
}

export default function Login({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    const success = await onLogin(password);
    if (!success) {
      setError('Senha incorreta');
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
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
          Acesse com sua senha
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            placeholder="Senha"
            autoFocus
            className="input-base"
            style={{
              width: '100%',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--paper)',
              border: `1px solid ${error ? 'var(--danger)' : 'var(--line)'}`,
              borderRadius: 6,
              color: 'var(--ink)',
              fontSize: 'var(--text-base)',
            }}
          />

          {error && (
            <p className="animate-in" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
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
