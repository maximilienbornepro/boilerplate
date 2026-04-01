import type { CVData } from '../types.js';
import type { TermReplacement } from './types.js';

export interface ValidationWarning {
  type: 'structural_change' | 'language_mismatch' | 'empty_replacement';
  message: string;
  elementId?: string;
}

export interface ValidationResult {
  valid: boolean;
  warnings: ValidationWarning[];
}

/**
 * Validate that optimization did not alter structural CV data
 * (companies, periods, formations) and replacements are non-empty.
 */
export function validateOptimization(
  original: CVData,
  optimized: CVData,
  replacements: TermReplacement[]
): ValidationResult {
  const warnings: ValidationWarning[] = [];

  // Check no structural changes (companies, periods, formations)
  const origCompanies = (original.experiences || []).map(e => e.company);
  const optCompanies = (optimized.experiences || []).map(e => e.company);
  if (JSON.stringify(origCompanies) !== JSON.stringify(optCompanies)) {
    warnings.push({ type: 'structural_change', message: 'Company names were modified' });
  }

  const origPeriods = (original.experiences || []).map(e => e.period);
  const optPeriods = (optimized.experiences || []).map(e => e.period);
  if (JSON.stringify(origPeriods) !== JSON.stringify(optPeriods)) {
    warnings.push({ type: 'structural_change', message: 'Experience periods were modified' });
  }

  // Check experience count unchanged
  if ((original.experiences || []).length !== (optimized.experiences || []).length) {
    warnings.push({ type: 'structural_change', message: 'Number of experiences changed' });
  }

  // Check formation count unchanged
  if ((original.formations || []).length !== (optimized.formations || []).length) {
    warnings.push({ type: 'structural_change', message: 'Number of formations changed' });
  }

  // Check no empty replacements
  for (const rep of replacements) {
    if (!rep.replacedText.trim()) {
      warnings.push({
        type: 'empty_replacement',
        message: 'Replacement resulted in empty text',
        elementId: rep.elementId,
      });
    }
  }

  return {
    valid: warnings.filter(w => w.type === 'structural_change').length === 0,
    warnings,
  };
}
