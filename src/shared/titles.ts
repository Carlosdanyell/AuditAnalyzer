/**
 * Column titles as compared when locating a column (docs/REGRAS_CT2_INTEGRIDADE.md, section 2): without spaces at the
 * ends and with repeated inner spaces reduced to one. Case and accents are kept.
 */
export function normalizeTitle(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
