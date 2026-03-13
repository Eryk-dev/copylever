import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  API_BASE,
  type Seller,
  type ShopeeSeller,
  type CopyQueuedResponse,
  type CopyLog,
  type CorrectionDetails,
  type ItemPreview,
} from '../lib/api';
import type { AuthUser } from '../hooks/useAuth';
import { SHOPEE_ENABLED } from '../lib/features';
import CopyForm, { type CopyGroup, type Platform } from '../components/CopyForm';
import CorrectionForm from '../components/CorrectionForm';
import StatusBadge from '../components/StatusBadge';
import { getCorrectionDetails, isCorrectionPending } from '../lib/helpers';
import { useToast } from '../components/Toast';

const LOGS_PAGE_SIZE = 50;

type UnifiedLog = CopyLog & { platform: Platform };
type CorrectionValues = Record<string, string | number>;

interface PendingCorrectionGroup {
  key: string;
  platform: Platform;
  sourceSeller: string;
  sku: string | null;
  summary: string;
  correction: CorrectionDetails;
  logs: UnifiedLog[];
  itemIds: string[];
  destinations: string[];
}

interface Props {
  sellers: Seller[];
  shopeeSellers: ShopeeSeller[];
  headers: () => Record<string, string>;
  user: AuthUser | null;
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

  const logsAbortRef = useRef<AbortController | null>(null);

  const loadLogs = useCallback(async () => {
    logsAbortRef.current?.abort();
    const controller = new AbortController();
    logsAbortRef.current = controller;
    const params = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: '0' });
    if (statusFilter) params.set('status', statusFilter);
    try {
      const signal = controller.signal;
      const fetches: Promise<Response>[] = [
        fetch(`${API_BASE}/api/copy/logs?${params}`, { headers: headers(), cache: 'no-store', signal }),
      ];
      if (SHOPEE_ENABLED) {
        fetches.push(fetch(`${API_BASE}/api/shopee/copy/logs?${params}`, { headers: headers(), cache: 'no-store', signal }));
      }
      const [mlRes, shopeeRes] = await Promise.all(fetches);
      const mlLogs: CopyLog[] = mlRes.ok ? await mlRes.json() : [];
      const shopeeLogs: CopyLog[] = (SHOPEE_ENABLED && shopeeRes?.ok) ? await shopeeRes.json() : [];
      const merged: UnifiedLog[] = [
        ...mlLogs.map(l => ({ ...l, platform: 'ml' as Platform })),
        ...shopeeLogs.map(l => ({ ...l, platform: 'shopee' as Platform })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
       .slice(0, LOGS_PAGE_SIZE);
      setLogs(merged);
      setHasMoreLogs(mlLogs.length === LOGS_PAGE_SIZE || shopeeLogs.length === LOGS_PAGE_SIZE);
      setLogsLoaded(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error('Failed to load logs:', e);
    }
  }, [headers, statusFilter]);

  const loadMoreLogs = useCallback(async () => {
    // For merged logs, load more from both and merge
    const mlCount = logs.filter(l => l.platform === 'ml').length;
    const shopeeCount = logs.filter(l => l.platform === 'shopee').length;
    const mlParams = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: String(mlCount) });
    const shopeeParams = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: String(shopeeCount) });
    if (statusFilter) { mlParams.set('status', statusFilter); shopeeParams.set('status', statusFilter); }
    try {
      const moreFetches: Promise<Response>[] = [
        fetch(`${API_BASE}/api/copy/logs?${mlParams}`, { headers: headers(), cache: 'no-store' }),
      ];
      if (SHOPEE_ENABLED) {
        moreFetches.push(fetch(`${API_BASE}/api/shopee/copy/logs?${shopeeParams}`, { headers: headers(), cache: 'no-store' }));
      }
      const [mlRes, shopeeRes] = await Promise.all(moreFetches);
      const mlLogs: CopyLog[] = mlRes.ok ? await mlRes.json() : [];
      const shopeeLogs: CopyLog[] = (SHOPEE_ENABLED && shopeeRes?.ok) ? await shopeeRes.json() : [];
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

    try {
      for (const group of groups) {
        const dests = group.platform === 'ml' ? mlDestSlugs : shopeeDestSlugs;
        if (dests.length === 0) continue;

        const endpoint = group.platform === 'ml' ? '/api/copy' : '/api/shopee/copy';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ source: group.source, destinations: dests, item_ids: group.itemIds }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
            toast(err.detail, 'error');
            continue;
          }
          const data: CopyQueuedResponse = await res.json();
          totalQueued += data.total;
        } catch (e) {
          clearTimeout(timeoutId);
          if (e instanceof DOMException && e.name === 'AbortError') {
            toast('Tempo limite esgotado ao enviar a cópia. Tente novamente.', 'error');
          } else {
            toast(String(e), 'error');
          }
        }
      }

      if (totalQueued > 0) {
        toast(`${totalQueued} item(s) enfileirado(s). Acompanhe no histórico abaixo.`, 'success');
      }
    } finally {
      setCopying(false);
      void loadLogs();
    }
  }, [headers, loadLogs, toast, sellers, shopeeSellers]);

  const handlePreview = useCallback(async (items: Array<[string, string, Platform]>) => {
    if (!items.length) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviews([]);

    const PREVIEW_TIMEOUT_MS = 20000;
    const BATCH_SIZE = 5;

    const fetchOne = async ([rawId, seller, platform]: [string, string, Platform]): Promise<ItemPreview | null> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
      try {
        if (platform === 'ml') {
          let itemId = rawId.trim();
          const m = itemId.match(/MLB[-]?(\d+)/i);
          if (m) itemId = `MLB${m[1]}`;
          else if (/^\d+$/.test(itemId)) itemId = `MLB${itemId}`;
          const res = await fetch(
            `${API_BASE}/api/copy/preview/${itemId}?seller=${encodeURIComponent(seller)}`,
            { headers: headers(), cache: 'no-store', signal: controller.signal },
          );
          clearTimeout(timeoutId);
          if (!res.ok) return null;
          return await res.json() as ItemPreview;
        } else {
          const res = await fetch(
            `${API_BASE}/api/shopee/copy/preview/${rawId}`,
            { headers: headers(), cache: 'no-store', signal: controller.signal },
          );
          clearTimeout(timeoutId);
          if (!res.ok) return null;
          const data = await res.json();
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
      } catch (e) {
        clearTimeout(timeoutId);
        return null;
      }
    };

    try {
      const allResults: Array<ItemPreview | null> = [];
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(fetchOne));
        allResults.push(...batchResults);
      }
      const valid = allResults.filter((r): r is ItemPreview => r !== null);
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

  const handleCorrectionRetry = useCallback(async (log: UnifiedLog, values: CorrectionValues) => {
    try {
      const correction = getCorrectionDetails(log);
      if (!correction) {
        toast('Este log nao possui um formulario de correcao disponível.', 'error');
        return;
      }

      const endpoint = correction.kind === 'dimensions' && log.platform === 'shopee'
        ? '/api/shopee/copy/with-dimensions'
        : '/api/copy/retry-corrections';
      const body = endpoint === '/api/copy/retry-corrections'
        ? { log_ids: [log.id], values }
        : { source: log.source_seller, destinations: log.dest_sellers, item_id: String(log.source_item_id), dimensions: values };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
        toast(err.detail, 'error');
        return;
      }
      setRetryLogId(null);
      toast('Cópia reenviada com a correção informada.', 'success');
      void loadLogs();
    } catch (e) {
      toast(String(e), 'error');
    }
  }, [headers, loadLogs, toast]);

  const handleSimpleRetry = useCallback(async (log: UnifiedLog) => {
    try {
      const res = await fetch(`${API_BASE}/api/copy/retry`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ log_id: log.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
        toast(err.detail, 'error');
        return;
      }
      toast('Copia reenviada. Acompanhe no historico.', 'success');
      void loadLogs();
    } catch (e) {
      toast(String(e), 'error');
    }
  }, [headers, loadLogs, toast]);

  const correctionGroups = useMemo<PendingCorrectionGroup[]>(() => {
    const groups = new Map<string, PendingCorrectionGroup>();

    for (const log of logs) {
      if (!isCorrectionPending(log)) continue;
      const correction = getCorrectionDetails(log);
      if (!correction) continue;

      const sku = log.source_item_sku || null;
      const batchKey = log.platform === 'shopee'
        ? log.source_item_id
        : (sku || log.source_item_id);
      const key = [
        log.platform,
        log.source_seller,
        batchKey,
        correction.group_key,
      ].join('::');

      const group = groups.get(key) || {
        key,
        platform: log.platform,
        sourceSeller: log.source_seller,
        sku,
        summary: correction.summary,
        correction,
        logs: [],
        itemIds: [],
        destinations: [],
      };

      group.logs.push(log);
      if (!group.itemIds.includes(log.source_item_id)) group.itemIds.push(log.source_item_id);
      for (const dest of log.dest_sellers || []) {
        if (!group.destinations.includes(dest)) group.destinations.push(dest);
      }

      groups.set(key, group);
    }

    return [...groups.values()].sort(
      (a, b) => new Date(b.logs[0]?.created_at || 0).getTime() - new Date(a.logs[0]?.created_at || 0).getTime()
    );
  }, [logs]);

  const handleCorrectionGroupSubmit = useCallback(async (group: PendingCorrectionGroup, values: CorrectionValues) => {
    try {
      const endpoint = group.platform === 'shopee' && group.correction.kind === 'dimensions'
        ? '/api/shopee/copy/with-dimensions'
        : '/api/copy/retry-corrections';

      const body = endpoint === '/api/copy/retry-corrections'
        ? { log_ids: group.logs.map(log => log.id), values }
        : { source: group.sourceSeller, destinations: group.destinations, item_id: String(group.itemIds[0]), dimensions: values };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
        toast(err.detail, 'error');
        return;
      }

      const data = await res.json().catch(() => null) as {
        success?: number;
        errors?: number;
        needs_correction?: number;
      } | null;
      const successCount = data?.success || 0;
      const remainingCount = (data?.errors || 0) + (data?.needs_correction || 0);
      if (successCount > 0 && remainingCount === 0) {
        toast(`${successCount} anúncio(s) copiado(s) após a correção.`, 'success');
      } else if (successCount > 0) {
        toast(`${successCount} anúncio(s) copiado(s), mas ainda restam ${remainingCount} pendência(s).`, 'success');
      } else {
        toast('A correção foi enviada, mas nenhum anúncio foi copiado nesta tentativa.', 'error');
      }
      void loadLogs();
    } catch (e) {
      toast(String(e), 'error');
    }
  }, [headers, loadLogs, toast]);

  // Merge correction groups into the log list for non-needs_correction tabs
  const mergedLogItems = useMemo(() => {
    if (statusFilter === 'needs_correction') return [];

    const groupedLogIds = new Set<string>();
    const items: Array<
      | { type: 'group'; group: PendingCorrectionGroup; date: number }
      | { type: 'log'; log: UnifiedLog; date: number }
    > = [];

    // Add correction groups as single items, track their log IDs
    for (const group of correctionGroups) {
      for (const log of group.logs) {
        groupedLogIds.add(`${log.platform}-${log.id}`);
      }
      items.push({
        type: 'group',
        group,
        date: new Date(group.logs[0]?.created_at || 0).getTime(),
      });
    }

    // Add individual logs that are NOT part of any correction group
    for (const log of logs) {
      if (!groupedLogIds.has(`${log.platform}-${log.id}`)) {
        items.push({
          type: 'log',
          log,
          date: new Date(log.created_at).getTime(),
        });
      }
    }

    items.sort((a, b) => b.date - a.date);
    return items;
  }, [logs, correctionGroups, statusFilter]);

  const hasInProgress = logs.some(l => l.status === 'in_progress');

  const loadLogsRef = useRef(loadLogs);
  useEffect(() => { loadLogsRef.current = loadLogs; }, [loadLogs]);

  useEffect(() => {
    if (!hasInProgress) return;
    const id = setInterval(() => { void loadLogsRef.current(); }, 5000);
    return () => clearInterval(id);
  }, [hasInProgress]);

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
    { key: 'needs_correction', label: 'Aguardando correções' },
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
                {statusFilter === 'needs_correction' ? (
                  correctionGroups.map(group => (
                    <PendingCorrectionCard
                      key={group.key}
                      group={group}
                      onSubmit={values => handleCorrectionGroupSubmit(group, values)}
                    />
                  ))
                ) : (
                  mergedLogItems.map(item =>
                    item.type === 'group' ? (
                      <PendingCorrectionCard
                        key={item.group.key}
                        group={item.group}
                        onSubmit={values => handleCorrectionGroupSubmit(item.group, values)}
                      />
                    ) : (
                      <LogCard
                        key={`${item.log.platform}-${item.log.id}`}
                        log={item.log}
                        isRetrying={retryLogId === item.log.id && retryPlatform === item.log.platform}
                        onRetryClick={() => {
                          if (retryLogId === item.log.id && retryPlatform === item.log.platform) {
                            setRetryLogId(null);
                          } else {
                            setRetryLogId(item.log.id);
                            setRetryPlatform(item.log.platform);
                          }
                        }}
                        onRetrySubmit={(values) => handleCorrectionRetry(item.log, values)}
                        onSimpleRetry={() => handleSimpleRetry(item.log)}
                      />
                    )
                  )
                )}
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

function LogCard({ log, isRetrying, onRetryClick, onRetrySubmit, onSimpleRetry }: {
  log: UnifiedLog;
  isRetrying: boolean;
  onRetryClick: () => void;
  onRetrySubmit: (values: CorrectionValues) => void;
  onSimpleRetry: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const correction = getCorrectionDetails(log);
  const canRetry = Boolean(correction);
  const canSimpleRetry = !canRetry && (log.status === 'error' || log.status === 'partial');
  const destEntries = log.dest_item_ids ? Object.entries(log.dest_item_ids) : [];
  const errorEntries = log.error_details ? Object.entries(log.error_details) : [];
  const isShopee = log.platform === 'shopee';

  const accentMap: Record<string, string> = {
    success: 'var(--success)', error: 'var(--danger)', partial: 'var(--warning)',
    pending: 'var(--ink-faint)', in_progress: 'var(--info)', needs_dimensions: 'var(--warning)', needs_correction: 'var(--warning)',
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
                {isRetrying ? 'Cancelar' : 'Corrigir e reenviar'}
              </button>
            )}
            {canSimpleRetry && (
              <button
                disabled={retrying}
                onClick={async () => {
                  setRetrying(true);
                  try { await onSimpleRetry(); } finally { setRetrying(false); }
                }}
                style={{
                  marginTop: 'var(--space-2)', padding: '4px 12px', borderRadius: 5,
                  fontSize: 'var(--text-xs)', fontWeight: 600,
                  background: retrying ? 'var(--surface)' : 'var(--info-bg, rgba(59,130,246,0.08))',
                  color: retrying ? 'var(--ink-faint)' : 'var(--info, #3b82f6)',
                  border: `1px solid ${retrying ? 'var(--line)' : 'rgba(59,130,246,0.2)'}`,
                  cursor: retrying ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
                  opacity: retrying ? 0.7 : 1,
                }}
              >
                {retrying ? 'Reenviando...' : 'Retentar'}
              </button>
            )}
          </div>
        </div>
      </div>

      {isRetrying && correction && (
        <div className="animate-in" style={{
          background: 'var(--attention-bg)', border: '1px solid rgba(217, 119, 6, 0.12)',
          borderRadius: 10, padding: 'var(--space-3) var(--space-4)',
        }}>
          <CorrectionForm
            title="Correção necessária"
            description={
              <>
                {log.source_item_sku && (
                  <>
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>SKU: {log.source_item_sku}</span>
                    {' — '}
                  </>
                )}
                <span style={{ fontFamily: 'var(--font-mono)' }}>{log.source_item_id}</span>
                {' '}&rarr; {(log.dest_sellers || []).join(', ')}
                <br />
                {correction.summary}
              </>
            }
            fields={correction.fields}
            submitLabel="Aplicar correção e copiar"
            submittingLabel="Aplicando..."
            onSubmit={onRetrySubmit}
          />
        </div>
      )}
    </>
  );
}

function PendingCorrectionCard({
  group,
  onSubmit,
}: {
  group: PendingCorrectionGroup;
  onSubmit: (values: CorrectionValues) => void | Promise<void>;
}) {
  const primaryLog = group.logs[0];
  const isShopee = group.platform === 'shopee';

  return (
    <div className="animate-in" style={{
      background: 'var(--paper)',
      borderRadius: 10,
      border: '1px solid var(--line)',
      borderLeftWidth: 3,
      borderLeftColor: 'var(--warning)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        {primaryLog?.source_item_thumbnail ? (
          <img src={primaryLog.source_item_thumbnail} alt="" style={{
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
              {group.summary}
            </span>
            <StatusBadge status="needs_correction" />
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            marginTop: 3, fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexWrap: 'wrap',
          }}>
            {group.sku && (
              <>
                <code style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                  background: 'var(--surface)', padding: '0 5px', borderRadius: 3, lineHeight: '18px',
                }}>
                  SKU {group.sku}
                </code>
                <span style={{ opacity: 0.4 }}>&middot;</span>
              </>
            )}
            <span>{group.sourceSeller} &rarr; {group.destinations.join(', ')}</span>
            <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {new Date(primaryLog.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>

          <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {group.logs.map(log => (
              <div key={`${log.platform}-${log.id}`} style={{
                display: 'flex',
                gap: 'var(--space-2)',
                alignItems: 'center',
                fontSize: 'var(--text-xs)',
                color: 'var(--ink-faint)',
                flexWrap: 'wrap',
              }}>
                <code style={{ fontFamily: 'var(--font-mono)' }}>{log.source_item_id}</code>
                <span>•</span>
                <span>{log.dest_sellers.join(', ')}</span>
                {log.error_details && Object.keys(log.error_details).length > 0 && (
                  <>
                    <span>•</span>
                    <span style={{ color: 'var(--danger)' }}>
                      {Object.values(log.error_details)[0]}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 'var(--space-3)' }}>
            <CorrectionForm
              title="Correção necessária"
              description={
                <>
                  {group.itemIds.length === 1 ? (
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{group.itemIds[0]}</span>
                  ) : (
                    <span>{group.itemIds.length} anúncio(s): <span style={{ fontFamily: 'var(--font-mono)' }}>{group.itemIds.join(', ')}</span></span>
                  )}
                  {' '}&rarr; {group.destinations.join(', ')}
                  <br />
                  Informe a correção uma vez para reaplicar em todo o grupo com o mesmo SKU e problema.
                </>
              }
              fields={group.correction.fields}
              submitLabel="Aplicar correção e copiar"
              submittingLabel="Aplicando..."
              onSubmit={onSubmit}
            />
          </div>
        </div>
      </div>
    </div>
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
