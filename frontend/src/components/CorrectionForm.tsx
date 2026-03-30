import { useState } from 'react';

export interface CorrectionField {
  id: string;
  label: string;
  input?: 'text' | 'number';
  unit?: string;
  step?: string;
  min?: number;
  placeholder?: string;
  maxLength?: number;
}

interface CorrectionFormProps {
  title: string;
  description?: React.ReactNode;
  fields: CorrectionField[];
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: Record<string, string | number>) => Promise<void> | void;
}

export default function CorrectionForm({
  title,
  description,
  fields,
  submitLabel,
  submittingLabel,
  onSubmit,
}: CorrectionFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const hasAnyValue = fields.some(field => (values[field.id] || '').trim() !== '');

  const handleSubmit = async () => {
    const cleaned: Record<string, string | number> = {};
    for (const field of fields) {
      const raw = (values[field.id] || '').trim();
      if (!raw) continue;
      cleaned[field.id] = field.input === 'number' ? Number(raw) : raw;
    }
    if (Object.keys(cleaned).length === 0) return;

    setSubmitting(true);
    try {
      await onSubmit(cleaned);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    fontSize: 'var(--text-sm)',
    fontVariantNumeric: 'tabular-nums',
  };

  const labelStyle = (field: CorrectionField): React.CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: field.maxLength ? '1 1 100%' : 1,
    minWidth: field.maxLength ? 200 : 80,
    fontSize: 'var(--text-xs)',
    color: 'var(--ink-faint)',
    fontWeight: 500,
  });

  return (
    <div style={{
      marginBottom: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'rgba(245, 158, 11, 0.06)',
      border: '1px solid rgba(245, 158, 11, 0.2)',
      borderRadius: 6,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-2)',
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        color: 'var(--warning)',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'var(--warning)', flexShrink: 0,
        }} />
        {title}
      </div>

      {description && (
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--ink-muted)',
          marginBottom: 'var(--space-3)',
          lineHeight: 'var(--leading-normal)',
        }}>
          {description}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {fields.map(field => (
          <label key={field.id} style={labelStyle(field)}>
            {field.label}{field.unit ? ` (${field.unit})` : ''}
            <input
              type={field.input === 'number' ? 'number' : 'text'}
              step={field.input === 'number' ? (field.step || '0.1') : undefined}
              min={field.input === 'number' ? (field.min ?? 0) : undefined}
              maxLength={field.maxLength}
              value={values[field.id] || ''}
              onChange={e => setValues(prev => ({ ...prev, [field.id]: e.target.value }))}
              style={inputStyle}
              placeholder={field.placeholder}
            />
            {field.maxLength && values[field.id] && (
              <span style={{
                fontSize: '10px',
                color: (values[field.id]?.length || 0) > field.maxLength ? 'var(--danger)' : 'var(--ink-faint)',
                textAlign: 'right',
              }}>
                {values[field.id]?.length || 0}/{field.maxLength}
              </span>
            )}
          </label>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || !hasAnyValue}
        style={{
          marginTop: 'var(--space-3)',
          padding: '8px 20px',
          borderRadius: 6,
          background: 'var(--warning)',
          color: '#000',
          fontWeight: 600,
          fontSize: 'var(--text-sm)',
          cursor: 'pointer',
          opacity: submitting || !hasAnyValue ? 0.5 : 1,
        }}
      >
        {submitting ? submittingLabel : submitLabel}
      </button>
    </div>
  );
}
