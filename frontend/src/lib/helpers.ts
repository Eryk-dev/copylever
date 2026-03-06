import type { CopyLog } from './api';

export function isDimensionError(log: CopyLog): boolean {
  if (log.status === 'needs_dimensions') return true;
  if (log.status === 'error' && log.error_details) {
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
