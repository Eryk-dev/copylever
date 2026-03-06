import { useState, useMemo } from 'react';
import type { Seller, ShopeeSeller } from '../lib/api';
import { API_BASE } from '../lib/api';
import { Card } from './CopyPage';
import { useToast } from '../components/Toast';

interface Props {
  sellers: Seller[];
  loadSellers: () => Promise<void>;
  disconnectSeller: (slug: string) => Promise<void>;
  headers: () => Record<string, string>;
  shopeeSellers: ShopeeSeller[];
  loadShopeeSellers: () => Promise<void>;
  disconnectShopeeSeller: (slug: string) => Promise<void>;
}

/* ── Brand marks for buttons ── */

function MlMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <rect width="22" height="22" rx="5" fill="#FFE600" />
      <text x="11" y="15" textAnchor="middle" fill="#2D3277" fontSize="10" fontWeight="800"
        fontFamily="Inter, -apple-system, sans-serif">ML</text>
    </svg>
  );
}

function ShopeeMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <rect width="22" height="22" rx="5" fill="#EE4D2D" />
      <text x="11" y="15.5" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="800"
        fontFamily="Inter, -apple-system, sans-serif">S</text>
    </svg>
  );
}

/* ── Platform tag pill ── */

function PlatformTag({ platform }: { platform: 'ml' | 'shopee' }) {
  const isML = platform === 'ml';
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 8px',
      borderRadius: 100,
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      background: isML ? 'rgba(255, 230, 0, 0.10)' : 'rgba(238, 77, 45, 0.08)',
      color: isML ? '#C49A00' : '#EE4D2D',
      border: `1px solid ${isML ? 'rgba(255, 230, 0, 0.35)' : 'rgba(238, 77, 45, 0.25)'}`,
      lineHeight: '18px',
      flexShrink: 0,
      whiteSpace: 'nowrap',
    }}>
      {isML ? 'Mercado Livre' : 'Shopee'}
    </span>
  );
}

/* ── Unified account type ── */

type ConnectedAccount = {
  platform: 'ml' | 'shopee';
  slug: string;
  name: string;
  token_valid: boolean;
  created_at: string;
};

export default function Admin({ sellers, loadSellers, disconnectSeller, headers, shopeeSellers, loadShopeeSellers, disconnectShopeeSeller }: Props) {
  const { toast } = useToast();
  const [installing, setInstalling] = useState<'ml' | 'shopee' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ slug: string; platform: 'ml' | 'shopee' } | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleInstall = async (platform: 'ml' | 'shopee') => {
    setInstalling(platform);
    try {
      const url = platform === 'ml'
        ? `${API_BASE}/api/ml/install`
        : `${API_BASE}/api/shopee/install`;
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) {
        toast(res.status === 401
          ? 'Sessão expirada. Faça login novamente.'
          : 'Erro ao iniciar autorização.');
        return;
      }
      const data = await res.json();
      if (data.redirect_url) window.location.href = data.redirect_url;
    } catch {
      toast('Erro de conexão.');
    } finally {
      setInstalling(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadSellers(), loadShopeeSellers()]);
    setRefreshing(false);
    toast('Lista atualizada');
  };

  const handleRename = async () => {
    if (!editing) return;
    const trimmed = editName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const url = editing.platform === 'ml'
        ? `${API_BASE}/api/sellers/${editing.slug}/name`
        : `${API_BASE}/api/shopee/sellers/${editing.slug}/name`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast(err?.detail || 'Erro ao renomear');
        return;
      }
      if (editing.platform === 'ml') await loadSellers();
      else await loadShopeeSellers();
      setEditing(null);
      toast('Nome atualizado');
    } catch {
      toast('Erro de conexão');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (slug: string, platform: 'ml' | 'shopee') => {
    const label = platform === 'ml' ? 'seller' : 'loja Shopee';
    if (!confirm(`Desconectar ${label} "${slug}"? Os tokens serão removidos.`)) return;
    setDisconnecting(slug);
    if (platform === 'ml') await disconnectSeller(slug);
    else await disconnectShopeeSeller(slug);
    setDisconnecting(null);
    toast(`${platform === 'ml' ? 'Seller desconectado' : 'Loja Shopee desconectada'}`);
  };

  const allAccounts = useMemo<ConnectedAccount[]>(() => {
    const ml: ConnectedAccount[] = sellers.map(s => ({
      platform: 'ml', slug: s.slug, name: s.name, token_valid: s.token_valid, created_at: s.created_at,
    }));
    const shopee: ConnectedAccount[] = shopeeSellers.map(s => ({
      platform: 'shopee', slug: s.slug, name: s.name, token_valid: s.token_valid, created_at: s.created_at,
    }));
    return [...ml, ...shopee];
  }, [sellers, shopeeSellers]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

      {/* ── Connect buttons ── */}
      <Card title="Conectar conta">
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleInstall('ml')}
            disabled={installing !== null}
            className="btn-ghost"
            style={{
              padding: 'var(--space-3) var(--space-5)',
              fontSize: 'var(--text-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              borderRadius: 8,
            }}
          >
            {installing === 'ml' && <span className="spinner spinner-sm" />}
            {installing !== 'ml' && <MlMark />}
            {installing === 'ml' ? 'Redirecionando...' : 'Conectar conta'}
          </button>

          <button
            onClick={() => handleInstall('shopee')}
            disabled={installing !== null}
            className="btn-ghost"
            style={{
              padding: 'var(--space-3) var(--space-5)',
              fontSize: 'var(--text-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              borderRadius: 8,
            }}
          >
            {installing === 'shopee' && <span className="spinner spinner-sm" />}
            {installing !== 'shopee' && <ShopeeMark />}
            {installing === 'shopee' ? 'Redirecionando...' : 'Conectar conta'}
          </button>
        </div>
      </Card>

      {/* ── Unified accounts list ── */}
      <Card
        title={`Contas conectadas (${allAccounts.length})`}
        action={
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-ghost"
            style={{
              padding: '6px 12px',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {refreshing && <span className="spinner spinner-sm" />}
            {refreshing ? 'Atualizando...' : 'Atualizar'}
          </button>
        }
      >
        {allAccounts.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: 'var(--space-8) var(--space-4)',
            color: 'var(--ink-faint)',
            fontSize: 'var(--text-sm)',
          }}>
            Nenhuma conta conectada.<br />
            Use os botões acima para autorizar.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {allAccounts.map(account => (
              <div
                key={`${account.platform}-${account.slug}`}
                className="animate-in"
                style={{
                  background: 'var(--paper)',
                  borderRadius: 6,
                  padding: 'var(--space-3) var(--space-4)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  transition: 'border-color 0.15s',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <span style={{
                      width: 8, height: 8,
                      borderRadius: '50%',
                      background: account.token_valid ? 'var(--success)' : 'var(--danger)',
                      display: 'inline-block',
                      flexShrink: 0,
                    }} />
                    <PlatformTag platform={account.platform} />
                    {editing?.slug === account.slug && editing?.platform === account.platform ? (
                      <form
                        onSubmit={e => { e.preventDefault(); handleRename(); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1 }}
                      >
                        <input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          autoFocus
                          maxLength={100}
                          style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--line-hover)',
                            borderRadius: 4,
                            padding: '4px 8px',
                            color: 'var(--ink)',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 600,
                            flex: 1,
                            minWidth: 0,
                          }}
                          onKeyDown={e => { if (e.key === 'Escape') setEditing(null); }}
                        />
                        <button
                          type="submit"
                          disabled={saving || !editName.trim()}
                          className="btn-primary"
                          style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
                        >
                          {saving ? 'Salvando...' : 'Salvar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
                        >
                          Cancelar
                        </button>
                      </form>
                    ) : (
                      <>
                        <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
                          {account.name || account.slug}
                        </span>
                        <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>
                          ({account.slug})
                        </span>
                        <button
                          onClick={() => { setEditing({ slug: account.slug, platform: account.platform }); setEditName(account.name || account.slug); }}
                          className="btn-ghost"
                          title="Renomear"
                          style={{
                            padding: '2px 6px',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--ink-faint)',
                            lineHeight: 1,
                          }}
                        >
                          &#9998;
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDisconnect(account.slug, account.platform)}
                  disabled={disconnecting === account.slug}
                  className="btn-danger-ghost"
                  style={{
                    padding: '6px 12px',
                    fontSize: 'var(--text-xs)',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    opacity: disconnecting === account.slug ? 0.5 : 1,
                  }}
                >
                  {disconnecting === account.slug && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--danger)' }} />}
                  {disconnecting === account.slug ? 'Removendo...' : 'Desconectar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
