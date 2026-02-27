import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE, type Seller, type CopyResponse, type CopyLog, type ItemPreview } from '../lib/api';
import CopyForm from '../components/CopyForm';
import CopyProgress from '../components/CopyProgress';

interface Props {
  sellers: Seller[];
  headers: () => Record<string, string>;
}

export default function CopyPage({ sellers, headers }: Props) {
  const [results, setResults] = useState<(CopyResponse & { source?: string }) | null>(null);
  const [copying, setCopying] = useState(false);
  const [logs, setLogs] = useState<CopyLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [preview, setPreview] = useState<ItemPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/copy/logs?limit=20`, { headers: headers(), cache: 'no-store' });
      if (res.ok) { setLogs(await res.json()); setLogsLoaded(true); }
    } catch (e) { console.error('Failed to load logs:', e); }
  }, [headers]);

  const handleCopy = useCallback(async (source: string, destinations: string[], itemIds: string[]) => {
    setCopying(true);
    setResults(null);
    // Refresh logs after a short delay to pick up in_progress rows created by the backend
    setTimeout(loadLogs, 1000);
    try {
      const res = await fetch(`${API_BASE}/api/copy`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ source, destinations, item_ids: itemIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
        setResults({ total: 0, success: 0, errors: 1, results: [{ source_item_id: '', dest_seller: '', status: 'error', dest_item_id: null, error: err.detail }] });
        return;
      }
      const data: CopyResponse = await res.json();
      setResults({ ...data, source });
    } catch (e) {
      setResults({ total: 0, success: 0, errors: 1, results: [{ source_item_id: '', dest_seller: '', status: 'error', dest_item_id: null, error: String(e) }] });
    } finally {
      setCopying(false);
      loadLogs();
    }
  }, [headers, loadLogs]);

  const handlePreview = useCallback(async (itemId: string, seller: string) => {
    if (!itemId.trim() || !seller) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    try {
      const res = await fetch(`${API_BASE}/api/copy/preview/${itemId.trim()}?seller=${encodeURIComponent(seller)}`, { headers: headers(), cache: 'no-store' });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Item nao encontrado' })); setPreviewError(err.detail); return; }
      setPreview(await res.json());
    } catch (e) { setPreviewError(String(e)); }
    finally { setPreviewLoading(false); }
  }, [headers]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <CopyForm sellers={sellers} onCopy={handleCopy} onPreview={handlePreview} copying={copying} />

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
      {preview && <PreviewCard preview={preview} onClose={() => setPreview(null)} />}
      {results && (
        <CopyProgress
          results={results}
          headers={headers}
          onDimensionRetry={(updated) => setResults({ ...updated, source: results.source })}
        />
      )}

      {/* Logs */}
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
                    {['Data', 'Origem', 'Destino(s)', 'Item', 'Status', 'Novos IDs'].map(h => (
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
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td style={td}>{log.source_seller}</td>
                      <td style={td}>{log.dest_sellers?.join(', ')}</td>
                      <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{log.source_item_id}</td>
                      <td style={td}><StatusBadge status={log.status} /></td>
                      <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        {log.dest_item_ids ? Object.entries(log.dest_item_ids).map(([s, id]) => <div key={s}>{s}: {id}</div>) : '-'}
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

function PreviewCard({ preview, onClose }: { preview: ItemPreview; onClose: () => void }) {
  return (
    <Card title="Preview" action={
      <button onClick={onClose} style={{
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
      <div className="animate-in" style={{ display: 'flex', gap: 'var(--space-3)' }}>
        {preview.thumbnail && (
          <img src={preview.thumbnail} alt="" style={{ width: 72, height: 72, borderRadius: 6, objectFit: 'cover', background: 'var(--surface)' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-tight)', marginBottom: 'var(--space-1)' }}>{preview.title}</p>
          <p style={{ color: 'var(--positive)', fontWeight: 700, fontSize: 'var(--text-lg)' }}>
            {preview.currency_id} {preview.price?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 'var(--space-1) var(--space-4)',
        marginTop: 'var(--space-3)',
        fontSize: 'var(--text-xs)', color: 'var(--ink-faint)',
      }}>
        <span>Status: <b style={{ color: 'var(--ink)' }}>{preview.status}</b></span>
        <span>Tipo: <b style={{ color: 'var(--ink)' }}>{preview.listing_type_id}</b></span>
        <span>Fotos: <b style={{ color: 'var(--ink)' }}>{preview.pictures_count}</b></span>
        <span>Variacoes: <b style={{ color: 'var(--ink)' }}>{preview.variations_count}</b></span>
        <span>Atributos: <b style={{ color: 'var(--ink)' }}>{preview.attributes_count}</b></span>
        <span>Estoque: <b style={{ color: 'var(--ink)' }}>{preview.available_quantity}</b></span>
        <span>Compat.: <b style={{ color: preview.has_compatibilities ? 'var(--success)' : 'var(--ink-faint)' }}>{preview.has_compatibilities ? 'Sim' : 'Nao'}</b></span>
        <span>Desc.: <b style={{ color: 'var(--ink)' }}>{preview.description_length} chars</b></span>
      </div>
      {preview.permalink && (
        <a href={preview.permalink} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 500 }}>
          Ver no ML &rarr;
        </a>
      )}
    </Card>
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

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = { success: 'var(--success)', error: 'var(--danger)', partial: 'var(--warning)', pending: 'var(--ink-faint)', in_progress: 'var(--info, #3b82f6)' };
  const bg: Record<string, string> = { success: 'rgba(16, 185, 129, 0.08)', error: 'rgba(239, 68, 68, 0.08)', partial: 'rgba(245, 158, 11, 0.08)', in_progress: 'rgba(59, 130, 246, 0.08)' };
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
      {isInProgress ? 'Copiando...' : status}
    </span>
  );
}

const td: React.CSSProperties = { padding: 'var(--space-2) var(--space-3)', color: 'var(--ink)' };
