import CorrectionForm, { type CorrectionField } from './CorrectionForm';

export interface Dimensions {
  height?: number;
  width?: number;
  length?: number;
  weight?: number;
}

interface DimensionFormProps {
  sku?: string;
  itemIds: string[];
  destinations: string[];
  onSubmit: (dims: Dimensions) => void | Promise<void>;
}

const dimensionFields: CorrectionField[] = [
  { id: 'height', label: 'Altura', input: 'number', unit: 'cm', step: '0.1', min: 0, placeholder: 'ex: 34' },
  { id: 'width', label: 'Largura', input: 'number', unit: 'cm', step: '0.1', min: 0, placeholder: 'ex: 22' },
  { id: 'length', label: 'Comprimento', input: 'number', unit: 'cm', step: '0.1', min: 0, placeholder: 'ex: 30' },
  { id: 'weight', label: 'Peso', input: 'number', unit: 'g', step: '1', min: 0, placeholder: 'ex: 2360' },
];

export default function DimensionForm({ sku, itemIds, destinations, onSubmit }: DimensionFormProps) {
  const description = (
    <>
      {sku && (
        <>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>SKU: {sku}</span>
          {' — '}
        </>
      )}
      {itemIds.length === 1 ? (
        <span style={{ fontFamily: 'var(--font-mono)' }}>{itemIds[0]}</span>
      ) : (
        <span>{itemIds.length} anúncio(s): <span style={{ fontFamily: 'var(--font-mono)' }}>{itemIds.join(', ')}</span></span>
      )}
      {' '}&rarr; {destinations.join(', ')}
      <br />
      Informe as dimensões da embalagem para atualizar {itemIds.length > 1 ? 'os itens de origem' : 'o item origem'} e copiar.
    </>
  );

  return (
    <CorrectionForm
      title="Correção necessária"
      description={description}
      fields={dimensionFields}
      submitLabel="Aplicar dimensões e copiar"
      submittingLabel="Aplicando..."
      onSubmit={values => onSubmit(values as Dimensions)}
    />
  );
}
