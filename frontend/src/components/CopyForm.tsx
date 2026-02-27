import { useState } from 'react';
import type { Seller } from '../lib/api';
import SellerSelect from './SellerSelect';

interface Props {
  sourceSellers: Seller[];
  destSellers: Seller[];
  onCopy: (source: string, destinations: string[], itemIds: string[]) => Promise<void>;
  onPreview: (itemId: string, seller: string) => Promise<void>;
  copying: boolean;
}

export default function CopyForm({ sourceSellers, destSellers, onCopy, onPreview, copying }: Props) {
  const [source, setSource] = useState('');
  const [destinations, setDestinations] = useState<string[]>([]);
  const [itemIdsText, setItemIdsText] = useState('');
  const [confirming, setConfirming] = useState(false);

  const validSources = sourceSellers.filter(s => s.token_valid);
  const validDests = destSellers.filter(s => s.token_valid);
  const availableDestinations = validDests.filter(s => s.slug !== source);

  const itemIds = itemIdsText.split(/[\n,]+/).map(id => id.trim()).filter(id => id.length > 0);
  const canCopy = source && destinations.length > 0 && itemIds.length > 0 && !copying;
  const totalOps = itemIds.length * destinations.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCopy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    await onCopy(source, destinations, itemIds);
  };

  const toggleDest = (slug: string) => {
    setDestinations(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]);
    setConfirming(false);
  };

  const selectAllDests = () => {
    const allSlugs = availableDestinations.map(s => s.slug);
    const allSelected = allSlugs.every(s => destinations.includes(s));
    setDestinations(allSelected ? [] : allSlugs);
    setConfirming(false);
  };

  // Step completion
  const step1Done = !!source;
  const step2Done = destinations.length > 0;
  const step3Done = itemIds.length > 0;

  return (
    <form onSubmit={handleSubmit} className="card" style={{
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

      {/* Step 1: Source */}
      <Field label="Seller de Origem" step={1} done={step1Done}>
        <SellerSelect
          sellers={validSources}
          value={source}
          onChange={val => { setSource(val); setDestinations(prev => prev.filter(d => d !== val)); setConfirming(false); }}
          placeholder="Selecione o seller de origem"
        />
      </Field>

      {/* Step 2: Destinations */}
      <Field
        label="Sellers de Destino"
        step={2}
        done={step2Done}
        action={availableDestinations.length > 0 && source ? (
          <button
            type="button"
            onClick={selectAllDests}
            style={{ background: 'none', color: 'var(--positive)', fontSize: 'var(--text-xs)', fontWeight: 500, padding: 0 }}
          >
            {availableDestinations.every(s => destinations.includes(s.slug)) ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>
        ) : undefined}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {source ? (
            availableDestinations.length > 0 ? (
              availableDestinations.map(seller => {
                const on = destinations.includes(seller.slug);
                return (
                  <button key={seller.slug} type="button" onClick={() => toggleDest(seller.slug)} className="chip-toggle" style={{
                    padding: '6px 12px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: on ? 600 : 400,
                    background: on ? 'var(--ink)' : 'var(--paper)',
                    color: on ? 'var(--paper)' : 'var(--ink-muted)',
                    border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    {on && <span style={{ fontSize: 10 }}>{'\u2713'}</span>}
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

      {/* Step 3: Item IDs */}
      <Field label="IDs dos Anuncios (MLB...)" step={3} done={step3Done}>
        <textarea
          value={itemIdsText}
          onChange={e => { setItemIdsText(e.target.value); setConfirming(false); }}
          placeholder={"MLB1234567890\nMLB9876543210"}
          rows={4}
          className="input-base"
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
            lineHeight: 'var(--leading-normal)',
          }}
        />
        {itemIds.length > 0 && (
          <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
            {itemIds.length} anuncio(s) {destinations.length > 0 && <>x {destinations.length} destino(s) = <b style={{ color: 'var(--ink)' }}>{totalOps} copia(s)</b></>}
          </p>
        )}
      </Field>

      {/* Confirmation bar */}
      {confirming && (
        <div className="confirm-bar">
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', flex: 1 }}>
            Confirma copiar <b>{totalOps}</b> anuncio(s)?
          </span>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="btn-ghost"
            style={{ padding: '6px 12px', fontSize: 'var(--text-xs)' }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary"
            style={{ padding: '6px 16px', fontSize: 'var(--text-xs)' }}
          >
            Confirmar
          </button>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" disabled={!canCopy} className="btn-primary" style={{
          flex: 1,
          padding: 'var(--space-3) var(--space-6)',
          fontSize: 'var(--text-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
        }}>
          {copying && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--paper)' }} />}
          {copying ? 'Copiando...' : confirming ? 'Confirmar' : `Copiar${itemIds.length > 0 ? ` (${totalOps})` : ''}`}
        </button>

        {itemIds.length > 0 && source && (
          <button type="button" onClick={() => onPreview(itemIds[0], source)} className="btn-ghost" style={{
            padding: 'var(--space-3) var(--space-4)',
            fontSize: 'var(--text-xs)',
          }}>
            Preview
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, step, done, action, children }: {
  label: string;
  step?: number;
  done?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <label style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 500,
          color: 'var(--ink-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}>
          {step !== undefined && (
            <span style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              background: done ? 'var(--ink)' : 'var(--line)',
              color: done ? 'var(--paper)' : 'var(--ink-faint)',
              transition: 'background 0.2s, color 0.2s',
              flexShrink: 0,
            }}>
              {done ? '\u2713' : step}
            </span>
          )}
          {label}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}
