import { useState } from 'react';

export interface Dimensions {
  height?: number;
  width?: number;
  length?: number;
  weight?: number;
}

interface DimensionFormProps {
  sku?: string;
  itemIds: string[];
  destinations: string[];
  onSubmit: (dims: Dimensions) => void;
}

export default function DimensionForm({ sku, itemIds, destinations, onSubmit }: DimensionFormProps) {
  const ids = itemIds;
  const [height, setHeight] = useState('');
  const [width, setWidth] = useState('');
  const [length, setLength] = useState('');
  const [weight, setWeight] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const dims: Dimensions = {};
    if (height) dims.height = parseFloat(height);
    if (width) dims.width = parseFloat(width);
    if (length) dims.length = parseFloat(length);
    if (weight) dims.weight = parseFloat(weight);

    if (!Object.keys(dims).length) return;

    setSubmitting(true);
    try {
      await onSubmit(dims);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    fontSize: 'var(--text-sm)',
    fontVariantNumeric: 'tabular-nums',
  };

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    minWidth: 80,
    fontSize: 'var(--text-xs)',
    color: 'var(--ink-faint)',
    fontWeight: 500,
  };

  return (
    <div style={{
      marginBottom: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'rgba(245, 158, 11, 0.06)',
      border: '1px solid rgba(245, 158, 11, 0.2)',
      borderRadius: 6,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-2)',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        color: 'var(--warning)',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--warning)', flexShrink: 0,
        }} />
        Dimensões necessárias
      </div>
      <p style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--ink-muted)',
        marginBottom: 'var(--space-3)',
        lineHeight: 'var(--leading-normal)',
      }}>
        {sku && (
          <>
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>SKU: {sku}</span>
            {' — '}
          </>
        )}
        {ids.length === 1 ? (
          <span style={{ fontFamily: 'var(--font-mono)' }}>{ids[0]}</span>
        ) : (
          <span>{ids.length} anúncio(s): <span style={{ fontFamily: 'var(--font-mono)' }}>{ids.join(', ')}</span></span>
        )}
        {' '}&rarr; {destinations.join(', ')}
        <br />
        Informe as dimensões da embalagem para atualizar {ids.length > 1 ? 'os itens de origem' : 'o item origem'} e copiar.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <label style={labelStyle}>
          Altura (cm)
          <input type="number" step="0.1" min="0" value={height} onChange={e => setHeight(e.target.value)} style={inputStyle} placeholder="ex: 34" />
        </label>
        <label style={labelStyle}>
          Largura (cm)
          <input type="number" step="0.1" min="0" value={width} onChange={e => setWidth(e.target.value)} style={inputStyle} placeholder="ex: 22" />
        </label>
        <label style={labelStyle}>
          Comprimento (cm)
          <input type="number" step="0.1" min="0" value={length} onChange={e => setLength(e.target.value)} style={inputStyle} placeholder="ex: 30" />
        </label>
        <label style={labelStyle}>
          Peso (g)
          <input type="number" step="1" min="0" value={weight} onChange={e => setWeight(e.target.value)} style={inputStyle} placeholder="ex: 2360" />
        </label>
      </div>
      <button
        onClick={handleSubmit}
        disabled={submitting || (!height && !width && !length && !weight)}
        style={{
          marginTop: 'var(--space-3)',
          padding: '8px 20px',
          borderRadius: 6,
          background: 'var(--warning)',
          color: '#000',
          fontWeight: 600,
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
          opacity: submitting || (!height && !width && !length && !weight) ? 0.5 : 1,
        }}
      >
        {submitting ? 'Aplicando...' : 'Aplicar dimensões e copiar'}
      </button>
    </div>
  );
}
