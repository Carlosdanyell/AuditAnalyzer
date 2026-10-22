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

/**
 * Amount of a numeric cell (the text of <v>, e.g. "1234.5599999999999") → integer cents, Math.round(v * 100)
 * (docs/REGRAS_CT2_INTEGRIDADE.md, section 2); NaN when it is not a finite number or out of the exact range.
 */
export function centsFromNumberText(text: string): number {
  if (text.trim() === '') return NaN;
  const v = Number(text);
  if (!Number.isFinite(v)) return NaN;
  const cents = Math.round(v * 100);
  // + 0 turns -0 into 0.
  return Number.isSafeInteger(cents) ? cents + 0 : NaN;
}

const BR_FORMAT = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Amount written as pt-BR text ("1.234,56": optional minus, thousands with dots, up to two decimals after the comma)
 * → integer cents; NaN for any other format (never guessed).
 */
export function centsFromBrText(text: string): number {
  const m = BR_FORMAT.exec(text.trim());
  if (!m) return NaN;
  const cents = Number(m[2]!.replace(/\./g, '')) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return NaN;
  return m[1] && cents !== 0 ? -cents : cents;
}
