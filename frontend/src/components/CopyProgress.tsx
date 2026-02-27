import { useState } from 'react';
import { API_BASE, type CopyResponse, type CopyResult } from '../lib/api';

interface Props {
  results: CopyResponse;
  headers: () => Record<string, string>;
  onDimensionRetry?: (updated: CopyResponse) => void;
}

export default function CopyProgress({ results, headers, onDimensionRetry }: Props) {
  // Group needs_dimensions results by source_item_id
  const dimItems = new Map<string, CopyResult[]>();
  for (const r of results.results) {
    if (r.status === 'needs_dimensions') {
      const list = dimItems.get(r.source_item_id) || [];
      list.push(r);
      dimItems.set(r.source_item_id, list);
    }
  }

  const handleDimensionSubmit = async (itemId: string, destinations: string[], dims: Dimensions) => {
    // Find the source seller from other results
    const sourceResult = results.results.find(r => r.source_item_id === itemId);
    if (!sourceResult) return;

    // The source seller is embedded in the copy context — we need to pass it.
    // Extract from the first non-dimension result's context or from the request.
    // We'll look for it from the original request data passed via the response.
    const source = (results as any).source || '';

    try {
      const res = await fetch(`${API_BASE}/api/copy/with-dimensions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          source,
          destinations,
          item_id: itemId,
          dimensions: dims,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
        alert(`Erro: ${err.detail}`);
        return;
      }
      const retryData: CopyResponse = await res.json();

      // Merge retry results into existing results
      const updated = { ...results };
      updated.results = results.results.map(r => {
        if (r.source_item_id !== itemId || r.status !== 'needs_dimensions') return r;
        const retried = retryData.results.find(rr => rr.dest_seller === r.dest_seller);
        return retried || r;
      });
      updated.success = updated.results.filter(r => r.status === 'success').length;
      updated.errors = updated.results.filter(r => r.status === 'error').length;
      updated.needs_dimensions = updated.results.filter(r => r.status === 'needs_dimensions').length;
      updated.total = updated.results.length;

      onDimensionRetry?.(updated);
    } catch (e) {
      alert(`Erro: ${e}`);
    }
  };

  return (
    <div className="card animate-slide-up" style={{
      background: 'var(--surface)',
      borderRadius: 8,
      padding: 'var(--space-5)',
    }}>
      <h3 style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        color: 'var(--ink)',
        marginBottom: 'var(--space-3)',
        letterSpacing: 'var(--tracking-tight)',
      }}>
        Resultado da Copia
      </h3>

      {/* Summary */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--paper)',
        borderRadius: 6,
        border: '1px solid var(--line)',
      }}>
        <Stat label="Total" value={results.total} color="var(--ink)" />
        <Stat label="Sucesso" value={results.success} color="var(--success)" />
        <Stat label="Erros" value={results.errors} color="var(--danger)" />
      </div>

      {/* Dimension forms — one per source item that needs it */}
      {[...dimItems.entries()].map(([itemId, dimResults]) => (
        <DimensionForm
          key={itemId}
          itemId={itemId}
          destinations={dimResults.map(r => r.dest_seller)}
          onSubmit={(dims) => handleDimensionSubmit(itemId, dimResults.map(r => r.dest_seller), dims)}
        />
      ))}

      {/* Individual results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {results.results.map((r, i) => (
          <ResultRow key={i} result={r} />
        ))}
      </div>
    </div>
  );
}

interface Dimensions {
  height?: number;
  width?: number;
  length?: number;
  weight?: number;
}

function DimensionForm({ itemId, destinations, onSubmit }: {
  itemId: string;
  destinations: string[];
  onSubmit: (dims: Dimensions) => void;
}) {
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
        Dimensoes necessarias
      </div>
      <p style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--ink-muted)',
        marginBottom: 'var(--space-3)',
        lineHeight: 'var(--leading-normal)',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{itemId}</span>
        {' '}&rarr; {destinations.join(', ')}
        <br />
        Informe as dimensoes da embalagem para atualizar o item origem e copiar.
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
        {submitting ? 'Aplicando...' : 'Aplicar dimensoes e copiar'}
      </button>
    </div>
  );
}

function ResultRow({ result: r }: { result: CopyResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = r.status === 'error' && r.error;
  const isDim = r.status === 'needs_dimensions';

  const dotColor = r.status === 'success'
    ? 'var(--success)'
    : isDim ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{ borderRadius: 6, border: '1px solid var(--line)', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--paper)',
          fontSize: 'var(--text-sm)',
          cursor: hasError ? 'pointer' : 'default',
        }}
        onClick={() => hasError && setExpanded(!expanded)}
      >
        <span style={{
          width: 8, height: 8,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
        }} />
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', fontSize: 'var(--text-xs)' }}>
          {r.source_item_id}
        </span>
        <span style={{ color: 'var(--ink-faint)' }}>&rarr;</span>
        <span style={{ color: 'var(--ink)' }}>{r.dest_seller}</span>

        {r.status === 'success' && r.dest_item_id && (
          <>
            <span style={{ color: 'var(--ink-faint)' }}>=</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)', fontSize: 'var(--text-xs)' }}>
              {r.dest_item_id}
            </span>
          </>
        )}

        {isDim && (
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--warning)', fontWeight: 500 }}>
            sem dimensoes
          </span>
        )}

        {hasError && (
          <span style={{
            color: 'var(--danger)',
            fontSize: 'var(--text-xs)',
            marginLeft: 'auto',
            maxWidth: expanded ? 'none' : 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: expanded ? 'normal' : 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            <span className={`collapsible-arrow${expanded ? ' open' : ''}`}>{'\u25B6'}</span>
            {!expanded && r.error}
          </span>
        )}
      </div>

      {/* Expanded error details */}
      {expanded && hasError && (
        <div style={{
          padding: 'var(--space-2) var(--space-3)',
          background: 'rgba(239, 68, 68, 0.04)',
          borderTop: '1px solid var(--line)',
          fontSize: 'var(--text-xs)',
          color: 'var(--danger)',
          fontFamily: 'var(--font-mono)',
          wordBreak: 'break-word',
          lineHeight: 'var(--leading-normal)',
        }}>
          {r.error}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}
