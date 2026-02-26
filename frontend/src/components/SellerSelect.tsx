import type { Seller } from '../lib/api';

interface Props {
  sellers: Seller[];
  value: string;
  onChange: (slug: string) => void;
  placeholder?: string;
}

export default function SellerSelect({ sellers, value, onChange, placeholder }: Props) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="input-base select-with-arrow"
      style={{
        width: '100%',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--paper)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        color: value ? 'var(--ink)' : 'var(--ink-faint)',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-sans)',
        appearance: 'none',
        cursor: 'pointer',
      }}
    >
      <option value="">{placeholder || 'Selecione...'}</option>
      {sellers.map(seller => (
        <option key={seller.slug} value={seller.slug}>
          {seller.name || seller.slug} (ML: {seller.ml_user_id})
        </option>
      ))}
    </select>
  );
}
