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
      setError('Erro de conexão');
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
        setError(data?.detail || 'Erro ao criar sessão de checkout');
        return;
      }
      const data = await res.json();
      window.location.href = data.checkout_url;
    } catch {
      setError('Erro de conexão');
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
      setError('Erro de conexão');
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {/* Status row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4)',
          background: status?.payment_active ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
          borderRadius: 10,
          border: `1px solid ${status?.payment_active ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: status?.payment_active ? 'var(--success)' : 'var(--danger)',
              flexShrink: 0,
            }} />
            <div>
              <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>
                {status?.payment_active ? 'Assinatura ativa' : 'Sem assinatura'}
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
                Plano mensal — R$ 349,90/mês
              </p>
            </div>
          </div>
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
            {actionLoading ? 'Abrindo...' : 'Gerenciar assinatura'}
          </button>
        ) : (
          <button
            onClick={handleSubscribe}
            disabled={actionLoading}
            className="btn-primary"
            style={{
              alignSelf: 'flex-start',
              padding: '12px 24px',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {actionLoading && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--paper)' }} />}
            {actionLoading ? 'Redirecionando...' : 'Ativar assinatura'}
          </button>
        )}
      </div>
    </Card>
  );
}
