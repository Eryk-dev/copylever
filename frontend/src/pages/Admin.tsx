import { useState } from 'react';
import type { Seller } from '../lib/api';
import { Card } from './CopyPage';
import { useToast } from '../components/Toast';

interface Props {
  sellers: Seller[];
  loadSellers: () => Promise<void>;
  disconnectSeller: (slug: string) => Promise<void>;
}

export default function Admin({ sellers, loadSellers, disconnectSeller }: Props) {
  const installUrl = `${window.location.origin}/api/ml/install`;
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installUrl);
    toast('Link copiado!');
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSellers();
    setRefreshing(false);
    toast('Lista atualizada');
  };

  const handleDisconnect = async (slug: string) => {
    if (!confirm(`Desconectar seller "${slug}"? Os tokens serao removidos.`)) return;
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
          Abra o link abaixo para autorizar uma conta do Mercado Livre:
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <code style={{
            flex: 1,
            background: 'var(--paper)',
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 6,
            border: '1px solid var(--line)',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--positive)',
            wordBreak: 'break-all',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {installUrl}
          </code>
          <button
            onClick={handleCopy}
            className="btn-primary"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--text-xs)',
              whiteSpace: 'nowrap',
            }}
          >
            Copiar
          </button>
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--text-xs)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Abrir
          </a>
        </div>
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
            Use o link acima para autorizar uma conta ML.
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
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{
                      width: 8, height: 8,
                      borderRadius: '50%',
                      background: seller.token_valid ? 'var(--success)' : 'var(--danger)',
                      display: 'inline-block',
                      flexShrink: 0,
                    }} />
                    <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
                      {seller.name || seller.slug}
                    </span>
                    <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>
                      ({seller.slug})
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 'var(--space-1)' }}>
                    ML User ID: {seller.ml_user_id}
                    {seller.token_expires_at && (
                      <> | Token expira: {new Date(seller.token_expires_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>
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
