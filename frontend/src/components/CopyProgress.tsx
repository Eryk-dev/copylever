import type { CopyResponse } from '../lib/api';

interface Props {
  results: CopyResponse;
}

export default function CopyProgress({ results }: Props) {
  return (
    <div style={{
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

      {/* Individual results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {results.results.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--paper)',
              borderRadius: 6,
              fontSize: 'var(--text-sm)',
              border: '1px solid var(--line)',
            }}
          >
            <span style={{
              width: 8, height: 8,
              borderRadius: '50%',
              background: r.status === 'success' ? 'var(--success)' : 'var(--danger)',
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

            {r.status === 'error' && r.error && (
              <span style={{
                color: 'var(--danger)',
                fontSize: 'var(--text-xs)',
                marginLeft: 'auto',
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }} title={r.error}>
                {r.error}
              </span>
            )}
          </div>
        ))}
      </div>
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
