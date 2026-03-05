import { useState, useEffect } from 'react';
import { API_BASE } from '../lib/api';
import { Card } from './CopyPage';

interface Props {
  headers: () => Record<string, string>;
}

interface BillingStatus {
  payment_active: boolean;
  stripe_subscription_id: string | null;
}

export default function BillingPage({ headers }: Props) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [billingAvailable, setBillingAvailable] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/status`, { headers: headers() });
      if (res.status === 503) {
        setBillingAvailable(false);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError('Erro ao carregar status de pagamento');
        setLoading(false);
        return;
      }
      const data: BillingStatus = await res.json();
      setStatus(data);
    } catch {
      setError('Erro de conexao');
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    setActionLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/billing/create-checkout`, {
        method: 'POST',
        headers: headers(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.detail || 'Erro ao criar sessao de checkout');
        return;
      }
      const data = await res.json();
      window.location.href = data.checkout_url;
    } catch {
      setError('Erro de conexao');
    } finally {
      setActionLoading(false);
    }
  };

  const handleManage = async () => {
    setActionLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/billing/create-portal`, {
        method: 'POST',
        headers: headers(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.detail || 'Erro ao abrir portal de assinatura');
        return;
      }
      const data = await res.json();
      window.location.href = data.portal_url;
    } catch {
      setError('Erro de conexao');
    } finally {
      setActionLoading(false);
    }
  };

  if (!billingAvailable) return null;

  if (loading) {
    return (
      <Card title="Assinatura">
        <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--ink-faint)' }}>
          <span className="spinner spinner-sm" /> Carregando...
        </div>
      </Card>
    );
  }

  return (
    <Card title="Assinatura">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            background: status?.payment_active ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            color: status?.payment_active ? 'var(--success)' : 'var(--danger)',
          }}>
            {status?.payment_active ? 'Ativo' : 'Inativo'}
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
            {status?.payment_active
              ? 'Sua assinatura esta ativa.'
              : 'Nenhuma assinatura ativa.'}
          </span>
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</p>
        )}

        {status?.payment_active ? (
          <button
            onClick={handleManage}
            disabled={actionLoading}
            className="btn-ghost"
            style={{
              alignSelf: 'flex-start',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {actionLoading && <span className="spinner spinner-sm" />}
            {actionLoading ? 'Abrindo...' : 'Gerenciar Assinatura'}
          </button>
        ) : (
          <>
          <p style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--ink-muted)',
            fontWeight: 600,
          }}>
            Plano mensal — R$ 349,90/mês
          </p>
          <button
            onClick={handleSubscribe}
            disabled={actionLoading}
            className="btn-primary"
            style={{
              alignSelf: 'flex-start',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {actionLoading && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--paper)' }} />}
            {actionLoading ? 'Redirecionando...' : 'Assinar'}
          </button>
          </>
        )}
      </div>
    </Card>
  );
}
