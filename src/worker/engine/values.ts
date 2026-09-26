/**
 * How a changed value is shown to the reader (docs/REGRAS_CFGR700.md, section 12): codes with a configured
 * description ("9 — Pré-lançamento"; the entry type uses the nature labels) and internal encodings of the system
 * (the user/date stamp) replaced by "—". The value itself is never altered in the analysis.
 */
import type { AnalyzerConfig } from '../../config/schema';

export const ENCODED_PLACEHOLDER = '—';

/** `describe` translates a configured description (export in English); identity by default. */
export function displayValue(
  config: AnalyzerConfig,
  field: string,
  raw: string,
  describe: (field: string, code: string, label: string) => string = (_f, _c, label) => label,
): string {
  if (raw === '') return '';
  if (config.valueDisplay.encoded.includes(field)) return ENCODED_PLACEHOLDER;
  const code = raw.trim();
  const labels = field === config.nature.field ? config.nature.labels : config.valueDisplay.codes[field];
  const label = labels?.[code];
  return label ? `${code} — ${describe(field, code, label)}` : raw;
}
