import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { API_BASE, type ShopeeSeller, type CopyQueuedResponse, type ShopeeCopyLog, type ShopeeItemPreview } from '../lib/api';
import type { AuthUser } from '../hooks/useAuth';
import DimensionForm, { type Dimensions } from '../components/DimensionForm';
import { Card } from './CopyPage';
import { useToast } from '../components/Toast';

const LOGS_PAGE_SIZE = 50;

interface Props {
  shopeeSellers: ShopeeSeller[];
  headers: () => Record<string, string>;
  user: AuthUser | null;
}

/** Extract Shopee item ID from raw input (number or URL) */
function normalizeShopeeId(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  // shopee.com.br/product/SHOP_ID/ITEM_ID or i.SHOP_ID.ITEM_ID
  const urlMatch = t.match(/(?:shopee\.[^/]+\/(?:product\/\d+\/|[^/]+-i\.\d+\.)(\d+))/i);
  if (urlMatch) return urlMatch[1];
  // Pure number
  if (/^\d+$/.test(t)) return t;
  // Try last numeric segment from any URL-like string
  const lastNum = t.match(/(\d+)\s*$/);
  if (lastNum) return lastNum[1];
  return t;
}

function isDimensionError(log: ShopeeCopyLog): boolean {
  if (log.status === 'needs_dimensions') return true;
  if (log.status === 'error' && log.error_details) {
    return Object.values(log.error_details).some(
      msg => typeof msg === 'string' && (msg.toLowerCase().includes('dimenso') || msg.toLowerCase().includes('dimension') || msg.toLowerCase().includes('weight'))
    );
  }
  return false;
}

export default function ShopeeCopyPage({ shopeeSellers, headers, user }: Props) {
  const { toast } = useToast();

  // Form state
  const [itemIdsText, setItemIdsText] = useState('');
  const [resolvedSources, setResolvedSources] = useState<Record<string, string>>({});
  const [unresolvedIds, setUnresolvedIds] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [dedupMsg, setDedupMsg] = useState('');
  const [destinations, setDestinations] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const lastResolvedKey = useRef('');
  const pendingResolve = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Copy state
  const [copying, setCopying] = useState(false);

  // Preview state
  const [previews, setPreviews] = useState<ShopeeItemPreview[]>([]);
  const [, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Logs state
  const [logs, setLogs] = useState<ShopeeCopyLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [retryLogId, setRetryLogId] = useState<number | null>(null);

  const isAdmin = user?.role === 'admin';

  const sourceSellers = useMemo(() => {
    if (!user || isAdmin) return shopeeSellers;
    const allowed = new Set(user.permissions.filter(p => p.can_copy_from).map(p => p.seller_slug));
    return shopeeSellers.filter(s => allowed.has(s.slug));
  }, [shopeeSellers, user, isAdmin]);

  const destSellers = useMemo(() => {
    if (!user || isAdmin) return shopeeSellers;
    const allowed = new Set(user.permissions.filter(p => p.can_copy_to).map(p => p.seller_slug));
    return shopeeSellers.filter(s => allowed.has(s.slug));
  }, [shopeeSellers, user, isAdmin]);

  const itemIds = itemIdsText.split(/[\n,]+/).map(normalizeShopeeId).filter(id => id.length > 0);

  // Derive source slugs from resolved items
  const sourceSlugs = [...new Set(Object.values(resolvedSources))];
  const validDests = destSellers.filter(s => s.token_valid && !sourceSlugs.includes(s.slug));

  // Group resolved items by source
  const sourceGroups: Record<string, string[]> = {};
  for (const [itemId, slug] of Object.entries(resolvedSources)) {
    (sourceGroups[slug] ||= []).push(itemId);
  }

  const resolvedCount = Object.keys(resolvedSources).length;
  const canCopy = resolvedCount > 0 && destinations.length > 0 && !copying;
  const totalOps = resolvedCount * destinations.length;

  // --- Resolve ---
  const resolveAll = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const key = ids.join(',');
    if (key === lastResolvedKey.current) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setResolving(true);
    setResolveError('');
    setResolvedSources({});
    setUnresolvedIds([]);
    setDestinations([]);
    setConfirming(false);
    try {
      const res = await fetch(`${API_BASE}/api/shopee/copy/resolve-sellers`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ item_ids: ids }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro ao detectar lojas' }));
        setResolveError(err.detail);
        return;
      }
      const data: {
        results: { item_id: string; shop_slug: string }[];
        errors: { item_id: string; error: string }[];
      } = await res.json();

      const sources: Record<string, string> = {};
      const deniedSlugs: string[] = [];
      for (const r of data.results) {
        const hasPermission = sourceSellers.some(s => s.slug === r.shop_slug);
        if (hasPermission) {
          sources[r.item_id] = r.shop_slug;
        } else if (!deniedSlugs.includes(r.shop_slug)) {
          deniedSlugs.push(r.shop_slug);
        }
      }
      setResolvedSources(sources);
      lastResolvedKey.current = key;
      setUnresolvedIds(data.errors.map(e => e.item_id));

      if (deniedSlugs.length > 0) {
        setResolveError(`Sem permissao de copia a partir da(s) loja(s): ${deniedSlugs.join(', ')}`);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setResolveError(String(e));
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }, [headers, sourceSellers]);

  const normalizeAndResolve = useCallback(() => {
    const normalized = itemIdsText.split(/[\n,]+/).map(normalizeShopeeId).filter(Boolean);
    const unique = [...new Set(normalized)];
    const removedCount = normalized.length - unique.length;
    setDedupMsg(removedCount > 0 ? `${removedCount} duplicata(s) removida(s)` : '');
    const text = unique.join('\n');
    if (text !== itemIdsText.trim()) setItemIdsText(text);
    if (unique.length > 0) resolveAll(unique);
  }, [itemIdsText, resolveAll]);

  // Auto-resolve after paste
  useEffect(() => {
    if (pendingResolve.current && itemIdsText.trim()) {
      pendingResolve.current = false;
      normalizeAndResolve();
    }
  }, [itemIdsText, normalizeAndResolve]);

  // Clear state when IDs are cleared
  useEffect(() => {
    if (!itemIdsText.trim()) {
      setResolvedSources({});
      setUnresolvedIds([]);
      setResolveError('');
      lastResolvedKey.current = '';
      setDestinations([]);
    }
  }, [itemIdsText]);

  // --- Preview ---
  const handlePreview = useCallback(async () => {
    const entries = Object.entries(resolvedSources);
    if (!entries.length) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviews([]);
    try {
      const results = await Promise.all(
        entries.map(async ([rawId]) => {
          try {
            const res = await fetch(`${API_BASE}/api/shopee/copy/preview/${rawId}`, { headers: headers(), cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json() as ShopeeItemPreview;
          } catch { return null; }
        })
      );
      const valid = results.filter((r): r is ShopeeItemPreview => r !== null);
      if (valid.length === 0) { setPreviewError('Nenhum item encontrado'); return; }
      setPreviews(valid);
    } catch (e) { setPreviewError(String(e)); }
    finally { setPreviewLoading(false); }
  }, [resolvedSources, headers]);

  // Close preview when resolved items clear
  useEffect(() => {
    if (Object.keys(resolvedSources).length === 0) {
      setPreviews([]);
      setPreviewOpen(false);
    }
  }, [resolvedSources]);

  // --- Logs ---
  const loadLogs = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: '0' });
    if (statusFilter) params.set('status', statusFilter);
    try {
      const res = await fetch(`${API_BASE}/api/shopee/copy/logs?${params}`, { headers: headers(), cache: 'no-store' });
      if (res.ok) {
        const data: ShopeeCopyLog[] = await res.json();
        setLogs(data);
        setHasMoreLogs(data.length === LOGS_PAGE_SIZE);
        setLogsLoaded(true);
      }
    } catch (e) { console.error('Failed to load Shopee logs:', e); }
  }, [headers, statusFilter]);

  const loadMoreLogs = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(LOGS_PAGE_SIZE), offset: String(logs.length) });
    if (statusFilter) params.set('status', statusFilter);
    try {
      const res = await fetch(`${API_BASE}/api/shopee/copy/logs?${params}`, { headers: headers(), cache: 'no-store' });
      if (res.ok) {
        const data: ShopeeCopyLog[] = await res.json();
        setLogs(prev => [...prev, ...data]);
        setHasMoreLogs(data.length === LOGS_PAGE_SIZE);
      }
    } catch (e) { console.error('Failed to load more Shopee logs:', e); }
  }, [headers, statusFilter, logs.length]);

  // Reset logs on filter change
  useEffect(() => {
    setLogs([]);
    setLogsLoaded(false);
    setRetryLogId(null);
  }, [statusFilter]);

  // Initial load
  useEffect(() => {
    if (!logsLoaded) {
      void loadLogs();
    }
  }, [logsLoaded, loadLogs]);

  // Poll while pending
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasPending = logs.some(l => l.status === 'in_progress' || l.status === 'pending');

  useEffect(() => {
    if (hasPending) {
      pollRef.current = setInterval(loadLogs, 5000);
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [hasPending, loadLogs]);

  // --- Copy ---
  const handleCopy = useCallback(async () => {
    setCopying(true);

    // Group by source and send one request per source
    const groups = Object.entries(sourceGroups).map(([source, ids]) => ({ source, itemIds: ids }));

    let totalQueued = 0;

    for (const group of groups) {
      try {
        const res = await fetch(`${API_BASE}/api/shopee/copy`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ source: group.source, destinations, item_ids: group.itemIds }),
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
      toast(`${totalQueued} item(s) enfileirado(s). Acompanhe no historico abaixo.`, 'success');
    }
    setCopying(false);
    void loadLogs();
  }, [headers, loadLogs, destinations, resolvedSources, sourceGroups, toast]);

  // --- Log retry ---
  const handleLogRetry = useCallback(async (_logId: number, log: ShopeeCopyLog, dims: Dimensions) => {
    try {
      const res = await fetch(`${API_BASE}/api/shopee/copy/with-dimensions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          source: log.source_seller,
          destinations: log.dest_sellers,
          item_id: log.source_item_id,
          dimensions: dims,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
        toast(err.detail, 'error');
        return;
      }
      setRetryLogId(null);
      toast('Copia reenviada com as dimensoes informadas.', 'success');
      void loadLogs();
    } catch (e) {
      toast(String(e), 'error');
    }
  }, [headers, loadLogs, toast]);

  // --- Form handlers ---
  const toggleDest = (slug: string) => {
    setDestinations(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]);
    setConfirming(false);
  };

  const selectAllDests = () => {
    const allSlugs = validDests.map(s => s.slug);
    const allSelected = allSlugs.every(s => destinations.includes(s));
    setDestinations(allSelected ? [] : allSlugs);
    setConfirming(false);
  };

  const allSellers = [...sourceSellers, ...destSellers];
  const sellerName = (slug: string) => allSellers.find(s => s.slug === slug)?.name || slug;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCopy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    await handleCopy();
  };

  const step1Done = resolvedCount > 0;
  const step2Done = destinations.length > 0;

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
          Nenhuma loja Shopee disponivel. Peca ao admin para liberar acesso ou conectar uma loja.
        </p>
      </div>
    );
  }

  const filterTabs = [
    { key: '', label: 'Todos' },
    { key: 'in_progress', label: 'Em andamento' },
    { key: 'success', label: 'Sucesso' },
    { key: 'partial', label: 'Parcial' },
    { key: 'error', label: 'Erros' },
    { key: 'needs_dimensions', label: 'Aguardando dimensoes' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Copy Form */}
      <form onSubmit={handleSubmit} className="card" style={{
        background: 'var(--surface)',
        borderRadius: 8,
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
      }}>
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, letterSpacing: 'var(--tracking-tight)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{
            background: '#EE4D2D',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 3,
            letterSpacing: '0.04em',
          }}>SHOPEE</span>
          Copiar Produtos
        </h3>

        {/* Step 1: Item IDs */}
        <Field label="IDs dos Produtos" step={1} done={step1Done}>
          <textarea
            value={itemIdsText}
            onChange={e => { setItemIdsText(e.target.value); setConfirming(false); }}
            onPaste={e => {
              e.preventDefault();
              const pasted = e.clipboardData.getData('text').trim();
              if (!pasted) return;
              const ta = e.currentTarget;
              const start = ta.selectionStart;
              const end = ta.selectionEnd;
              const before = itemIdsText.slice(0, start);
              const after = itemIdsText.slice(end);
              const needsBefore = before.length > 0 && !before.endsWith('\n');
              const newText = before + (needsBefore ? '\n' : '') + pasted + '\n' + after;
              setItemIdsText(newText);
              setConfirming(false);
              pendingResolve.current = true;
              const cursorPos = before.length + (needsBefore ? 1 : 0) + pasted.length + 1;
              requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = cursorPos;
              });
            }}
            onBlur={normalizeAndResolve}
            placeholder={"Cole os IDs dos produtos (um por linha)\n1234567890\nhttps://shopee.com.br/product/123/456"}
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
          {dedupMsg && (
            <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
              {dedupMsg}
            </p>
          )}
          {resolving && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>
              <span className="spinner spinner-sm" />
              Detectando loja(s) de origem...
            </div>
          )}
          {resolveError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <p style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)', fontWeight: 500, margin: 0 }}>
                {resolveError}
              </p>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { lastResolvedKey.current = ''; normalizeAndResolve(); }}
                style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', whiteSpace: 'nowrap' }}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {resolvedCount > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-faint)',
              flexWrap: 'wrap',
            }}>
              {sourceSlugs.length === 1 ? 'Origem:' : 'Origens:'}
              {sourceSlugs.map(slug => (
                <span key={slug} style={{
                  padding: '2px 8px',
                  background: '#EE4D2D',
                  color: '#fff',
                  borderRadius: 4,
                  fontWeight: 600,
                }}>
                  {sellerName(slug)} ({sourceGroups[slug].length})
                </span>
              ))}
              <span>{resolvedCount} produto(s)</span>
            </div>
          )}
          {unresolvedIds.length > 0 && (
            <p style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)', fontWeight: 500 }}>
              {unresolvedIds.length} ID(s) nao encontrado(s): {unresolvedIds.join(', ')}
            </p>
          )}
        </Field>

        {/* Step 2: Destinations */}
        <Field
          label="Lojas de Destino"
          step={2}
          done={step2Done}
          action={validDests.length > 0 && resolvedCount > 0 ? (
            <button
              type="button"
              onClick={selectAllDests}
              disabled={resolving}
              style={{ background: 'none', color: 'var(--positive)', fontSize: 'var(--text-xs)', fontWeight: 500, padding: 0, opacity: resolving ? 0.5 : 1 }}
            >
              {validDests.every(s => destinations.includes(s.slug)) ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
          ) : undefined}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {resolvedCount > 0 ? (
              validDests.length > 0 ? (
                validDests.map(seller => {
                  const on = destinations.includes(seller.slug);
                  return (
                    <button key={seller.slug} type="button" onClick={() => toggleDest(seller.slug)} disabled={resolving} className="chip-toggle" style={{
                      padding: '6px 12px',
                      fontSize: 'var(--text-xs)',
                      fontWeight: on ? 600 : 400,
                      background: on ? '#EE4D2D' : 'rgba(238, 77, 45, 0.06)',
                      color: on ? '#fff' : 'var(--ink-muted)',
                      border: `1px solid ${on ? '#EE4D2D' : 'rgba(238, 77, 45, 0.2)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      ...(resolving ? { opacity: 0.5, pointerEvents: 'none' as const } : {}),
                    }}>
                      {on && <span style={{ fontSize: 10 }}>{'\u2713'}</span>}
                      {seller.name || seller.slug}
                    </button>
                  );
                })
              ) : (
                <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>Nenhuma outra loja disponivel</p>
              )
            ) : (
              <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>
                {itemIds.length > 0 ? 'Aguardando deteccao das lojas de origem...' : 'Cole os IDs acima para detectar as lojas de origem'}
              </p>
            )}
          </div>
          {destinations.length > 0 && resolvedCount > 0 && (
            <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
              {resolvedCount} produto(s) x {destinations.length} destino(s) = <b style={{ color: 'var(--ink)' }}>{totalOps} copia(s)</b>
            </p>
          )}
        </Field>

        {/* Confirmation bar */}
        {confirming && (
          <div className="confirm-bar">
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', flex: 1 }}>
              Confirma copiar <b>{totalOps}</b> produto(s)?
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
            {copying ? 'Copiando...' : confirming ? 'Confirmar' : `Copiar${totalOps > 0 ? ` (${totalOps})` : ''}`}
          </button>

          {resolvedCount > 0 && (
            <button type="button" onClick={handlePreview} className="btn-ghost" style={{
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--text-xs)',
            }}>
              Preview
            </button>
          )}
        </div>
      </form>

      {/* Preview */}
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
              <div key={p.item_id} className="animate-in" style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--paper)',
                borderRadius: 6,
                border: '1px solid var(--line)',
              }}>
                {p.image_url && (
                  <img src={p.image_url} alt="" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', background: 'var(--surface)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 500, fontSize: 'var(--text-xs)', lineHeight: 'var(--leading-tight)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.item_name}</p>
                  <p style={{ color: '#EE4D2D', fontWeight: 700, fontSize: 'var(--text-sm)', marginTop: 2 }}>
                    R$ {p.original_price?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexShrink: 0 }}>
                  <span>{p.image_count} fotos</span>
                  <span>{p.model_count} var.</span>
                  <span>{p.weight}kg</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
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
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
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
                        onRetrySubmit={(dims) => handleLogRetry(log.id, log, dims)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

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

// --- Sub-components ---

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
              background: done ? '#EE4D2D' : 'var(--line)',
              color: done ? '#fff' : 'var(--ink-faint)',
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

function LogRow({ log, isRetrying, onRetryClick, onRetrySubmit }: {
  log: ShopeeCopyLog;
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
        <td style={td}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {log.source_item_thumbnail && (
              <img src={log.source_item_thumbnail} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', background: 'var(--paper)', flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', display: 'block' }}>{log.source_item_id}</span>
              {log.source_item_title && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                  {log.source_item_title}
                </span>
              )}
            </div>
          </div>
        </td>
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

const statusLabels: Record<string, string> = {
  needs_dimensions: 'Aguardando dimensoes',
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
