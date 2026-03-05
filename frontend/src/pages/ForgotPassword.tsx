import { useState } from 'react';
import { API_BASE } from '../lib/api';

interface Props {
  onNavigateToLogin: () => void;
}

export default function ForgotPassword({ onNavigateToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        setError('Erro ao processar solicitacao. Tente novamente.');
        setLoading(false);
        return;
      }
      setSent(true);
    } catch {
      setError('Erro de conexao');
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
          Recuperar senha
        </p>

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{
              color: 'var(--ink-muted)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-6)',
            }}>
              Se o email existir, enviaremos instrucoes de redefinicao.
            </p>
            <button
              type="button"
              onClick={onNavigateToLogin}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              Voltar ao login
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(''); }}
                placeholder="Email"
                autoFocus
                autoComplete="email"
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
                disabled={loading || !email.trim()}
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
                {loading ? 'Enviando...' : 'Enviar link'}
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
    </div>
  );
}
