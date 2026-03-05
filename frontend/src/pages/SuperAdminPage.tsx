interface Props {
  headers: () => Record<string, string>;
}

export default function SuperAdminPage({ headers: _headers }: Props) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 12,
      padding: 'var(--space-8)',
      textAlign: 'center',
      color: 'var(--ink-muted)',
    }}>
      <p>Painel de super-admin em breve.</p>
    </div>
  );
}
