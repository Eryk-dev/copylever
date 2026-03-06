import { useState, useEffect, useCallback } from 'react';
import { API_BASE, type OrgWithStats } from '../lib/api';
import { Card } from './CopyPage';

interface Props {
  headers: () => Record<string, string>;
}

export default function SuperAdminPage({ headers }: Props) {
  const [orgs, setOrgs] = useState<OrgWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/super/orgs`, { headers: headers(), cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro ao carregar organizações' }));
        setError(err.detail);
        return;
      }
      setOrgs(await res.json());
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const toggleActive = useCallback(async (orgId: string, currentActive: boolean) => {
    setToggling(orgId);
    try {
      const res = await fetch(`${API_BASE}/api/super/orgs/${orgId}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ active: !currentActive }),
      });
      if (res.ok) {
        setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, active: !currentActive } : o));
      }
    } catch (e) {
      console.error('Toggle failed:', e);
    } finally {
      setToggling(null);
    }
  }, [headers]);

  if (loading) {
    return (
      <Card title="Organizações">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--ink-faint)', fontSize: 'var(--text-sm)' }}>
          <span className="spinner spinner-sm" />
          Carregando...
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Organizações">
        <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</p>
      </Card>
    );
  }

  return (
    <Card title={`Organizações (${orgs.length})`}>
      {orgs.length === 0 ? (
        <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-sm)', textAlign: 'center', padding: 'var(--space-4)' }}>
          Nenhuma organização cadastrada.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr>
                {['Empresa', 'Email', 'Status', 'Pagamento', 'Usuários', 'Sellers', 'Cópias (30d)', 'Compats (30d)', 'Shopee Sellers', 'Shopee Cópias (30d)', 'Criado em', ''].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => (
                <tr key={org.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={tdStyle}>{org.name}</td>
                  <td style={{ ...tdStyle, fontSize: 'var(--text-xs)' }}>{org.email}</td>
                  <td style={tdStyle}><StatusBadge active={org.active} label={org.active ? 'Ativo' : 'Inativo'} /></td>
                  <td style={tdStyle}><StatusBadge active={org.payment_active} label={org.payment_active ? 'Ativo' : 'Inativo'} /></td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{org.user_count}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{org.seller_count}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{org.copy_count}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{org.compat_count}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{org.shopee_seller_count ?? 0}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{org.shopee_copy_count ?? 0}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>
                    {new Date(org.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => toggleActive(org.id, org.active)}
                      disabled={toggling === org.id}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 4,
                        fontSize: 'var(--text-xs)',
                        fontWeight: 600,
                        background: org.active ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                        color: org.active ? 'var(--danger)' : 'var(--success)',
                        border: `1px solid ${org.active ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                        cursor: toggling === org.id ? 'wait' : 'pointer',
                        opacity: toggling === org.id ? 0.5 : 1,
                      }}
                    >
                      {org.active ? 'Desativar' : 'Ativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span style={{
      color: active ? 'var(--success)' : 'var(--danger)',
      fontWeight: 600,
      fontSize: 'var(--text-xs)',
      textTransform: 'uppercase',
      background: active ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
      padding: '2px 8px',
      borderRadius: 4,
    }}>
      {label}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--ink-faint)',
  fontWeight: 500,
  fontSize: 'var(--text-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--line)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--ink)',
};
