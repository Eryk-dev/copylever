import { useState } from 'react';
import type { Seller } from '../lib/api';
import SellerSelect from './SellerSelect';

interface Props {
  sellers: Seller[];
  onCopy: (source: string, destinations: string[], itemIds: string[]) => Promise<void>;
  onPreview: (itemId: string, seller: string) => Promise<void>;
  copying: boolean;
}

export default function CopyForm({ sellers, onCopy, onPreview, copying }: Props) {
  const [source, setSource] = useState('');
  const [destinations, setDestinations] = useState<string[]>([]);
  const [itemIdsText, setItemIdsText] = useState('');

  const validSellers = sellers.filter(s => s.token_valid);
  const availableDestinations = validSellers.filter(s => s.slug !== source);

  const itemIds = itemIdsText.split(/[\n,]+/).map(id => id.trim()).filter(id => id.length > 0);
  const canCopy = source && destinations.length > 0 && itemIds.length > 0 && !copying;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCopy) return;
    await onCopy(source, destinations, itemIds);
  };

  const toggleDest = (slug: string) => {
    setDestinations(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]);
  };

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--surface)',
      borderRadius: 8,
      padding: 'var(--space-5)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-5)',
    }}>
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, letterSpacing: 'var(--tracking-tight)' }}>
        Copiar Anuncios
      </h3>

      {/* Source */}
      <Field label="Seller de Origem">
        <SellerSelect
          sellers={validSellers}
          value={source}
          onChange={val => { setSource(val); setDestinations(prev => prev.filter(d => d !== val)); }}
          placeholder="Selecione o seller de origem"
        />
      </Field>

      {/* Destinations */}
      <Field
        label="Sellers de Destino"
        action={availableDestinations.length > 0 && source ? (
          <button
            type="button"
            onClick={() => setDestinations(availableDestinations.map(s => s.slug))}
            style={{ background: 'none', color: 'var(--positive)', fontSize: 'var(--text-xs)', fontWeight: 500, padding: 0 }}
          >
            Selecionar todos
          </button>
        ) : undefined}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {source ? (
            availableDestinations.length > 0 ? (
              availableDestinations.map(seller => {
                const on = destinations.includes(seller.slug);
                return (
                  <button key={seller.slug} type="button" onClick={() => toggleDest(seller.slug)} style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 'var(--text-xs)',
                    fontWeight: on ? 600 : 400,
                    background: on ? 'var(--ink)' : 'var(--paper)',
                    color: on ? 'var(--paper)' : 'var(--ink-muted)',
                    border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`,
                    transition: 'all 0.15s',
                  }}>
                    {seller.name || seller.slug}
                  </button>
                );
              })
            ) : (
              <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>Nenhum outro seller disponivel</p>
            )
          ) : (
            <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>Selecione a origem primeiro</p>
          )}
        </div>
      </Field>

      {/* Item IDs */}
      <Field label="IDs dos Anuncios (MLB...)">
        <textarea
          value={itemIdsText}
          onChange={e => setItemIdsText(e.target.value)}
          placeholder={"MLB1234567890\nMLB9876543210"}
          rows={4}
          style={{
            width: '100%',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--paper)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            color: 'var(--ink)',
            resize: 'vertical',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)',
            outline: 'none',
            lineHeight: 'var(--leading-normal)',
          }}
        />
        {itemIds.length > 0 && (
          <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
            {itemIds.length} anuncio(s)
          </p>
        )}
      </Field>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" disabled={!canCopy} style={{
          flex: 1,
          padding: 'var(--space-3) var(--space-6)',
          background: 'var(--ink)',
          color: 'var(--paper)',
          borderRadius: 6,
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          opacity: canCopy ? 1 : 0.3,
          transition: 'opacity 0.15s',
        }}>
          {copying ? 'Copiando...' : `Copiar${itemIds.length > 0 ? ` (${itemIds.length} x ${destinations.length || 0})` : ''}`}
        </button>

        {itemIds.length > 0 && source && (
          <button type="button" onClick={() => onPreview(itemIds[0], source)} style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--paper)',
            color: 'var(--ink-muted)',
            borderRadius: 6,
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            border: '1px solid var(--line)',
          }}>
            Preview
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <label style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}
