import { useState } from 'react';
import { API_BASE, type CopyResponse, type CopyResult } from '../lib/api';
import DimensionForm, { type Dimensions } from './DimensionForm';
import { useToast } from './Toast';

interface Props {
  results: CopyResponse;
  sourceMap?: Record<string, string>;
  headers: () => Record<string, string>;
  onDimensionRetry?: (updated: CopyResponse) => void;
}

export default function CopyProgress({ results, sourceMap, headers, onDimensionRetry }: Props) {
  const { toast } = useToast();

  // Group needs_dimensions results by SKU (fallback to item_id if no SKU)
  const dimGroups = new Map<string, { itemIds: string[]; results: CopyResult[] }>();
  for (const r of results.results) {
    if (r.status !== 'needs_dimensions') continue;
    const key = r.sku || r.source_item_id;
    const group = dimGroups.get(key) || { itemIds: [], results: [] };
    if (!group.itemIds.includes(r.source_item_id)) group.itemIds.push(r.source_item_id);
    group.results.push(r);
    dimGroups.set(key, group);
  }

  const handleDimensionSubmit = async (groupKey: string, dims: Dimensions) => {
    const group = dimGroups.get(groupKey);
    if (!group) return;

    const fallbackSource = (results as any).source || '';
    const allRetryResults: CopyResult[] = [];
    const processedItemIds = new Set<string>();
    const failedItems = new Set<string>();

    // Call with-dimensions for each unique source item in the group
    for (const r of group.results) {
      if (processedItemIds.has(r.source_item_id)) continue;
      processedItemIds.add(r.source_item_id);

      const source = sourceMap?.[r.source_item_id] || fallbackSource;
      const itemDests = group.results.filter(rr => rr.source_item_id === r.source_item_id).map(rr => rr.dest_seller);
      try {
        const res = await fetch(`${API_BASE}/api/copy/with-dimensions`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ source, destinations: itemDests, item_id: r.source_item_id, dimensions: dims }),
        });
        if (!res.ok) {
          failedItems.add(r.source_item_id);
          continue;
        }
        const retryData: CopyResponse = await res.json();
        allRetryResults.push(...retryData.results);
      } catch (e) {
        failedItems.add(r.source_item_id);
      }
    }

    // Merge all retry results
    const updated = { ...results };
    updated.results = results.results.map(r => {
      if (r.status !== 'needs_dimensions') return r;
      const retried = allRetryResults.find(rr => rr.source_item_id === r.source_item_id && rr.dest_seller === r.dest_seller);
      return retried || r;
    });
    updated.success = updated.results.filter(r => r.status === 'success').length;
    updated.errors = updated.results.filter(r => r.status === 'error').length;
    updated.needs_dimensions = updated.results.filter(r => r.status === 'needs_dimensions').length;
    updated.total = updated.results.length;

    onDimensionRetry?.(updated);

    if (allRetryResults.length > 0 && failedItems.size === 0) {
      toast('Dimensões aplicadas e cópia reprocessada.', 'success');
    } else if (allRetryResults.length > 0) {
      toast('Parte das cópias foi reprocessada. Revise os erros restantes.', 'error');
    } else if (failedItems.size > 0) {
      toast(`Não foi possível reprocessar ${failedItems.size} anúncio(s).`, 'error');
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
        Resultado da Cópia
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

      {/* Dimension forms — one per SKU group */}
      {[...dimGroups.entries()].map(([groupKey, group]) => (
        <DimensionForm
          key={groupKey}
          sku={group.results[0]?.sku || undefined}
          itemIds={group.itemIds}
          destinations={[...new Set(group.results.map(r => r.dest_seller))]}
          onSubmit={(dims) => handleDimensionSubmit(groupKey, dims)}
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
            sem dimensões
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
