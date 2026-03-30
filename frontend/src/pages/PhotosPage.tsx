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

  // Initialize editable photos when preview loads
  useEffect(() => {
    if (preview) {
      setActivePhotos(preview.pictures.map(p => ({ type: 'existing' as const, ...p })));
      setRemovedPhotos([]);
    } else {
      setActivePhotos([]);
      setRemovedPhotos([]);
    }
    setUrlInput('');
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
    </div>
  );
}
