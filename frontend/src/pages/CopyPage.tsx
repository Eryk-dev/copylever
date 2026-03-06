import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { API_BASE, type Seller, type ShopeeSeller, type CopyQueuedResponse, type CopyLog, type ItemPreview } from '../lib/api';
import type { AuthUser } from '../hooks/useAuth';
import CopyForm, { type CopyGroup, type Platform } from '../components/CopyForm';
import DimensionForm, { type Dimensions } from '../components/DimensionForm';
import { useToast } from '../components/Toast';

const LOGS_PAGE_SIZE = 50;

type UnifiedLog = CopyLog & { platform: Platform };

interface Props {
  sellers: Seller[];
  shopeeSellers: ShopeeSeller[];
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

export default function CopyPage({ sellers, shopeeSellers, headers, user }: Props) {
  const { toast } = useToast();
  const [copying, setCopying] = useState(false);
  const [logs, setLogs] = useState<UnifiedLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [previews, setPreviews] = useState<ItemPreview[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [retryLogId, setRetryLogId] = useState<number | null>(null);
  const [retryPlatform, setRetryPlatform] = useState<Platform>('ml');

  const loadLogs = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: '0' });
    if (statusFilter) params.set('status', statusFilter);
    try {
      const [mlRes, shopeeRes] = await Promise.all([
        fetch(`${API_BASE}/api/copy/logs?${params}`, { headers: headers(), cache: 'no-store' }),
        fetch(`${API_BASE}/api/shopee/copy/logs?${params}`, { headers: headers(), cache: 'no-store' }),
      ]);
      const mlLogs: CopyLog[] = mlRes.ok ? await mlRes.json() : [];
      const shopeeLogs: CopyLog[] = shopeeRes.ok ? await shopeeRes.json() : [];
      const merged: UnifiedLog[] = [
        ...mlLogs.map(l => ({ ...l, platform: 'ml' as Platform })),
        ...shopeeLogs.map(l => ({ ...l, platform: 'shopee' as Platform })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
       .slice(0, LOGS_PAGE_SIZE);
      setLogs(merged);
      setHasMoreLogs(mlLogs.length === LOGS_PAGE_SIZE || shopeeLogs.length === LOGS_PAGE_SIZE);
      setLogsLoaded(true);
    } catch (e) { console.error('Failed to load logs:', e); }
  }, [headers, statusFilter]);

  const loadMoreLogs = useCallback(async () => {
    // For merged logs, load more from both and merge
    const mlCount = logs.filter(l => l.platform === 'ml').length;
    const shopeeCount = logs.filter(l => l.platform === 'shopee').length;
    const mlParams = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: String(mlCount) });
    const shopeeParams = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: String(shopeeCount) });
    if (statusFilter) { mlParams.set('status', statusFilter); shopeeParams.set('status', statusFilter); }
    try {
      const [mlRes, shopeeRes] = await Promise.all([
        fetch(`${API_BASE}/api/copy/logs?${mlParams}`, { headers: headers(), cache: 'no-store' }),
        fetch(`${API_BASE}/api/shopee/copy/logs?${shopeeParams}`, { headers: headers(), cache: 'no-store' }),
      ]);
      const mlLogs: CopyLog[] = mlRes.ok ? await mlRes.json() : [];
      const shopeeLogs: CopyLog[] = shopeeRes.ok ? await shopeeRes.json() : [];
      const newLogs: UnifiedLog[] = [
        ...mlLogs.map(l => ({ ...l, platform: 'ml' as Platform })),
        ...shopeeLogs.map(l => ({ ...l, platform: 'shopee' as Platform })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setLogs(prev => [...prev, ...newLogs]);
      setHasMoreLogs(mlLogs.length === LOGS_PAGE_SIZE || shopeeLogs.length === LOGS_PAGE_SIZE);
    } catch (e) { console.error('Failed to load more logs:', e); }
  }, [headers, statusFilter, logs]);

  useEffect(() => {
    setLogs([]);
    setLogsLoaded(false);
    setRetryLogId(null);
  }, [statusFilter]);

  const handleCopy = useCallback(async (groups: CopyGroup[], destinations: string[]) => {
    setCopying(true);
    let totalQueued = 0;

    // Split destinations by platform
    const mlDestSlugs = destinations.filter(d => sellers.some(s => s.slug === d));
    const shopeeDestSlugs = destinations.filter(d => shopeeSellers.some(s => s.slug === d));

    for (const group of groups) {
      const dests = group.platform === 'ml' ? mlDestSlugs : shopeeDestSlugs;
      if (dests.length === 0) continue;

      const endpoint = group.platform === 'ml' ? '/api/copy' : '/api/shopee/copy';
      try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ source: group.source, destinations: dests, item_ids: group.itemIds }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
          toast(err.detail, 'error');
          continue;
        }
        const data: CopyQueuedResponse = await res.json();
        totalQueued += data.total;
      } catch (e) {
        toast(String(e), 'error');
      }
    }

    if (totalQueued > 0) {
      toast(`${totalQueued} item(s) enfileirado(s). Acompanhe no histórico abaixo.`, 'success');
    }
    setCopying(false);
    void loadLogs();
  }, [headers, loadLogs, toast, sellers, shopeeSellers]);

  const handlePreview = useCallback(async (items: Array<[string, string, Platform]>) => {
    if (!items.length) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviews([]);
    try {
      const results = await Promise.all(
        items.map(async ([rawId, seller, platform]) => {
          try {
            if (platform === 'ml') {
              let itemId = rawId.trim();
              const m = itemId.match(/MLB[-]?(\d+)/i);
              if (m) itemId = `MLB${m[1]}`;
              else if (/^\d+$/.test(itemId)) itemId = `MLB${itemId}`;
              const res = await fetch(`${API_BASE}/api/copy/preview/${itemId}?seller=${encodeURIComponent(seller)}`, { headers: headers(), cache: 'no-store' });
              if (!res.ok) return null;
              return await res.json() as ItemPreview;
            } else {
              const res = await fetch(`${API_BASE}/api/shopee/copy/preview/${rawId}`, { headers: headers(), cache: 'no-store' });
              if (!res.ok) return null;
              const data = await res.json();
              // Normalize to ItemPreview shape
              return {
                id: String(data.item_id),
                title: data.item_name,
                price: data.original_price,
                thumbnail: data.image_url,
                pictures_count: data.image_count,
                variations_count: data.model_count,
                weight: data.weight,
                has_description: data.has_description,
                stock: data.stock,
              } as ItemPreview;
            }
          } catch { return null; }
        })
      );
      const valid = results.filter((r): r is ItemPreview => r !== null);
      if (valid.length === 0) { setPreviewError('Nenhum item encontrado'); return; }
      setPreviews(valid);
    } catch (e) { setPreviewError(String(e)); }
    finally { setPreviewLoading(false); }
  }, [headers]);

  const handleResolvedChange = useCallback((items: Array<[string, string, Platform]>) => {
    if (previewOpen && items.length > 0) {
      handlePreview(items);
    } else if (items.length === 0) {
      setPreviews([]);
      setPreviewOpen(false);
    }
  }, [previewOpen, handlePreview]);

  const handleLogRetry = useCallback(async (log: UnifiedLog, dims: Dimensions) => {
    try {
      const endpoint = log.platform === 'ml' ? '/api/copy/retry-dimensions' : '/api/shopee/copy/with-dimensions';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(
          log.platform === 'ml'
            ? { log_id: log.id, dimensions: dims }
            : { source: log.source_seller, destinations: log.dest_sellers, item_id: String(log.source_item_id), dimensions: dims }
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
        toast(err.detail, 'error');
        return;
      }
      setRetryLogId(null);
      toast('Cópia reenviada com as dimensões informadas.', 'success');
      void loadLogs();
    } catch (e) {
      toast(String(e), 'error');
    }
  }, [headers, loadLogs, toast]);

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

  useEffect(() => {
    if (!logsLoaded) { void loadLogs(); }
  }, [logsLoaded, loadLogs]);

  const isAdmin = user?.role === 'admin';

  // ML source/dest sellers (permission-filtered)
  const mlSourceSellers = useMemo(() => {
    if (!user || isAdmin) return sellers;
    const allowed = new Set(user.permissions.filter(p => p.can_copy_from).map(p => p.seller_slug));
    return sellers.filter(s => allowed.has(s.slug));
  }, [sellers, user, isAdmin]);

  const mlDestSellers = useMemo(() => {
    if (!user || isAdmin) return sellers;
    const allowed = new Set(user.permissions.filter(p => p.can_copy_to).map(p => p.seller_slug));
    return sellers.filter(s => allowed.has(s.slug));
  }, [sellers, user, isAdmin]);

  // Shopee source/dest sellers (permission-filtered)
  const shopeeSourceSellers = useMemo(() => {
    if (!user || isAdmin) return shopeeSellers;
    const allowed = new Set(user.permissions.filter(p => p.can_copy_from).map(p => p.seller_slug));
    return shopeeSellers.filter(s => allowed.has(s.slug));
  }, [shopeeSellers, user, isAdmin]);

  const shopeeDestSellers = useMemo(() => {
    if (!user || isAdmin) return shopeeSellers;
    const allowed = new Set(user.permissions.filter(p => p.can_copy_to).map(p => p.seller_slug));
    return shopeeSellers.filter(s => allowed.has(s.slug));
  }, [shopeeSellers, user, isAdmin]);

  const filterTabs = [
    { key: '', label: 'Todos' },
    { key: 'in_progress', label: 'Em andamento' },
    { key: 'success', label: 'Sucesso' },
    { key: 'partial', label: 'Parcial' },
    { key: 'error', label: 'Erros' },
    { key: 'needs_dimensions', label: 'Aguardando dimensões' },
  ];

  const hasAnySellers = (mlSourceSellers.length > 0 && mlDestSellers.length > 0)
    || (shopeeSourceSellers.length > 0 && shopeeDestSellers.length > 0);

  if (!hasAnySellers) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-3)', padding: 'var(--space-8) var(--space-4)',
        background: 'var(--surface)', borderRadius: 8, color: 'var(--ink-faint)', textAlign: 'center',
      }}>
        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
          Nenhuma conta disponível. Peça ao admin para liberar acesso.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <CopyForm
        mlSourceSellers={mlSourceSellers}
        mlDestSellers={mlDestSellers}
        shopeeSourceSellers={shopeeSourceSellers}
        shopeeDestSellers={shopeeDestSellers}
        headers={headers}
        onCopy={handleCopy}
        onPreview={handlePreview}
        onResolvedChange={handleResolvedChange}
        copying={copying}
      />

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
            background: 'none', color: 'var(--ink-faint)', fontSize: 'var(--text-sm)',
            padding: '2px 6px', borderRadius: 4, lineHeight: 1,
          }}>{'\u2715'}</button>
        }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {previews.map(p => (
              <div key={p.id} className="animate-in" style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--paper)', borderRadius: 6, border: '1px solid var(--line)',
              }}>
                {p.thumbnail && (
                  <img src={p.thumbnail} alt="" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', background: 'var(--surface)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 500, fontSize: 'var(--text-xs)', lineHeight: 'var(--leading-tight)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</p>
                  <p style={{ color: 'var(--success)', fontWeight: 700, fontSize: 'var(--text-sm)', marginTop: 2 }}>
                    R$ {p.price?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{p.pictures_count} fotos</span>
                  <span>{p.variations_count} var.</span>
                  {p.weight != null && <span>{p.weight >= 1000 ? `${(p.weight / 1000).toFixed(1)}kg` : `${p.weight}g`}</span>}
                  {p.has_description === false && (
                    <span style={{ color: 'var(--warning)', fontWeight: 600 }} title="Shopee exige descricao para criar anuncio">
                      Sem descricao
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Logs */}
      <Card title={`Histórico (${logs.length}${hasMoreLogs ? '+' : ''})`} collapsible open={logsOpen} onToggle={() => setLogsOpen(!logsOpen)}>
        {logsOpen && (
          <>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
              {filterTabs.map(tab => (
                <button key={tab.key} onClick={() => setStatusFilter(tab.key)} style={{
                  padding: '4px 12px', borderRadius: 4, fontSize: 'var(--text-xs)', fontWeight: 600,
                  background: statusFilter === tab.key ? 'var(--ink)' : 'transparent',
                  color: statusFilter === tab.key ? 'var(--paper)' : 'var(--ink-faint)',
                  border: `1px solid ${statusFilter === tab.key ? 'var(--ink)' : 'var(--line)'}`,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>{tab.label}</button>
              ))}
            </div>

            {logs.length === 0 && logsLoaded ? (
              <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-sm)', textAlign: 'center', padding: 'var(--space-4)' }}>
                Nenhum registro{statusFilter ? ` com status "${statusFilter}"` : ''}.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {logs.map(log => (
                  <LogCard
                    key={`${log.platform}-${log.id}`}
                    log={log}
                    isRetrying={retryLogId === log.id && retryPlatform === log.platform}
                    onRetryClick={() => {
                      if (retryLogId === log.id && retryPlatform === log.platform) {
                        setRetryLogId(null);
                      } else {
                        setRetryLogId(log.id);
                        setRetryPlatform(log.platform);
                      }
                    }}
                    onRetrySubmit={(dims) => handleLogRetry(log, dims)}
                  />
                ))}
              </div>
            )}

            {hasMoreLogs && (
              <button onClick={loadMoreLogs} style={{
                display: 'block', width: '100%', padding: 'var(--space-2)', marginTop: 'var(--space-3)',
                background: 'none', color: 'var(--ink-faint)', fontSize: 'var(--text-xs)', fontWeight: 500,
                cursor: 'pointer', border: '1px solid var(--line)', borderRadius: 6,
              }}>Carregar mais...</button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function LogCard({ log, isRetrying, onRetryClick, onRetrySubmit }: {
  log: UnifiedLog;
  isRetrying: boolean;
  onRetryClick: () => void;
  onRetrySubmit: (dims: Dimensions) => void;
}) {
  const canRetry = isDimensionError(log);
  const destEntries = log.dest_item_ids ? Object.entries(log.dest_item_ids) : [];
  const errorEntries = log.error_details ? Object.entries(log.error_details) : [];
  const isShopee = log.platform === 'shopee';

  const accentMap: Record<string, string> = {
    success: 'var(--success)', error: 'var(--danger)', partial: 'var(--warning)',
    pending: 'var(--ink-faint)', in_progress: 'var(--info)', needs_dimensions: 'var(--warning)',
  };

  return (
    <>
      <div className="animate-in" style={{
        background: 'var(--paper)', borderRadius: 10,
        border: '1px solid var(--line)', borderLeftWidth: 3,
        borderLeftColor: accentMap[log.status] || 'var(--line)',
        padding: 'var(--space-3) var(--space-4)',
      }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {log.source_item_thumbnail ? (
            <img src={log.source_item_thumbnail} alt="" style={{
              width: 44, height: 44, borderRadius: 8, objectFit: 'cover',
              background: 'var(--surface)', flexShrink: 0, alignSelf: 'flex-start',
            }} />
          ) : (
            <div style={{
              width: 44, height: 44, borderRadius: 8, background: isShopee ? 'rgba(238,77,45,0.1)' : 'var(--surface)',
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isShopee ? '#EE4D2D' : 'var(--ink-faint)', fontSize: 'var(--text-xs)', fontWeight: 700,
            }}>
              {isShopee ? 'S' : 'ML'}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{
                fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--ink)',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {log.source_item_title || log.source_item_id}
              </span>
              <StatusBadge status={log.status} />
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              marginTop: 3, fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexWrap: 'wrap',
            }}>
              <code style={{
                fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                background: 'var(--surface)', padding: '0 5px', borderRadius: 3, lineHeight: '18px',
              }}>
                {log.source_item_id}
              </code>
              <span style={{ opacity: 0.4 }}>&middot;</span>
              <span>{log.source_seller} &rarr; {log.dest_sellers?.join(', ')}</span>
              <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {new Date(log.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </div>

            {destEntries.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                {destEntries.map(([seller, id]) => (
                  <span key={seller} className="log-chip-success" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: 4, fontSize: 'var(--text-xs)',
                  }}>
                    <span style={{ color: 'var(--ink-faint)' }}>{seller}:</span>
                    <code style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--success)' }}>{id}</code>
                  </span>
                ))}
              </div>
            )}

            {errorEntries.length > 0 && (
              <div className="log-error-block" style={{
                marginTop: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 6,
              }}>
                {errorEntries.map(([seller, err]) => (
                  <div key={seller} style={{
                    fontSize: 'var(--text-xs)', color: 'var(--danger)',
                    display: 'flex', gap: 'var(--space-1)', lineHeight: 'var(--leading-normal)',
                  }}>
                    <span style={{ fontWeight: 600, flexShrink: 0 }}>{seller}:</span>
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}

            {canRetry && (
              <button onClick={onRetryClick} style={{
                marginTop: 'var(--space-2)', padding: '4px 12px', borderRadius: 5,
                fontSize: 'var(--text-xs)', fontWeight: 600,
                background: isRetrying ? 'var(--ink)' : 'var(--attention-bg)',
                color: isRetrying ? 'var(--paper)' : 'var(--attention)',
                border: `1px solid ${isRetrying ? 'var(--ink)' : 'rgba(217, 119, 6, 0.2)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {isRetrying ? 'Cancelar' : 'Informar dimensoes'}
              </button>
            )}
          </div>
        </div>
      </div>

      {isRetrying && (
        <div className="animate-in" style={{
          background: 'var(--attention-bg)', border: '1px solid rgba(217, 119, 6, 0.12)',
          borderRadius: 10, padding: 'var(--space-3) var(--space-4)',
        }}>
          <DimensionForm
            itemIds={[log.source_item_id]}
            destinations={log.dest_sellers || []}
            onSubmit={onRetrySubmit}
          />
        </div>
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
    <div className="card" style={{ background: 'var(--surface)', borderRadius: 8, padding: 'var(--space-5)' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: (collapsible && !open) ? 0 : 'var(--space-3)',
      }}>
        {collapsible ? (
          <h3 className="collapsible-trigger" onClick={onToggle} style={{
            fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', letterSpacing: 'var(--tracking-tight)',
          }}>
            <span className={`collapsible-arrow${open ? ' open' : ''}`}>{'\u25B6'}</span>
            {title}
          </h3>
        ) : (
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', letterSpacing: 'var(--tracking-tight)' }}>{title}</h3>
        )}
        {action}
      </div>
      {children}
    </div>
  );
}

const statusLabels: Record<string, string> = {
  needs_dimensions: 'Aguardando dimensões',
  in_progress: 'Copiando...',
  pending: 'Pendente',
  success: 'Sucesso',
  error: 'Erro',
  partial: 'Parcial',
};

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = { success: 'var(--success)', error: 'var(--danger)', partial: 'var(--warning)', pending: 'var(--ink-faint)', in_progress: 'var(--info)', needs_dimensions: 'var(--warning)' };
  const bg: Record<string, string> = { success: 'rgba(16, 185, 129, 0.08)', error: 'rgba(239, 68, 68, 0.08)', partial: 'rgba(245, 158, 11, 0.08)', in_progress: 'rgba(59, 130, 246, 0.08)', needs_dimensions: 'rgba(245, 158, 11, 0.08)' };
  const isInProgress = status === 'in_progress';
  return (
    <span style={{
      color: c[status] || 'var(--ink-faint)', fontWeight: 600, fontSize: 'var(--text-xs)',
      textTransform: 'uppercase', background: bg[status] || 'transparent',
      padding: '2px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 6,
      animation: isInProgress ? 'pulse-badge 1.5s ease-in-out infinite' : undefined,
    }}>
      {isInProgress && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'pulse-dot 1.5s ease-in-out infinite' }} />}
      {statusLabels[status] || status}
    </span>
  );
}
