import { useState, useCallback, useEffect } from 'react';
import { API_BASE, type Seller, type CompatPreview, type CompatSearchResult, type CompatCopyResult } from '../lib/api';
import { Card } from './CopyPage';

interface Props {
  sellers: Seller[];
  headers: () => Record<string, string>;
}

interface CompatLog {
  id: number;
  source_item_id: string;
  skus: string[];
  targets: { seller_slug: string; item_id: string; status: string; error: string | null }[];
  total_targets: number;
  success_count: number;
  error_count: number;
  created_at: string;
}

function parseItemId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/MLB[-]?(\d+)/i);
  if (match) return `MLB${match[1]}`;
  return trimmed;
}

function parseSkus(input: string): string[] {
  return input
    .split(/[,\s\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export default function CompatPage({ sellers, headers }: Props) {
  const [sourceInput, setSourceInput] = useState('');
  const [preview, setPreview] = useState<CompatPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [skuInput, setSkuInput] = useState('');
  const [searchResults, setSearchResults] = useState<CompatSearchResult[]>([]);
  const [searchedSkus, setSearchedSkus] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);

  const [copyResult, setCopyResult] = useState<CompatCopyResult | null>(null);
  const [copying, setCopying] = useState(false);

  const [logs, setLogs] = useState<CompatLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);

  const firstSellerSlug = sellers[0]?.slug || '';

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/compat/logs?limit=50`, { headers: headers(), cache: 'no-store' });
      if (res.ok) { setLogs(await res.json()); setLogsLoaded(true); }
    } catch (e) { console.error('Failed to load compat logs:', e); }
  }, [headers]);

  useEffect(() => {
    if (!logsLoaded) loadLogs();
  }, [logsLoaded, loadLogs]);

  const handlePreview = useCallback(async (raw: string) => {
    const itemId = parseItemId(raw);
    if (!itemId || !firstSellerSlug) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/compat/preview/${itemId}?seller=${encodeURIComponent(firstSellerSlug)}`,
        { headers: headers(), cache: 'no-store' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Item nao encontrado' }));
        setPreviewError(err.detail);
        return;
      }
      setPreview(await res.json());
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setPreviewLoading(false);
    }
  }, [headers, firstSellerSlug]);

  const handleSearch = useCallback(async () => {
    const skus = parseSkus(skuInput);
    if (!skus.length) return;
    setSearching(true);
    setSearchResults([]);
    setSearchedSkus(skus);
    setCopyResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/compat/search-sku`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ skus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro na busca' }));
        setPreviewError(err.detail);
        return;
      }
      setSearchResults(await res.json());
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setSearching(false);
    }
  }, [skuInput, headers]);

  const handleCopy = useCallback(async () => {
    if (!preview || !searchResults.length) return;
    setCopying(true);
    setCopyResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/compat/copy`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          source_item_id: preview.id,
          targets: searchResults.map(r => ({ seller_slug: r.seller_slug, item_id: r.item_id })),
          skus: searchedSkus,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro ao copiar' }));
        setPreviewError(err.detail);
        return;
      }
      const data: CompatCopyResult = await res.json();
      setCopyResult(data);
      loadLogs();
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setCopying(false);
    }
  }, [preview, searchResults, headers, loadLogs]);

  const canCopy = preview?.has_compatibilities && searchResults.length > 0 && !copying;

  // Group search results by SKU
  const resultsBySku: Record<string, CompatSearchResult[]> = {};
  for (const r of searchResults) {
    (resultsBySku[r.sku] ||= []).push(r);
  }
  const skusNotFound = searchedSkus.filter(s => !resultsBySku[s]?.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Source Input */}
      <Card title="Origem">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <label style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontWeight: 500 }}>
            Item de origem (URL ou ID do Mercado Livre)
          </label>
          <input
            className="input-base"
            type="text"
            placeholder="MLB1234567890 ou https://www.mercadolivre.com.br/..."
            value={sourceInput}
            onChange={e => setSourceInput(e.target.value)}
            onBlur={() => sourceInput && handlePreview(sourceInput)}
            onKeyDown={e => { if (e.key === 'Enter') handlePreview(sourceInput); }}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              fontSize: 'var(--text-sm)',
              background: 'var(--paper)',
              color: 'var(--ink)',
            }}
          />
        </div>
      </Card>

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
      {preview && (
        <Card title="Preview">
          <div className="animate-in" style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {preview.thumbnail && (
              <img src={preview.thumbnail} alt="" style={{ width: 72, height: 72, borderRadius: 6, objectFit: 'cover', background: 'var(--surface)' }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-tight)', marginBottom: 'var(--space-1)' }}>
                {preview.title}
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginBottom: 'var(--space-1)' }}>
                {preview.id}
              </p>
              <p style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: preview.has_compatibilities ? 'var(--success)' : 'var(--danger)',
              }}>
                {preview.has_compatibilities
                  ? `${preview.compat_count} compatibilidade${preview.compat_count !== 1 ? 's' : ''}`
                  : 'Sem compatibilidades'}
              </p>
            </div>
          </div>
          {!preview.has_compatibilities && (
            <div style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'rgba(239, 68, 68, 0.06)',
              borderRadius: 6,
              fontSize: 'var(--text-xs)',
              color: 'var(--danger)',
              fontWeight: 500,
            }}>
              Este item nao possui compatibilidades para copiar.
            </div>
          )}
        </Card>
      )}

      {/* SKU Search */}
      <Card title="Buscar por SKU">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <label style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontWeight: 500 }}>
            SKUs dos anuncios de destino
          </label>
          <textarea
            className="input-base"
            placeholder="Digite os SKUs separados por virgula, espaco ou quebra de linha"
            value={skuInput}
            onChange={e => setSkuInput(e.target.value)}
            rows={3}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              fontSize: 'var(--text-sm)',
              background: 'var(--paper)',
              color: 'var(--ink)',
              resize: 'vertical',
              fontFamily: 'var(--font-mono)',
            }}
          />
          <button
            className="btn-primary"
            onClick={handleSearch}
            disabled={!skuInput.trim() || searching}
            style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)', alignSelf: 'flex-start' }}
          >
            {searching ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span className="spinner spinner-sm" /> Buscando...
              </span>
            ) : 'Buscar Anuncios'}
          </button>
        </div>
      </Card>

      {/* Search Results */}
      {(searchResults.length > 0 || skusNotFound.length > 0) && (
        <Card title={`Resultados (${searchResults.length} encontrado${searchResults.length !== 1 ? 's' : ''})`}>
          <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {Object.entries(resultsBySku).map(([sku, items]) => (
              <div key={sku}>
                <p style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  color: 'var(--ink-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 'var(--space-2)',
                }}>
                  SKU: {sku}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {items.map(item => (
                    <div key={`${item.seller_slug}-${item.item_id}`} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 'var(--space-2) var(--space-3)',
                      background: 'var(--paper)',
                      borderRadius: 6,
                      border: '1px solid var(--line)',
                    }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, lineHeight: 'var(--leading-tight)' }}>
                          {item.title || item.item_id}
                        </p>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>
                          {item.item_id}
                        </p>
                      </div>
                      <span style={{
                        fontSize: 'var(--text-xs)',
                        fontWeight: 600,
                        color: 'var(--ink-muted)',
                        whiteSpace: 'nowrap',
                        marginLeft: 'var(--space-3)',
                      }}>
                        {item.seller_name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {skusNotFound.length > 0 && (
              <div style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'rgba(245, 158, 11, 0.06)',
                borderRadius: 6,
                fontSize: 'var(--text-xs)',
                color: 'var(--warning)',
                fontWeight: 500,
              }}>
                SKUs sem resultados: {skusNotFound.join(', ')}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Copy Button */}
      {searchResults.length > 0 && (
        <button
          className="btn-primary"
          onClick={handleCopy}
          disabled={!canCopy}
          style={{
            padding: 'var(--space-3) var(--space-6)',
            fontSize: 'var(--text-sm)',
            alignSelf: 'center',
          }}
        >
          {copying ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className="spinner spinner-sm" /> Copiando...
            </span>
          ) : `Copiar Compatibilidades (${searchResults.length} destino${searchResults.length !== 1 ? 's' : ''})`}
        </button>
      )}

      {/* Copy Results */}
      {copyResult && (
        <Card title="Resultado da Copia">
          <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
              <span>Total: <b>{copyResult.total}</b></span>
              <span style={{ color: 'var(--success)' }}>Sucesso: <b>{copyResult.success}</b></span>
              {copyResult.errors > 0 && (
                <span style={{ color: 'var(--danger)' }}>Erros: <b>{copyResult.errors}</b></span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {copyResult.results.map(r => (
                <div key={`${r.seller_slug}-${r.item_id}`} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-1) var(--space-2)',
                  fontSize: 'var(--text-xs)',
                }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: r.status === 'ok' ? 'var(--success)' : 'var(--danger)',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-faint)' }}>{r.item_id}</span>
                  <span style={{ color: 'var(--ink-muted)' }}>{r.seller_slug}</span>
                  {r.error && <span style={{ color: 'var(--danger)' }}>— {r.error}</span>}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* History */}
      {logs.length > 0 && (
        <Card
          title={`Historico (${logs.length})`}
          collapsible
          open={logsOpen}
          onToggle={() => setLogsOpen(!logsOpen)}
        >
          {logsOpen && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr>
                    {['Data', 'Origem', 'SKUs', 'Destinos', 'Sucesso', 'Erros'].map(h => (
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
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        {log.source_item_id}
                      </td>
                      <td style={{ ...td, fontSize: 'var(--text-xs)' }}>
                        {log.skus?.join(', ') || '-'}
                      </td>
                      <td style={td}>{log.total_targets}</td>
                      <td style={{ ...td, color: 'var(--success)', fontWeight: 600 }}>{log.success_count}</td>
                      <td style={{ ...td, color: log.error_count > 0 ? 'var(--danger)' : 'var(--ink-faint)', fontWeight: 600 }}>
                        {log.error_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const td: React.CSSProperties = { padding: 'var(--space-2) var(--space-3)', color: 'var(--ink)' };
