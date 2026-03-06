import { useState, useCallback, useRef, useEffect } from 'react';
import { API_BASE, type Seller } from '../lib/api';

function normalizeItemId(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const m = t.match(/MLB[-]?(\d+)/i);
  if (m) return `MLB${m[1]}`;
  if (/^\d+$/.test(t)) return `MLB${t}`;
  return t;
}

export interface CopyGroup {
  source: string;
  itemIds: string[];
}

interface Props {
  sourceSellers: Seller[];
  destSellers: Seller[];
  headers: () => Record<string, string>;
  onCopy: (groups: CopyGroup[], destinations: string[]) => Promise<void>;
  onPreview: (items: Array<[string, string]>) => Promise<void>;
  onResolvedChange?: (items: Array<[string, string]>) => void;
  copying: boolean;
}

export default function CopyForm({ sourceSellers, destSellers, headers, onCopy, onPreview, onResolvedChange, copying }: Props) {
  const [itemIdsText, setItemIdsText] = useState('');
  // {item_id: seller_slug}
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

  const itemIds = itemIdsText.split(/[\n,]+/).map(normalizeItemId).filter(id => id.length > 0);

  // Derive source slugs from resolved items
  const sourceSlugs = [...new Set(Object.values(resolvedSources))];
  const validDests = destSellers.filter(s => s.token_valid && !sourceSlugs.includes(s.slug));

  // Group resolved items by source
  const sourceGroups: Record<string, string[]> = {};
  for (const [itemId, slug] of Object.entries(resolvedSources)) {
    (sourceGroups[slug] ||= []).push(itemId);
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
      const res = await fetch(`${API_BASE}/api/copy/resolve-sellers`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ item_ids: ids }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro ao detectar sellers' }));
        setResolveError(err.detail);
        return;
      }
      const data: {
        results: { item_id: string; seller_slug: string }[];
        errors: { item_id: string; error: string }[];
      } = await res.json();

      const sources: Record<string, string> = {};
      const deniedSlugs: string[] = [];
      for (const r of data.results) {
        const hasPermission = sourceSellers.some(s => s.slug === r.seller_slug);
        if (hasPermission) {
          sources[r.item_id] = r.seller_slug;
        } else if (!deniedSlugs.includes(r.seller_slug)) {
          deniedSlugs.push(r.seller_slug);
        }
      }
      setResolvedSources(sources);
      lastResolvedKey.current = key;
      setUnresolvedIds(data.errors.map(e => e.item_id));

      if (deniedSlugs.length > 0) {
        setResolveError(`Sem permissão de cópia a partir do(s) seller(s): ${deniedSlugs.join(', ')}`);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setResolveError(String(e));
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }, [headers, sourceSellers]);

  const normalizeAndResolve = useCallback(() => {
    const normalized = itemIdsText.split(/[\n,]+/).map(normalizeItemId).filter(Boolean);
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

  // Notify parent when resolved items change
  useEffect(() => {
    const entries = Object.entries(resolvedSources) as Array<[string, string]>;
    onResolvedChange?.(entries);
  }, [resolvedSources, onResolvedChange]);

  const resolvedCount = Object.keys(resolvedSources).length;
  const canCopy = resolvedCount > 0 && destinations.length > 0 && !copying;
  const totalOps = resolvedCount * destinations.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCopy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    const groups: CopyGroup[] = Object.entries(sourceGroups).map(([source, ids]) => ({ source, itemIds: ids }));
    await onCopy(groups, destinations);
  };

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

  const step1Done = resolvedCount > 0;
  const step2Done = destinations.length > 0;

  const resolvedEntries = Object.entries(resolvedSources) as Array<[string, string]>;

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

      {/* Step 1: Item IDs + auto-detect sources */}
      <Field label="IDs dos Anúncios" step={1} done={step1Done}>
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
            // Add newline before if cursor is right after text (no newline)
            const needsBefore = before.length > 0 && !before.endsWith('\n');
            const newText = before + (needsBefore ? '\n' : '') + pasted + '\n' + after;
            setItemIdsText(newText);
            setConfirming(false);
            pendingResolve.current = true;
            // Move cursor to after the pasted content + newline
            const cursorPos = before.length + (needsBefore ? 1 : 0) + pasted.length + 1;
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = cursorPos;
            });
          }}
          onBlur={normalizeAndResolve}
          placeholder={"Cole os IDs dos anúncios (um por linha)\n1234567890\nMLB9876543210"}
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
            Detectando seller(s) de origem...
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
                background: 'var(--ink)',
                color: 'var(--paper)',
                borderRadius: 4,
                fontWeight: 600,
              }}>
                {sellerName(slug)} ({sourceGroups[slug].length})
              </span>
            ))}
            <span>{resolvedCount} anúncio(s)</span>
          </div>
        )}
        {unresolvedIds.length > 0 && (
          <p style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)', fontWeight: 500 }}>
            {unresolvedIds.length} ID(s) não encontrado(s): {unresolvedIds.join(', ')}
          </p>
        )}
      </Field>

      {/* Step 2: Destinations */}
      <Field
        label="Sellers de Destino"
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
                    background: on ? 'var(--ink)' : 'var(--paper)',
                    color: on ? 'var(--paper)' : 'var(--ink-muted)',
                    border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`,
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
              <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>Nenhum outro seller disponível</p>
            )
          ) : (
            <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' }}>
              {itemIds.length > 0 ? 'Aguardando detecção dos sellers de origem...' : 'Cole os IDs acima para detectar os sellers de origem'}
            </p>
          )}
        </div>
        {destinations.length > 0 && resolvedCount > 0 && (
          <p style={{ color: 'var(--ink-faint)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
            {resolvedCount} anúncio(s) x {destinations.length} destino(s) = <b style={{ color: 'var(--ink)' }}>{totalOps} cópia(s)</b>
          </p>
        )}
      </Field>

      {/* Confirmation bar */}
      {confirming && (
        <div className="confirm-bar">
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', flex: 1 }}>
            Confirma copiar <b>{totalOps}</b> anúncio(s)?
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

        {resolvedEntries.length > 0 && (
          <button type="button" onClick={() => onPreview(resolvedEntries)} className="btn-ghost" style={{
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
