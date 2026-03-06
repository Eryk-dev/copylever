import { useState } from 'react';
import type { Seller } from '../lib/api';
import { API_BASE } from '../lib/api';
import { Card } from './CopyPage';
import { useToast } from '../components/Toast';

interface Props {
  sellers: Seller[];
  loadSellers: () => Promise<void>;
  disconnectSeller: (slug: string) => Promise<void>;
  headers: () => Record<string, string>;
}

export default function Admin({ sellers, loadSellers, disconnectSeller, headers }: Props) {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleRename = async (slug: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/sellers/${slug}/name`, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast(err?.detail || 'Erro ao renomear seller');
        return;
      }
      await loadSellers();
      setEditingSlug(null);
      toast('Nome atualizado');
    } catch {
      toast('Erro de conexão');
    } finally {
      setSaving(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const res = await fetch(`${API_BASE}/api/ml/install`, { headers: headers() });
      if (!res.ok) {
        if (res.status === 401) {
          toast('Erro: sessão expirada. Faça login novamente.');
        } else {
          toast('Erro ao iniciar autorização ML.');
        }
        return;
      }
      const data = await res.json();
      if (data.redirect_url) {
        window.location.href = data.redirect_url;
      }
    } catch {
      toast('Erro de conexão ao iniciar autorização.');
    } finally {
      setInstalling(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSellers();
    setRefreshing(false);
    toast('Lista atualizada');
  };

  const handleDisconnect = async (slug: string) => {
    if (!confirm(`Desconectar seller "${slug}"? Os tokens serão removidos.`)) return;
    setDisconnecting(slug);
    await disconnectSeller(slug);
    setDisconnecting(null);
    toast('Seller desconectado');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Install Link */}
      <Card title="Conectar nova conta ML">
        <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>
          Clique no botão abaixo para autorizar uma conta do Mercado Livre:
        </p>
        <button
          onClick={handleInstall}
          disabled={installing}
          className="btn-primary"
          style={{
            padding: 'var(--space-3) var(--space-5)',
            fontSize: 'var(--text-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          {installing && <span className="spinner spinner-sm" />}
          {installing ? 'Redirecionando...' : 'Autorizar conta ML'}
        </button>
      </Card>

      {/* Sellers List */}
      <Card title={`Sellers conectados (${sellers.length})`}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
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
        </div>

        {sellers.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: 'var(--space-8) var(--space-4)',
            color: 'var(--ink-faint)',
            fontSize: 'var(--text-sm)',
          }}>
            <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)', opacity: 0.4 }}>
              {'\u2194'}
            </div>
            Nenhum seller conectado.<br />
            Use o botão acima para autorizar uma conta ML.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {sellers.map(seller => (
              <div
                key={seller.slug}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{
                      width: 8, height: 8,
                      borderRadius: '50%',
                      background: seller.token_valid ? 'var(--success)' : 'var(--danger)',
                      display: 'inline-block',
                      flexShrink: 0,
                    }} />
                    {editingSlug === seller.slug ? (
                      <form
                        onSubmit={e => { e.preventDefault(); handleRename(seller.slug); }}
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
                          onKeyDown={e => { if (e.key === 'Escape') setEditingSlug(null); }}
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
                          onClick={() => setEditingSlug(null)}
                          className="btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
                        >
                          Cancelar
                        </button>
                      </form>
                    ) : (
                      <>
                        <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
                          {seller.name || seller.slug}
                        </span>
                        <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>
                          ({seller.slug})
                        </span>
                        <button
                          onClick={() => { setEditingSlug(seller.slug); setEditName(seller.name || seller.slug); }}
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
                  onClick={() => handleDisconnect(seller.slug)}
                  disabled={disconnecting === seller.slug}
                  className="btn-danger-ghost"
                  style={{
                    padding: '6px 12px',
                    fontSize: 'var(--text-xs)',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    opacity: disconnecting === seller.slug ? 0.5 : 1,
                  }}
                >
                  {disconnecting === seller.slug && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--danger)' }} />}
                  {disconnecting === seller.slug ? 'Removendo...' : 'Desconectar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
