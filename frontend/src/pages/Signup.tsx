import { useState } from 'react';

interface Props {
  onSignup: (email: string, password: string, companyName: string) => Promise<{success: boolean, error?: string}>;
  onNavigateToLogin: () => void;
}

export default function Signup({ onSignup, onNavigateToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !companyName.trim()) return;
    if (password.length < 6) {
      setError('Senha deve ter pelo menos 6 caracteres');
      triggerShake();
      return;
    }
    setLoading(true);
    setError('');

    const result = await onSignup(email.trim(), password, companyName.trim());
    if (!result.success) {
      setError(result.error || 'Erro ao criar conta');
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
          marginBottom: 'var(--space-2)',
          fontSize: 'var(--text-sm)',
        }}>
          Comece grátis com 20 cópias
        </p>
        <p style={{
          color: 'var(--ink-muted)',
          textAlign: 'center',
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--text-xs)',
        }}>
          Copie anúncios entre contas do Mercado Livre
        </p>
        <div style={{
          marginBottom: 'var(--space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>&#10003; 20 cópias grátis para testar</p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>&#10003; Múltiplas contas do Mercado Livre</p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>&#10003; Compatibilidades veiculares</p>
        </div>

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

          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            placeholder="Senha"
            autoComplete="new-password"
            className="input-base"
            style={inputStyle(!!error)}
          />

          <input
            type="text"
            value={companyName}
            onChange={e => { setCompanyName(e.target.value); setError(''); }}
            placeholder="Nome da Empresa"
            autoComplete="organization"
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
            disabled={loading || !email.trim() || !password.trim() || !companyName.trim()}
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
            {loading ? 'Criando...' : 'Começar grátis'}
          </button>
        </form>

        <p style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--ink-faint)',
          textAlign: 'center',
          marginTop: 'var(--space-4)',
        }}>
          20 cópias grátis — sem cartão de crédito
        </p>

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
          Já tem conta? Entrar
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
        .lp-logo-img { filter: none; }
        @media (prefers-color-scheme: dark) {
          .lp-logo-img { filter: invert(1); }
        }
      `}</style>
    </div>
  );
}
