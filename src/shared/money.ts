/**
 * CT2_VALOR text → integer cents (docs/REGRAS_CFGR700.md, section 2). Accepted formats: integer ("1234")
 * or up to two decimals with a dot ("1234.56"), surrounding spaces ignored. Anything else is unreadable:
 * never rounded, never guessed.
 */

/** The text is empty (allowed only on unidentified records). */
export const MONEY_EMPTY = -1;
/** The text is not in an accepted format. */
export const MONEY_INVALID = -2;

const FORMAT = /^(\d+)(?:\.(\d{1,2}))?$/;

export function parseCents(text: string): number {
  const s = text.trim();
  if (s === '') return MONEY_EMPTY;
  const m = FORMAT.exec(s);
  if (!m) return MONEY_INVALID;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : MONEY_INVALID;
}
