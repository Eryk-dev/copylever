export interface StatusSummaryItem {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info';
}

interface Props {
  items: StatusSummaryItem[];
}

const palette: Record<NonNullable<StatusSummaryItem['tone']>, { color: string; background: string; border: string }> = {
  default: {
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: 'var(--line)',
  },
  success: {
    color: 'var(--success)',
    background: 'rgba(16, 185, 129, 0.08)',
    border: 'rgba(16, 185, 129, 0.14)',
  },
  danger: {
    color: 'var(--danger)',
    background: 'rgba(239, 68, 68, 0.08)',
    border: 'rgba(239, 68, 68, 0.14)',
  },
  warning: {
    color: 'var(--warning)',
    background: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.16)',
  },
  info: {
    color: 'var(--info)',
    background: 'var(--info-bg)',
    border: 'rgba(59, 130, 246, 0.16)',
  },
};

export default function StatusSummary({ items }: Props) {
  return (
    <div className="status-summary">
      {items.map((item) => {
        const tone = palette[item.tone || 'default'];
        return (
          <div
            key={item.label}
            className="status-summary-card"
            style={{
              background: tone.background,
              borderColor: tone.border,
            }}
          >
            <span className="status-summary-label">{item.label}</span>
            <strong className="status-summary-value" style={{ color: tone.color }}>
              {item.value}
            </strong>
          </div>
        );
      })}
    </div>
  );
}
