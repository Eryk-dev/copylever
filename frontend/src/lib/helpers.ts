import type { CopyLog, CorrectionDetails } from './api';

function hasDimensionMessage(log: CopyLog): boolean {
  if (log.status === 'needs_dimensions') return true;
  if ((log.status === 'needs_correction' || log.status === 'error') && log.error_details) {
    return Object.values(log.error_details).some(
      msg => typeof msg === 'string' && (
        msg.toLowerCase().includes('dimenso') ||
        msg.toLowerCase().includes('dimension') ||
        msg.toLowerCase().includes('weight')
      )
    );
  }
  return false;
}

export function isDimensionError(log: CopyLog): boolean {
  const details = log.correction_details;
  if (details?.kind === 'dimensions') return true;
  return hasDimensionMessage(log);
}

export function isTitleLengthError(log: CopyLog): boolean {
  const details = log.correction_details;
  return details?.kind === 'title';
}

export function isCorrectionPending(log: CopyLog): boolean {
  return log.status === 'needs_correction' || isDimensionError(log);
}

export function getCorrectionDetails(log: CopyLog): CorrectionDetails | null {
  if (log.correction_details) return log.correction_details;
  if (hasDimensionMessage(log)) {
    return {
      kind: 'dimensions',
      group_key: 'dimensions',
      summary: 'Item sem dimensoes de envio. Informe as dimensoes para continuar.',
      fields: [
        { id: 'height', label: 'Altura', input: 'number', unit: 'cm', step: '0.1', min: 0, placeholder: 'ex: 34' },
        { id: 'width', label: 'Largura', input: 'number', unit: 'cm', step: '0.1', min: 0, placeholder: 'ex: 22' },
        { id: 'length', label: 'Comprimento', input: 'number', unit: 'cm', step: '0.1', min: 0, placeholder: 'ex: 30' },
        { id: 'weight', label: 'Peso', input: 'number', unit: 'g', step: '1', min: 0, placeholder: 'ex: 2360' },
      ],
    };
  }
  return null;
}
