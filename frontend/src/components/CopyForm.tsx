import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { API_BASE, type Seller, type ShopeeSeller } from '../lib/api';
import { SHOPEE_ENABLED } from '../lib/features';

export type Platform = 'ml' | 'shopee';

export interface CopyGroup {
  platform: Platform;
  source: string;
  itemIds: string[];
}

interface ResolvedSource {
  slug: string;
  platform: Platform;
}

interface Props {
  mlSourceSellers: Seller[];
  mlDestSellers: Seller[];
  shopeeSourceSellers: ShopeeSeller[];
  shopeeDestSellers: ShopeeSeller[];
  headers: () => Record<string, string>;
  onCopy: (groups: CopyGroup[], destinations: string[]) => Promise<void>;
  onPreview: (items: Array<[string, string, Platform]>) => void;
  onResolvedChange?: (items: Array<[string, string, Platform]>) => void;
  copying: boolean;
}

/** Classify raw input → display form + platform candidates for resolve */
function classifyInput(raw: string): {
  display: string;
  hint: Platform | null;
  mlId: string | null;
  shopeeId: string | null;
} {
  const t = raw.trim();
  if (!t) return { display: '', hint: null, mlId: null, shopeeId: null };

  // Explicit ML (MLB prefix or ML URL)
  const mlMatch = t.match(/MLB[-]?(\d+)/i);
  if (mlMatch) {
    const id = `MLB${mlMatch[1]}`;
    return { display: id, hint: 'ml', mlId: id, shopeeId: null };
  }
  if (/mercadoli/i.test(t)) {
    const numMatch = t.match(/(\d+)/);
    if (numMatch) {
      const id = `MLB${numMatch[1]}`;
      return { display: id, hint: 'ml', mlId: id, shopeeId: null };
    }
  }

  // Explicit Shopee URL
  if (SHOPEE_ENABLED && /shopee/i.test(t)) {
    const urlMatch = t.match(/(?:product\/\d+\/|i\.\d+\.)(\d+)/i);
    if (urlMatch) return { display: urlMatch[1], hint: 'shopee', mlId: null, shopeeId: urlMatch[1] };
    const lastNum = t.match(/(\d+)\s*$/);
    if (lastNum) return { display: lastNum[1], hint: 'shopee', mlId: null, shopeeId: lastNum[1] };
  }

  // Pure number → ambiguous (could be ML or Shopee) when Shopee is enabled, otherwise ML only
  if (/^\d+$/.test(t)) {
    return { display: t, hint: SHOPEE_ENABLED ? null : 'ml', mlId: `MLB${t}`, shopeeId: SHOPEE_ENABLED ? t : null };
  }

  return { display: t, hint: null, mlId: null, shopeeId: null };
}

export default function CopyForm({
  mlSourceSellers, mlDestSellers, shopeeSourceSellers, shopeeDestSellers,
  headers, onCopy, onPreview, onResolvedChange, copying,
}: Props) {
  const [itemIdsText, setItemIdsText] = useState('');
  const [resolvedSources, setResolvedSources] = useState<Record<string, ResolvedSource>>({});
  const [unresolvedIds, setUnresolvedIds] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [dedupMsg, setDedupMsg] = useState('');
  const [destinations, setDestinations] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const lastResolvedKey = useRef('');
  const pendingResolve = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const idHints = useRef<Record<string, { hint: Platform | null; mlId: string | null; shopeeId: string | null }>>({});

  const hasML = mlSourceSellers.length > 0;
  const hasShopee = shopeeSourceSellers.length > 0;

  const displayIds = itemIdsText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

  // Which platforms are present in resolved items
  const resolvedPlatforms = useMemo(() => {
    const p = new Set<Platform>();
    for (const r of Object.values(resolvedSources)) p.add(r.platform);
    return p;
  }, [resolvedSources]);

  const isMixed = resolvedPlatforms.size > 1;

  // Source slugs per platform
  const mlSourceSlugs = [...new Set(Object.values(resolvedSources).filter(r => r.platform === 'ml').map(r => r.slug))];
  const shopeeSourceSlugs = [...new Set(Object.values(resolvedSources).filter(r => r.platform === 'shopee').map(r => r.slug))];

  // Valid destinations filtered by platform + exclude sources
  const validMlDests = mlDestSellers.filter(s => s.token_valid && !mlSourceSlugs.includes(s.slug));
  const validShopeeDests = shopeeDestSellers.filter(s => s.token_valid && !shopeeSourceSlugs.includes(s.slug));

  // Destination options to show (only platforms present in resolved items)
  const destOptions = useMemo(() => {
    const opts: Array<{ slug: string; name: string; platform: Platform }> = [];
    if (resolvedPlatforms.has('ml')) {
      for (const s of validMlDests) opts.push({ slug: s.slug, name: s.name || s.slug, platform: 'ml' });
    }
    if (resolvedPlatforms.has('shopee')) {
      for (const s of validShopeeDests) opts.push({ slug: s.slug, name: s.name || s.slug, platform: 'shopee' });
    }
    return opts;
  }, [resolvedPlatforms, validMlDests, validShopeeDests]);

  // Group resolved items by platform:source
  const sourceGroups: Record<string, { platform: Platform; items: string[] }> = {};
  for (const [displayId, { slug, platform }] of Object.entries(resolvedSources)) {
    const key = `${platform}:${slug}`;
    if (!sourceGroups[key]) sourceGroups[key] = { platform, items: [] };
    sourceGroups[key].items.push(displayId);
  }

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
      const hints = idHints.current;
      const mlCandidates: Array<{ displayId: string; apiId: string }> = [];
      const shopeeCandidates: Array<{ displayId: string; apiId: string }> = [];

      for (const displayId of ids) {
        const info = hints[displayId];
        if (!info) continue;
        if (info.mlId && (info.hint === 'ml' || info.hint === null) && hasML) {
          mlCandidates.push({ displayId, apiId: info.mlId });
        }
        if (info.shopeeId && (info.hint === 'shopee' || info.hint === null) && hasShopee) {
          shopeeCandidates.push({ displayId, apiId: info.shopeeId });
        }
      }

      const results: Record<string, ResolvedSource> = {};
      const unresolved = new Set(ids);
      const deniedSlugs: string[] = [];
      const promises: Promise<void>[] = [];

      // Check if user pasted Shopee URLs but has no Shopee sellers connected
      const shopeeOnlyNoSellers = ids.some(id => {
        const info = hints[id];
        return info?.hint === 'shopee' && !hasShopee;
      });
      if (shopeeOnlyNoSellers && shopeeCandidates.length === 0) {
        setResolveError('Nenhuma loja Shopee conectada');
      }

      const RESOLVE_TIMEOUT_MS = 20000;

      if (mlCandidates.length > 0) {
        promises.push((async () => {
          const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
          try {
            const res = await fetch(`${API_BASE}/api/copy/resolve-sellers`, {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify({ item_ids: mlCandidates.map(c => c.apiId) }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!res.ok) return;
            const data: { results: { item_id: string; seller_slug: string }[]; errors: { item_id: string }[] } = await res.json();
            for (const r of data.results) {
              const candidate = mlCandidates.find(c => c.apiId === r.item_id);
              if (!candidate) continue;
              const hasPerm = mlSourceSellers.some(s => s.slug === r.seller_slug);
              if (hasPerm) {
                results[candidate.displayId] = { slug: r.seller_slug, platform: 'ml' };
                unresolved.delete(candidate.displayId);
              } else if (!deniedSlugs.includes(r.seller_slug)) {
                deniedSlugs.push(r.seller_slug);
              }
            }
          } catch (e) {
            clearTimeout(timeoutId);
            if (e instanceof DOMException && e.name === 'AbortError') throw e;
          }
        })());
      }

      if (shopeeCandidates.length > 0) {
        promises.push((async () => {
          const timeoutId = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
          try {
            const res = await fetch(`${API_BASE}/api/shopee/copy/resolve-sellers`, {
              method: 'POST',
              headers: headers(),
              body: JSON.stringify({ item_ids: shopeeCandidates.map(c => c.apiId) }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
              const err = await res.json().catch(() => ({ detail: res.statusText }));
              setResolveError(err.detail || `Erro ao resolver sellers Shopee (${res.status})`);
              return;
            }
            const data: { results: { item_id: string; shop_slug: string }[]; errors: { item_id: string }[] } = await res.json();
            for (const r of data.results) {
              const candidate = shopeeCandidates.find(c => c.apiId === r.item_id);
              if (!candidate || results[candidate.displayId]) continue; // Don't overwrite ML
              const hasPerm = shopeeSourceSellers.some(s => s.slug === r.shop_slug);
              if (hasPerm) {
                results[candidate.displayId] = { slug: r.shop_slug, platform: 'shopee' };
                unresolved.delete(candidate.displayId);
              } else if (!deniedSlugs.includes(r.shop_slug)) {
                deniedSlugs.push(r.shop_slug);
              }
            }
          } catch (e) {
            clearTimeout(timeoutId);
            if (e instanceof DOMException && e.name === 'AbortError') throw e;
          }
        })());
      }

      await Promise.all(promises);
      setResolvedSources(results);
      lastResolvedKey.current = key;
      setUnresolvedIds([...unresolved]);

      if (deniedSlugs.length > 0) {
        setResolveError(`Sem permissão de cópia a partir de: ${deniedSlugs.join(', ')}`);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setResolveError(String(e));
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }, [headers, mlSourceSellers, shopeeSourceSellers, hasML, hasShopee]);

  const normalizeAndResolve = useCallback(() => {
    const lines = itemIdsText.split(/[\n,]+/);
    const classified: Array<ReturnType<typeof classifyInput>> = [];
    for (const line of lines) {
      const result = classifyInput(line);
      if (result.display) classified.push(result);
    }

    const seen = new Set<string>();
    const unique: typeof classified = [];
    for (const c of classified) {
      if (!seen.has(c.display)) { seen.add(c.display); unique.push(c); }
    }

    const removedCount = classified.length - unique.length;
    setDedupMsg(removedCount > 0 ? `${removedCount} duplicata(s) removida(s)` : '');

    const hints: typeof idHints.current = {};
    for (const c of unique) hints[c.display] = { hint: c.hint, mlId: c.mlId, shopeeId: c.shopeeId };
    idHints.current = hints;

    const text = unique.map(c => c.display).join('\n');
    if (text !== itemIdsText.trim()) setItemIdsText(text);

    const displayIds = unique.map(c => c.display);
    if (displayIds.length > 0) resolveAll(displayIds);
  }, [itemIdsText, resolveAll]);

  useEffect(() => {
    if (pendingResolve.current && itemIdsText.trim()) {
      pendingResolve.current = false;
      normalizeAndResolve();
    }
  }, [itemIdsText, normalizeAndResolve]);

  useEffect(() => {
    if (!itemIdsText.trim()) {
      setResolvedSources({});
      setUnresolvedIds([]);
      setResolveError('');
      lastResolvedKey.current = '';
      setDestinations([]);
      idHints.current = {};
    }
  }, [itemIdsText]);

  useEffect(() => {
    const entries = Object.entries(resolvedSources).map(
      ([id, { slug, platform }]) => [id, slug, platform] as [string, string, Platform]
    );
    onResolvedChange?.(entries);
  }, [resolvedSources, onResolvedChange]);

  const resolvedCount = Object.keys(resolvedSources).length;

  // Total ops considering cross-platform filtering
  const totalOps = useMemo(() => {
    let ops = 0;
    const mlDests = destinations.filter(d => mlDestSellers.some(s => s.slug === d));
    const shopeeDests = destinations.filter(d => shopeeDestSellers.some(s => s.slug === d));
    for (const { platform } of Object.values(resolvedSources)) {
      if (platform === 'ml') ops += mlDests.length;
      else ops += shopeeDests.length;
    }
    return ops;
  }, [resolvedSources, destinations, mlDestSellers, shopeeDestSellers]);

  const canCopy = resolvedCount > 0 && destinations.length > 0 && !copying && totalOps > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCopy) return;
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);

    const groups: CopyGroup[] = [];
    for (const [key, group] of Object.entries(sourceGroups)) {
      const [platform, source] = key.split(':') as [Platform, string];
      const apiIds = group.items.map(displayId => {
        if (platform === 'ml') return displayId.startsWith('MLB') ? displayId : `MLB${displayId}`;
        return displayId;
      });
      groups.push({ platform, source, itemIds: apiIds });
    }
    await onCopy(groups, destinations);
  };

  const toggleDest = (slug: string) => {
    setDestinations(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]);
    setConfirming(false);
  };

  const selectAllDests = () => {
    const allSlugs = destOptions.map(d => d.slug);
    const allSelected = allSlugs.every(s => destinations.includes(s));
    setDestinations(allSelected ? [] : allSlugs);
    setConfirming(false);
  };

  const sellerName = (slug: string) =>
    mlSourceSellers.find(s => s.slug === slug)?.name
    || mlDestSellers.find(s => s.slug === slug)?.name
    || shopeeSourceSellers.find(s => s.slug === slug)?.name
    || shopeeDestSellers.find(s => s.slug === slug)?.name
    || slug;

  const step1Done = resolvedCount > 0;
  const step2Done = destinations.length > 0;

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
        Copiar Anúncios
      </h3>

      {/* Step 1: Item IDs */}
      <Field label="IDs dos Anúncios" step={1} done={step1Done}>
        <textarea
          value={itemIdsText}
          onChange={e => { setItemIdsText(e.target.value); setConfirming(false); }}
          onPaste={e => {
            e.preventDefault();
            const pasted = e.clipboardData.getData('text').trim();
            if (!pasted) return;
            // Normalize each pasted line: add MLB prefix to pure numbers, normalize MLB variants
            const lines = pasted.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
            const processed = lines.map(line => {
              const c = classifyInput(line);
              if (c.hint === 'ml') return c.display;
              if (/^\d+$/.test(line)) return `MLB${line}`;
              return c.display || line;
            }).join('\n');
            const ta = e.currentTarget;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const before = itemIdsText.slice(0, start);
            const after = itemIdsText.slice(end);
            const needsBefore = before.length > 0 && !before.endsWith('\n');
            const newText = before + (needsBefore ? '\n' : '') + processed + after;
            setItemIdsText(newText);
            setConfirming(false);
            pendingResolve.current = true;
            const cursorPos = before.length + (needsBefore ? 1 : 0) + processed.length;
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = cursorPos; });
          }}
          onBlur={normalizeAndResolve}
          placeholder={SHOPEE_ENABLED
            ? "Cole os IDs dos anúncios (um por linha)\nMLB1234567890\n9876543210\nhttps://shopee.com.br/product/123/456"
            : "Cole os IDs dos anúncios (um por linha)\nMLB1234567890\n9876543210"}
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
          <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>{dedupMsg}</p>
        )}
        {resolving && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>
            <span className="spinner spinner-sm" />
            Detectando conta(s) de origem...
          </div>
        )}
        {resolveError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <p style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)', fontWeight: 500, margin: 0 }}>{resolveError}</p>
            <button type="button" className="btn-ghost" onClick={() => { lastResolvedKey.current = ''; normalizeAndResolve(); }}
              style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', whiteSpace: 'nowrap' }}>Tentar novamente</button>
          </div>
        )}
        {resolvedCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexWrap: 'wrap' }}>
            {Object.entries(sourceGroups).map(([key, group]) => {
              const [, slug] = key.split(':');
              const isShopee = group.platform === 'shopee';
              return (
                <span key={key} style={{
                  padding: '2px 8px',
                  background: isShopee ? '#EE4D2D' : 'var(--ink)',
                  color: 'var(--paper)',
                  borderRadius: 4,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  {isMixed && <PlatformIndicator platform={group.platform} />}
                  {sellerName(slug)} ({group.items.length})
                </span>
              );
            })}
            <span>{resolvedCount} anúncio(s)</span>
          </div>
        )}
        {unresolvedIds.length > 0 && (
          <p style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)', fontWeight: 500 }}>
            {unresolvedIds.length} ID(s) não encontrado(s): {unresolvedIds.join(', ')}
          </p>
        )}
      </Field>

      {/* Mixed-platform warning */}
      {isMixed && (
        <div style={{
          background: 'var(--attention-bg)',
          border: '1px solid rgba(217, 119, 6, 0.2)',
          borderRadius: 6,
          padding: 'var(--space-3) var(--space-4)',
          fontSize: 'var(--text-xs)',
          color: 'var(--attention)',
          fontWeight: 500,
          lineHeight: 'var(--leading-normal)',
        }}>
          Anúncios de marketplaces diferentes detectados. Os do Mercado Livre serão copiados apenas para contas ML e os da Shopee apenas para contas Shopee.
        </div>
      )}

      {/* Step 2: Destinations */}
      <Field label="Contas de Destino" step={2} done={step2Done}
        action={destOptions.length > 0 && resolvedCount > 0 ? (
          <button type="button" onClick={selectAllDests} disabled={resolving}
            style={{ background: 'none', color: 'var(--positive)', fontSize: 'var(--text-xs)', fontWeight: 500, padding: 0, opacity: resolving ? 0.5 : 1 }}>
            {destOptions.every(d => destinations.includes(d.slug)) ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>
        ) : undefined}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {resolvedCount > 0 ? (
            destOptions.length > 0 ? (
              destOptions.map(dest => {
                const on = destinations.includes(dest.slug);
                const isShopee = dest.platform === 'shopee';
                return (
                  <button key={`${dest.platform}-${dest.slug}`} type="button" onClick={() => toggleDest(dest.slug)} disabled={resolving}
                    className="chip-toggle" style={{
                      padding: '6px 12px',
                      fontSize: 'var(--text-xs)',
                      fontWeight: on ? 600 : 400,
                      background: on ? (isShopee ? '#EE4D2D' : 'var(--ink)') : 'var(--paper)',
                      color: on ? 'var(--paper)' : 'var(--ink-muted)',
                      border: `1px solid ${on ? (isShopee ? '#EE4D2D' : 'var(--ink)') : 'var(--line)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      ...(resolving ? { opacity: 0.5, pointerEvents: 'none' as const } : {}),
                    }}>
                    {on && <span style={{ fontSize: 10 }}>{'\u2713'}</span>}
                    {isMixed && <PlatformIndicator platform={dest.platform} />}
                    {dest.name}
                  </button>
                );
              })
            ) : (
              <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>Nenhuma conta de destino disponível</p>
            )
          ) : (
            <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>
              {displayIds.length > 0 ? 'Aguardando detecção das contas de origem...' : 'Cole os IDs acima para detectar as contas de origem'}
            </p>
          )}
        </div>
        {destinations.length > 0 && resolvedCount > 0 && (
          <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
            {resolvedCount} anúncio(s) &rarr; <b style={{ color: 'var(--ink)' }}>{totalOps} cópia(s)</b>
          </p>
        )}
      </Field>

      {/* Confirmation bar */}
      {confirming && (
        <div className="confirm-bar">
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', flex: 1 }}>
            Confirma copiar <b>{totalOps}</b> anúncio(s)?
          </span>
          <button type="button" onClick={() => setConfirming(false)} className="btn-ghost"
            style={{ padding: '6px 12px', fontSize: 'var(--text-xs)' }}>Cancelar</button>
          <button type="submit" className="btn-primary"
            style={{ padding: '6px 16px', fontSize: 'var(--text-xs)' }}>Confirmar</button>
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
          <button type="button" onClick={() => {
            const entries = Object.entries(resolvedSources).map(
              ([id, { slug, platform }]) => [id, slug, platform] as [string, string, Platform]
            );
            onPreview(entries);
          }} className="btn-ghost" style={{
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
              width: 18, height: 18, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700,
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

/** Small platform indicator for mixed-mode chips */
function PlatformIndicator({ platform }: { platform: Platform }) {
  const isML = platform === 'ml';
  return (
    <span style={{
      fontSize: 8,
      fontWeight: 800,
      lineHeight: 1,
      padding: '1px 3px',
      borderRadius: 2,
      background: isML ? 'rgba(255,230,0,0.25)' : 'rgba(255,255,255,0.25)',
      color: isML ? '#FFE600' : '#fff',
      flexShrink: 0,
    }}>
      {isML ? 'ML' : 'S'}
    </span>
  );
}
