const statusLabels: Record<string, string> = {
  needs_dimensions: 'Aguardando dimensões',
  in_progress: 'Copiando...',
  pending: 'Pendente',
  success: 'Sucesso',
  error: 'Erro',
  partial: 'Parcial',
};

export default function StatusBadge({ status }: { status: string }) {
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
