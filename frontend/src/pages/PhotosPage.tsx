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

interface SkuSearchResult {
  seller_slug: string;
  seller_name: string;
  item_id: string;
  sku: string;
  title: string;
  thumbnail: string;
}

// Discriminated union for editable photos
type EditablePhoto =
  | { type: 'existing'; id: string; url: string; secure_url: string; size: string }
  | { type: 'upload'; file: File; previewUrl: string; tempId: string }
  | { type: 'url'; source: string; tempId: string };

function getPhotoKey(photo: EditablePhoto): string {
  return photo.type === 'existing' ? photo.id : photo.tempId;
}

function getPhotoSrc(photo: EditablePhoto): string {
  switch (photo.type) {
    case 'existing': return photo.secure_url || photo.url;
    case 'upload': return photo.previewUrl;
    case 'url': return photo.source;
  }
}

function isNewPhoto(photo: EditablePhoto): boolean {
  return photo.type !== 'existing';
}

let _tempIdCounter = 0;
function nextTempId(): string {
  return `temp-${Date.now()}-${++_tempIdCounter}`;
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

  // Editable photo state (US-008, US-009)
  const [activePhotos, setActivePhotos] = useState<EditablePhoto[]>([]);
  const [removedPhotos, setRemovedPhotos] = useState<EditablePhoto[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // SKU search and target selection state (US-010)
  const [skuInput, setSkuInput] = useState('');
  const [skuSearchResults, setSkuSearchResults] = useState<SkuSearchResult[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  // Apply photos state (US-011)
  const [applying, setApplying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up poll interval on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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

  // Initialize editable photos and SKU input when preview loads
  useEffect(() => {
    if (preview) {
      setActivePhotos(preview.pictures.map(p => ({ type: 'existing' as const, ...p })));
      setRemovedPhotos([]);
      // Auto-populate SKU input with first detected SKU
      setSkuInput(preview.skus.length > 0 ? preview.skus[0] : '');
    } else {
      setActivePhotos([]);
      setRemovedPhotos([]);
      setSkuInput('');
    }
    setUrlInput('');
    setSkuSearchResults([]);
    setSelectedTargets(new Set());
    setSearchError('');
    setHasSearched(false);
  }, [preview]);

  // Photo editing handlers
  const handleRemovePhoto = useCallback((idx: number) => {
    setActivePhotos(prev => {
      if (prev.length <= 1) return prev;
      const removed = prev[idx];
      // Revoke blob URL for upload photos to prevent memory leaks
      if (removed.type === 'upload') URL.revokeObjectURL(removed.previewUrl);
      setRemovedPhotos(r => [...r, removed]);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const handleRestorePhoto = useCallback((idx: number) => {
    setRemovedPhotos(prev => {
      const item = prev[idx];
      // Re-create blob URL for upload photos being restored
      const restored = item.type === 'upload'
        ? { ...item, previewUrl: URL.createObjectURL(item.file) }
        : item;
      setActivePhotos(a => [...a, restored]);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // Add photos by file upload (US-009)
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newPhotos: EditablePhoto[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 10 * 1024 * 1024) {
        toast(`${file.name}: arquivo excede 10MB.`, 'error');
        continue;
      }
      newPhotos.push({
        type: 'upload',
        file,
        previewUrl: URL.createObjectURL(file),
        tempId: nextTempId(),
      });
    }
    if (newPhotos.length > 0) {
      setActivePhotos(prev => [...prev, ...newPhotos]);
    }
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [toast]);

  // Add photo by URL (US-009)
  const handleAddUrl = useCallback(() => {
    const url = urlInput.trim();
    if (!url) return;
    setActivePhotos(prev => [...prev, { type: 'url', source: url, tempId: nextTempId() }]);
    setUrlInput('');
  }, [urlInput]);

  // SKU search handler (US-010)
  const handleSkuSearch = useCallback(async () => {
    const sku = skuInput.trim();
    if (!sku) return;
    setSearching(true);
    setSearchError('');
    setSkuSearchResults([]);
    setSelectedTargets(new Set());
    try {
      const res = await fetch(`${API_BASE}/api/photos/search-sku`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ skus: [sku] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro na busca' }));
        setSearchError(err.detail);
        return;
      }
      const data: SkuSearchResult[] = await res.json();
      // Exclude source item from results
      const filtered = data.filter(r => r.item_id !== preview?.id);
      setSkuSearchResults(filtered);
      // Select all by default
      setSelectedTargets(new Set(filtered.map(r => `${r.seller_slug}:${r.item_id}`)));
      setHasSearched(true);
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, [skuInput, headers, preview]);

  const handleToggleTarget = useCallback((key: string) => {
    setSelectedTargets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedTargets(prev => {
      if (prev.size === skuSearchResults.length) return new Set();
      return new Set(skuSearchResults.map(r => `${r.seller_slug}:${r.item_id}`));
    });
  }, [skuSearchResults]);

  // Apply photos handler (US-011)
  const handleApply = useCallback(async () => {
    if (!preview || selectedTargets.size === 0 || activePhotos.length === 0) return;

    setApplying(true);
    try {
      // Step 1: Upload any 'upload' type photos to get picture_ids
      const picturesPayload: { id?: string; source?: string }[] = [];
      const authHeader = headers()['X-Auth-Token'];

      for (const photo of activePhotos) {
        if (photo.type === 'existing') {
          picturesPayload.push({ id: photo.id });
        } else if (photo.type === 'upload') {
          const formData = new FormData();
          formData.append('file', photo.file);
          const uploadRes = await fetch(
            `${API_BASE}/api/photos/upload?seller=${encodeURIComponent(preview.seller)}`,
            {
              method: 'POST',
              headers: { 'X-Auth-Token': authHeader },
              body: formData,
            }
          );
          if (!uploadRes.ok) {
            const err = await uploadRes.json().catch(() => ({ detail: 'Erro ao enviar foto' }));
            toast(`Erro ao enviar foto: ${err.detail}`, 'error');
            return;
          }
          const uploadData = await uploadRes.json();
          picturesPayload.push({ id: uploadData.id });
        } else if (photo.type === 'url') {
          picturesPayload.push({ source: photo.source });
        }
      }

      // Step 2: Build targets from selected
      const targets = skuSearchResults
        .filter(r => selectedTargets.has(`${r.seller_slug}:${r.item_id}`))
        .map(r => ({ seller_slug: r.seller_slug, item_id: r.item_id }));

      // Step 3: Call apply endpoint
      const applyRes = await fetch(`${API_BASE}/api/photos/apply`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          source_item_id: preview.id,
          sku: skuInput.trim() || null,
          pictures: picturesPayload,
          targets,
        }),
      });

      if (!applyRes.ok) {
        const err = await applyRes.json().catch(() => ({ detail: 'Erro ao aplicar fotos' }));
        toast(err.detail, 'error');
        return;
      }

      const result = await applyRes.json();
      const logId = result.log_id as number;

      // Poll for completion to show summary toast
      if (pollRef.current) clearInterval(pollRef.current);
      const hdrs = headers();
      pollRef.current = setInterval(async () => {
        try {
          const logsRes = await fetch(`${API_BASE}/api/photos/logs?limit=50`, { headers: hdrs });
          if (!logsRes.ok) return;
          const logs: Array<{ id: number; status: string; success_count: number; error_count: number }> = await logsRes.json();
          const log = logs.find(l => l.id === logId);
          if (log && log.status !== 'processing' && log.status !== 'pending') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            const msg = `${log.success_count} sucesso, ${log.error_count} erro${log.error_count !== 1 ? 's' : ''}`;
            toast(msg, log.error_count > 0 ? 'error' : 'success');
          }
        } catch { /* ignore polling errors */ }
      }, 3000);

      // Stop polling after 2 minutes
      setTimeout(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }, 120000);

    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setApplying(false);
    }
  }, [preview, selectedTargets, activePhotos, skuSearchResults, skuInput, headers, toast]);

  const canApply = preview && selectedTargets.size > 0 && activePhotos.length > 0 && !applying;

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIdx(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    const sourceIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(sourceIdx) || sourceIdx === dropIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    setActivePhotos(prev => {
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(dropIdx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

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

          {/* Photos Grid — editable */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontWeight: 500 }}>
                Fotos ({activePhotos.length})
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '2px 10px',
                  borderRadius: 4,
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Adicionar foto
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png"
                multiple
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>

            {/* URL input */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <input
                className="input-base"
                type="text"
                placeholder="URL da imagem (https://...)"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddUrl(); }}
                style={{
                  flex: 1,
                  padding: 'var(--space-1) var(--space-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  fontSize: 'var(--text-xs)',
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                }}
              />
              <button
                onClick={handleAddUrl}
                disabled={!urlInput.trim()}
                style={{
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 4,
                  border: '1px solid var(--line)',
                  background: urlInput.trim() ? 'var(--surface)' : 'var(--paper)',
                  color: urlInput.trim() ? 'var(--ink)' : 'var(--ink-faint)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  cursor: urlInput.trim() ? 'pointer' : 'default',
                }}
              >
                Adicionar
              </button>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 'var(--space-3)',
            }}>
              {activePhotos.map((pic, idx) => (
                <div
                  key={getPhotoKey(pic)}
                  draggable
                  onDragStart={e => handleDragStart(e, idx)}
                  onDragOver={e => handleDragOver(e, idx)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: dragOverIdx === idx
                      ? '2px solid var(--accent)'
                      : isNewPhoto(pic)
                        ? '2px dashed var(--accent)'
                        : '1px solid var(--line)',
                    background: 'var(--paper)',
                    opacity: dragIdx === idx ? 0.4 : 1,
                    cursor: 'grab',
                    transition: 'border 0.15s, opacity 0.15s',
                  }}
                >
                  <img
                    src={getPhotoSrc(pic)}
                    alt={`Foto ${idx + 1}`}
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      pointerEvents: 'none',
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
                  {isNewPhoto(pic) && (
                    <span style={{
                      position: 'absolute',
                      bottom: 6,
                      left: 6,
                      background: 'var(--accent)',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      Nova
                    </span>
                  )}
                  {/* Remove button — hidden when only 1 photo left */}
                  {activePhotos.length > 1 && (
                    <button
                      onClick={() => handleRemovePhoto(idx)}
                      title="Remover foto"
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        border: 'none',
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Removed Photos */}
          {removedPhotos.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                Removidas ({removedPhotos.length})
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 'var(--space-2)',
              }}>
                {removedPhotos.map((pic, idx) => (
                  <div key={getPhotoKey(pic)} style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '1px dashed var(--line)',
                    background: 'var(--surface)',
                    opacity: 0.5,
                  }}>
                    <img
                      src={getPhotoSrc(pic)}
                      alt="Removida"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                    <button
                      onClick={() => handleRestorePhoto(idx)}
                      title="Restaurar foto"
                      style={{
                        position: 'absolute',
                        bottom: 6,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '2px 10px',
                        borderRadius: 4,
                        border: 'none',
                        background: 'rgba(0,0,0,0.7)',
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Restaurar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* SKU Search and Target Selection (US-010) */}
      {preview && (
        <Card title="Buscar por SKU">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontWeight: 500 }}>
              SKU para buscar anuncios de destino
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                className="input-base"
                type="text"
                placeholder="Digite o SKU"
                value={skuInput}
                onChange={e => setSkuInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && skuInput.trim()) void handleSkuSearch(); }}
                style={{
                  flex: 1,
                  padding: 'var(--space-2) var(--space-3)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                }}
              />
              <button
                className="btn-primary"
                onClick={() => void handleSkuSearch()}
                disabled={!skuInput.trim() || searching}
                style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}
              >
                {searching ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span className="spinner spinner-sm" /> Buscando...
                  </span>
                ) : 'Buscar por SKU'}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Search Error */}
      {searchError && (
        <Card title="Resultados">
          <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{searchError}</p>
        </Card>
      )}

      {/* Search Results — target selection */}
      {skuSearchResults.length > 0 && (
        <Card title={`Destinos (${selectedTargets.size} de ${skuSearchResults.length} anuncio${skuSearchResults.length !== 1 ? 's' : ''} selecionado${selectedTargets.size !== 1 ? 's' : ''})`}>
          <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {/* Select all toggle */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-faint)',
              fontWeight: 500,
              cursor: 'pointer',
              marginBottom: 'var(--space-1)',
            }}>
              <input
                type="checkbox"
                checked={selectedTargets.size === skuSearchResults.length}
                onChange={handleToggleAll}
                style={{ accentColor: 'var(--accent)' }}
              />
              Selecionar todos
            </label>

            {skuSearchResults.map(item => {
              const key = `${item.seller_slug}:${item.item_id}`;
              return (
                <label
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: selectedTargets.has(key) ? 'var(--paper)' : 'var(--surface)',
                    borderRadius: 6,
                    border: `1px solid ${selectedTargets.has(key) ? 'var(--accent)' : 'var(--line)'}`,
                    cursor: 'pointer',
                    transition: 'border 0.15s, background 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedTargets.has(key)}
                    onChange={() => handleToggleTarget(key)}
                    style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
                  />
                  {item.thumbnail && (
                    <img
                      src={item.thumbnail}
                      alt=""
                      style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover', background: 'var(--surface)', flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                  }}>
                    {item.seller_name}
                  </span>
                </label>
              );
            })}
          </div>
        </Card>
      )}

      {/* Empty state after search */}
      {hasSearched && !searching && skuSearchResults.length === 0 && !searchError && (
        <Card title="Resultados">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-faint)' }}>
            Nenhum anuncio encontrado com esse SKU.
          </p>
        </Card>
      )}

      {/* Apply Photos Button (US-011) */}
      {preview && hasSearched && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn-primary"
            onClick={() => void handleApply()}
            disabled={!canApply}
            style={{
              padding: 'var(--space-3) var(--space-6)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              opacity: canApply ? 1 : 0.5,
              cursor: canApply ? 'pointer' : 'not-allowed',
            }}
          >
            {applying ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span className="spinner spinner-sm" /> Aplicando...
              </span>
            ) : `Aplicar fotos (${selectedTargets.size})`}
          </button>
        </div>
      )}
    </div>
  );
}
