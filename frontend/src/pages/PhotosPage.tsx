import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE, type Seller } from '../lib/api';
import { useToast } from '../components/Toast';
import { Card } from './CopyPage';

interface Props {
  sellers: Seller[];
  headers: () => Record<string, string>;
}

interface PhotoPicture {
  id: string;
  url: string;
  secure_url: string;
  size: string;
}

interface PhotoPreview {
  id: string;
  title: string;
  thumbnail: string;
  pictures: PhotoPicture[];
  skus: string[];
  seller: string;
}

function parseItemId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/MLB[-]?(\d+)/i);
  if (match) return `MLB${match[1]}`;
  if (/^\d+$/.test(trimmed)) return `MLB${trimmed}`;
  return trimmed;
}

export default function PhotosPage({ sellers, headers }: Props) {
  const { toast } = useToast();
  const [sourceInput, setSourceInput] = useState('');
  const [preview, setPreview] = useState<PhotoPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [copiedSku, setCopiedSku] = useState<string | null>(null);

  const sellerName = useCallback((slug: string) => {
    return sellers.find(s => s.slug === slug)?.name || slug;
  }, [sellers]);

  // Auto-preview when sourceInput changes (debounced)
  const handlePreviewRef = useRef<(raw: string) => Promise<void>>(null);

  const handlePreview = useCallback(async (raw: string) => {
    const itemId = parseItemId(raw);
    if (!itemId) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    try {
      const res = await fetch(`${API_BASE}/api/photos/preview/${encodeURIComponent(itemId)}`, {
        headers: headers(),
        cache: 'no-store',
      });
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
  }, [headers]);

  handlePreviewRef.current = handlePreview;

  useEffect(() => {
    const raw = sourceInput.trim();
    if (!raw) return;
    const parsed = parseItemId(raw);
    if (!/^MLB\d+$/.test(parsed)) return;
    const timer = setTimeout(() => {
      void handlePreviewRef.current?.(raw);
    }, 600);
    return () => clearTimeout(timer);
  }, [sourceInput]);

  const handleCopySku = useCallback(async (sku: string) => {
    try {
      await navigator.clipboard.writeText(sku);
      setCopiedSku(sku);
      toast(`SKU ${sku} copiado.`, 'success');
      setTimeout(() => setCopiedSku(null), 2000);
    } catch {
      toast('Nao foi possivel copiar o SKU.', 'error');
    }
  }, [toast]);

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
            placeholder="1234567890 ou MLB1234567890"
            value={sourceInput}
            onChange={e => setSourceInput(e.target.value)}
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

      {/* Preview Loading */}
      {previewLoading && (
        <Card title="Preview">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--ink-faint)', fontSize: 'var(--text-sm)' }}>
            <span className="spinner spinner-sm" />
            Carregando preview...
          </div>
        </Card>
      )}

      {/* Preview Error */}
      {previewError && (
        <Card title="Preview">
          <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{previewError}</p>
        </Card>
      )}

      {/* Preview Result */}
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
              <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>
                Seller detectado: <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{sellerName(preview.seller)}</span>
              </p>
            </div>
          </div>

          {/* SKUs */}
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontWeight: 500 }}>SKUs:</span>
            {preview.skus && preview.skus.length > 0 ? preview.skus.map(sku => (
              <button
                key={sku}
                onClick={() => void handleCopySku(sku)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                {sku}
                <span style={{ fontSize: 10, color: copiedSku === sku ? 'var(--success)' : 'var(--ink-faint)' }}>
                  {copiedSku === sku ? '✓' : '⧉'}
                </span>
              </button>
            )) : (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>Sem SKU</span>
            )}
          </div>

          {/* Photos Grid */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
              Fotos ({preview.pictures.length})
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 'var(--space-3)',
            }}>
              {preview.pictures.map((pic, idx) => (
                <div key={pic.id} style={{
                  position: 'relative',
                  aspectRatio: '1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid var(--line)',
                  background: 'var(--paper)',
                }}>
                  <img
                    src={pic.secure_url || pic.url}
                    alt={`Foto ${idx + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                  {idx === 0 && (
                    <span style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      background: 'var(--ink)',
                      color: 'var(--paper)',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      Principal
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
