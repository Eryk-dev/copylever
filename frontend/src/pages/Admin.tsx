import type { Seller } from '../lib/api';
import { Card } from './CopyPage';

interface Props {
  sellers: Seller[];
  loadSellers: () => Promise<void>;
  disconnectSeller: (slug: string) => Promise<void>;
}

export default function Admin({ sellers, loadSellers, disconnectSeller }: Props) {
  const installUrl = `${window.location.origin}/api/ml/install`;

  const handleDisconnect = async (slug: string) => {
    if (!confirm(`Desconectar seller "${slug}"? Os tokens serao removidos.`)) return;
    await disconnectSeller(slug);
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
          }}>
            {installUrl}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(installUrl)}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 6,
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            Copiar
          </button>
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'var(--paper)',
              color: 'var(--ink-muted)',
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 6,
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              border: '1px solid var(--line)',
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
            onClick={() => loadSellers()}
            style={{
              background: 'var(--paper)',
              color: 'var(--ink-muted)',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              border: '1px solid var(--line)',
            }}
          >
            Atualizar
          </button>
        </div>

        {sellers.length === 0 ? (
          <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-sm)' }}>
            Nenhum seller conectado. Use o link acima para autorizar uma conta ML.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {sellers.map(seller => (
              <div
                key={seller.slug}
                style={{
                  background: 'var(--paper)',
                  borderRadius: 6,
                  padding: 'var(--space-3) var(--space-4)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{
                      width: 8, height: 8,
                      borderRadius: '50%',
                      background: seller.token_valid ? 'var(--success)' : 'var(--danger)',
                      display: 'inline-block',
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
                  style={{
                    background: 'transparent',
                    color: 'var(--danger)',
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                    border: '1px solid var(--danger)',
                  }}
                >
                  Desconectar
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
