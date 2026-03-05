import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { API_BASE, type Seller, type CopyResponse, type CopyLog, type ItemPreview } from '../lib/api';
import type { AuthUser } from '../hooks/useAuth';
import CopyForm, { type CopyGroup } from '../components/CopyForm';
import CopyProgress from '../components/CopyProgress';
import DimensionForm, { type Dimensions } from '../components/DimensionForm';

const LOGS_PAGE_SIZE = 50;

interface Props {
  sellers: Seller[];
  headers: () => Record<string, string>;
  user: AuthUser | null;
}

function isDimensionError(log: CopyLog): boolean {
  if (log.status === 'needs_dimensions') return true;
  if (log.status === 'error' && log.error_details) {
    return Object.values(log.error_details).some(
      msg => typeof msg === 'string' && (msg.toLowerCase().includes('dimenso') || msg.toLowerCase().includes('dimension'))
    );
  }
  return false;
}

export default function CopyPage({ sellers, headers, user }: Props) {
  const [results, setResults] = useState<(CopyResponse & { source?: string }) | null>(null);
  const [sourceMap, setSourceMap] = useState<Record<string, string>>({});
  const [copying, setCopying] = useState(false);
  const [logs, setLogs] = useState<CopyLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [previews, setPreviews] = useState<ItemPreview[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const resolvedItemsRef = useRef<Array<[string, string]>>([]);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [retryLogId, setRetryLogId] = useState<number | null>(null);

  const loadLogs = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: '0' });
    if (statusFilter) params.set('status', statusFilter);
    try {
      const res = await fetch(`${API_BASE}/api/copy/logs?${params}`, { headers: headers(), cache: 'no-store' });
      if (res.ok) {
        const data: CopyLog[] = await res.json();
        setLogs(data);
        setHasMoreLogs(data.length === LOGS_PAGE_SIZE);
        setLogsLoaded(true);
      }
    } catch (e) { console.error('Failed to load logs:', e); }
  }, [headers, statusFilter]);

  const loadMoreLogs = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: String(logs.length) });
    if (statusFilter) params.set('status', statusFilter);
    try {
      const res = await fetch(`${API_BASE}/api/copy/logs?${params}`, { headers: headers(), cache: 'no-store' });
      if (res.ok) {
        const data: CopyLog[] = await res.json();
        setLogs(prev => [...prev, ...data]);
        setHasMoreLogs(data.length === LOGS_PAGE_SIZE);
      }
    } catch (e) { console.error('Failed to load more logs:', e); }
  }, [headers, statusFilter, logs.length]);

  // Reset logs when filter changes
  useEffect(() => {
    setLogs([]);
    setLogsLoaded(false);
    setRetryLogId(null);
  }, [statusFilter]);

  const handleCopy = useCallback(async (groups: CopyGroup[], destinations: string[]) => {
    setCopying(true);
    setResults(null);
    // Refresh logs after a short delay to pick up in_progress rows created by the backend
    setTimeout(loadLogs, 1000);

    const allResults: CopyResponse['results'] = [];
    let totalSuccess = 0;
    let totalErrors = 0;
    let totalDims = 0;

    // Build sourceMap: item_id → seller_slug
    const newSourceMap: Record<string, string> = {};
    for (const group of groups) {
      for (const id of group.itemIds) {
        newSourceMap[id] = group.source;
      }
    }
    setSourceMap(newSourceMap);

    for (const group of groups) {
      try {
        const res = await fetch(`${API_BASE}/api/copy`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ source: group.source, destinations, item_ids: group.itemIds }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
          allResults.push(...group.itemIds.map(id => ({ source_item_id: id, dest_seller: '', status: 'error' as const, dest_item_id: null, error: err.detail })));
          totalErrors += group.itemIds.length;
          continue;
        }
        const data: CopyResponse = await res.json();
        allResults.push(...data.results);
        totalSuccess += data.success;
        totalErrors += data.errors;
        totalDims += data.needs_dimensions ?? 0;
      } catch (e) {
        allResults.push(...group.itemIds.map(id => ({ source_item_id: id, dest_seller: '', status: 'error' as const, dest_item_id: null, error: String(e) })));
        totalErrors += group.itemIds.length;
      }
    }

    setResults({
      total: allResults.length,
      success: totalSuccess,
      errors: totalErrors,
      needs_dimensions: totalDims,
      results: allResults,
      source: groups[0]?.source,
    });
    setCopying(false);
    loadLogs();
  }, [headers, loadLogs]);

  const handlePreview = useCallback(async (items: Array<[string, string]>) => {
    if (!items.length) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviews([]);
    try {
      const results = await Promise.all(
        items.map(async ([rawId, seller]) => {
          try {
            let itemId = rawId.trim();
            const m = itemId.match(/MLB[-]?(\d+)/i);
            if (m) itemId = `MLB${m[1]}`;
            else if (/^\d+$/.test(itemId)) itemId = `MLB${itemId}`;
            const res = await fetch(`${API_BASE}/api/copy/preview/${itemId}?seller=${encodeURIComponent(seller)}`, { headers: headers(), cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json() as ItemPreview;
          } catch { return null; }
        })
      );
      const valid = results.filter((r): r is ItemPreview => r !== null);
      if (valid.length === 0) { setPreviewError('Nenhum item encontrado'); return; }
      setPreviews(valid);
    } catch (e) { setPreviewError(String(e)); }
    finally { setPreviewLoading(false); }
  }, [headers]);

  const handleResolvedChange = useCallback((items: Array<[string, string]>) => {
    resolvedItemsRef.current = items;
    if (previewOpen && items.length > 0) {
      handlePreview(items);
    } else if (items.length === 0) {
      setPreviews([]);
      setPreviewOpen(false);
    }
  }, [previewOpen, handlePreview]);

  const handleLogRetry = useCallback(async (logId: number, dims: Dimensions) => {
    try {
      const res = await fetch(`${API_BASE}/api/copy/retry-dimensions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ log_id: logId, dimensions: dims }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
        alert(`Erro: ${err.detail}`);
        return;
      }
      setRetryLogId(null);
      loadLogs();
    } catch (e) {
      alert(`Erro: ${e}`);
    }
  }, [headers, loadLogs]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasInProgress = logs.some(l => l.status === 'in_progress');

  useEffect(() => {
    if (hasInProgress) {
      pollRef.current = setInterval(loadLogs, 5000);
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [hasInProgress, loadLogs]);

  if (!logsLoaded) loadLogs();

  const isAdmin = user?.role === 'admin';
  const sourceSellers = useMemo(() => {
    if (!user || isAdmin) return sellers;
    const allowed = new Set(user.permissions.filter(p => p.can_copy_from).map(p => p.seller_slug));
    return sellers.filter(s => allowed.has(s.slug));
  }, [sellers, user, isAdmin]);

  const destSellers = useMemo(() => {
    if (!user || isAdmin) return sellers;
    const allowed = new Set(user.permissions.filter(p => p.can_copy_to).map(p => p.seller_slug));
    return sellers.filter(s => allowed.has(s.slug));
  }, [sellers, user, isAdmin]);

  const hasAnySellers = sourceSellers.length > 0 && destSellers.length > 0;

  if (!hasAnySellers) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-8) var(--space-4)',
        background: 'var(--surface)',
        borderRadius: 8,
        color: 'var(--ink-faint)',
        textAlign: 'center',
      }}>
        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
          Nenhum seller disponivel. Peca ao admin para liberar acesso.
        </p>
      </div>
    );
  }

  const filterTabs = [
    { key: '', label: 'Todos' },
    { key: 'success', label: 'Sucesso' },
    { key: 'error', label: 'Erros' },
    { key: 'needs_dimensions', label: 'Sem Dimensoes' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <CopyForm sourceSellers={sourceSellers} destSellers={destSellers} headers={headers} onCopy={handleCopy} onPreview={handlePreview} onResolvedChange={handleResolvedChange} copying={copying} />

      {previewLoading && (
        <Card title="Preview">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--ink-faint)', fontSize: 'var(--text-sm)' }}>
            <span className="spinner spinner-sm" />
            Carregando preview...
          </div>
        </Card>
      )}
      {previewError && (
        <Card title="Preview">
          <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{previewError}</p>
        </Card>
      )}
      {previews.length > 0 && (
        <Card title={`Preview (${previews.length})`} action={
          <button onClick={() => { setPreviews([]); setPreviewOpen(false); }} style={{
            background: 'none',
            color: 'var(--ink-faint)',
            fontSize: 'var(--text-sm)',
            padding: '2px 6px',
            borderRadius: 4,
            lineHeight: 1,
          }}>
            {'\u2715'}
          </button>
        }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {previews.map(p => (
              <div key={p.id} className="animate-in" style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--paper)',
                borderRadius: 6,
                border: '1px solid var(--line)',
              }}>
                {p.thumbnail && (
                  <img src={p.thumbnail} alt="" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', background: 'var(--surface)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 500, fontSize: 'var(--text-xs)', lineHeight: 'var(--leading-tight)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</p>
                  <p style={{ color: 'var(--positive)', fontWeight: 700, fontSize: 'var(--text-sm)', marginTop: 2 }}>
                    {p.currency_id} {p.price?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexShrink: 0 }}>
                  <span>{p.pictures_count} fotos</span>
                  <span>{p.variations_count} var.</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {results && (
        <CopyProgress
          results={results}
          sourceMap={sourceMap}
          headers={headers}
          onDimensionRetry={(updated) => setResults({ ...updated, source: results.source })}
        />
      )}

      {/* Logs */}
      <Card
        title={`Historico (${logs.length}${hasMoreLogs ? '+' : ''})`}
        collapsible
        open={logsOpen}
        onToggle={() => setLogsOpen(!logsOpen)}
      >
        {logsOpen && (
          <>
            {/* Status filter tabs */}
            <div style={{
              display: 'flex',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-3)',
              flexWrap: 'wrap',
            }}>
              {filterTabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 4,
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    background: statusFilter === tab.key ? 'var(--ink)' : 'transparent',
                    color: statusFilter === tab.key ? 'var(--paper)' : 'var(--ink-faint)',
                    border: `1px solid ${statusFilter === tab.key ? 'var(--ink)' : 'var(--line)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {logs.length === 0 && logsLoaded ? (
              <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-sm)', textAlign: 'center', padding: 'var(--space-4)' }}>
                Nenhum registro{statusFilter ? ` com status "${statusFilter}"` : ''}.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                  <thead>
                    <tr>
                      {['Data', 'Origem', 'Destino(s)', 'Item', 'Status', 'Novos IDs', ''].map(h => (
                        <th key={h} style={{
                          textAlign: 'left',
                          padding: 'var(--space-2) var(--space-3)',
                          color: 'var(--ink-faint)',
                          fontWeight: 500,
                          fontSize: 'var(--text-xs)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          borderBottom: '1px solid var(--line)',
                          whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <LogRow
                        key={log.id}
                        log={log}
                        isRetrying={retryLogId === log.id}
                        onRetryClick={() => setRetryLogId(retryLogId === log.id ? null : log.id)}
                        onRetrySubmit={(dims) => handleLogRetry(log.id, dims)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Load more */}
            {hasMoreLogs && (
              <button
                onClick={loadMoreLogs}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: 'var(--space-2)',
                  marginTop: 'var(--space-3)',
                  background: 'none',
                  color: 'var(--ink-faint)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                }}
              >
                Carregar mais...
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function LogRow({ log, isRetrying, onRetryClick, onRetrySubmit }: {
  log: CopyLog;
  isRetrying: boolean;
  onRetryClick: () => void;
  onRetrySubmit: (dims: Dimensions) => void;
}) {
  const canRetry = isDimensionError(log);

  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--line)' }}>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td style={td}>{log.source_seller}</td>
        <td style={td}>{log.dest_sellers?.join(', ')}</td>
        <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{log.source_item_id}</td>
        <td style={td}><StatusBadge status={log.status} /></td>
        <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
          {log.dest_item_ids ? Object.entries(log.dest_item_ids).map(([s, id]) => <div key={s}>{s}: {id}</div>) : '-'}
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>
          {canRetry && (
            <button
              onClick={onRetryClick}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                background: isRetrying ? 'var(--ink)' : 'rgba(245, 158, 11, 0.1)',
                color: isRetrying ? 'var(--paper)' : 'var(--warning)',
                border: `1px solid ${isRetrying ? 'var(--ink)' : 'rgba(245, 158, 11, 0.3)'}`,
                cursor: 'pointer',
              }}
            >
              {isRetrying ? 'Cancelar' : 'Corrigir'}
            </button>
          )}
        </td>
      </tr>
      {isRetrying && (
        <tr>
          <td colSpan={7} style={{ padding: 'var(--space-2) var(--space-3)' }}>
            <DimensionForm
              itemIds={[log.source_item_id]}
              destinations={log.dest_sellers || []}
              onSubmit={onRetrySubmit}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export function Card({ title, action, collapsible, open, onToggle, children }: {
  title: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{
      background: 'var(--surface)',
      borderRadius: 8,
      padding: 'var(--space-5)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: (collapsible && !open) ? 0 : 'var(--space-3)',
      }}>
        {collapsible ? (
          <h3
            className="collapsible-trigger"
            onClick={onToggle}
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--ink)',
              letterSpacing: 'var(--tracking-tight)',
            }}
          >
            <span className={`collapsible-arrow${open ? ' open' : ''}`}>{'\u25B6'}</span>
            {title}
          </h3>
        ) : (
          <h3 style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--ink)',
            letterSpacing: 'var(--tracking-tight)',
          }}>{title}</h3>
        )}
        {action}
      </div>
      {children}
    </div>
  );
}

const statusLabels: Record<string, string> = {
  needs_dimensions: 'Sem Dimensoes',
  in_progress: 'Copiando...',
  success: 'success',
  error: 'error',
  partial: 'partial',
};

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = { success: 'var(--success)', error: 'var(--danger)', partial: 'var(--warning)', pending: 'var(--ink-faint)', in_progress: 'var(--info, #3b82f6)', needs_dimensions: 'var(--warning)' };
  const bg: Record<string, string> = { success: 'rgba(16, 185, 129, 0.08)', error: 'rgba(239, 68, 68, 0.08)', partial: 'rgba(245, 158, 11, 0.08)', in_progress: 'rgba(59, 130, 246, 0.08)', needs_dimensions: 'rgba(245, 158, 11, 0.08)' };
  const isInProgress = status === 'in_progress';
  return (
    <span style={{
      color: c[status] || 'var(--ink-faint)',
      fontWeight: 600,
      fontSize: 'var(--text-xs)',
      textTransform: 'uppercase',
      background: bg[status] || 'transparent',
      padding: '2px 8px',
      borderRadius: 4,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      animation: isInProgress ? 'pulse-badge 1.5s ease-in-out infinite' : undefined,
    }}>
      {isInProgress && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />}
      {statusLabels[status] || status}
    </span>
  );
}

const td: React.CSSProperties = { padding: 'var(--space-2) var(--space-3)', color: 'var(--ink)' };
