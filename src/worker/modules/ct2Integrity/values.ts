/**
 * Values of the cells of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2 and 4): codes, line ordinal,
 * entry type and the side of the amount. Pure functions.
 */
import type { Ct2IntegrityConfig } from '../../../config/ct2IntegritySchema';
import { CellKind } from '../../ingest/sheetStream';

/**
 * Code of a cell: text without spaces at the ends (zeros at the left kept); a numeric cell becomes text padded with
 * zeros to `width`. '' when empty; null when a numeric cell is not a whole number (unreadable).
 */
export function codeFromCell(kind: CellKind, text: string, width: number): string | null {
  if (kind === CellKind.Empty) return '';
  if (kind === CellKind.Number) {
    if (text.trim() === '') return '';
    const v = Number(text);
    if (!Number.isSafeInteger(v) || v < 0) return null;
    return String(v).padStart(width, '0');
  }
  return text.trim();
}

/** Value of a cell of a column not mapped to a field (kept in the Base): numbers stay numbers; empty is null. */
export function otherValue(kind: CellKind, text: string): string | number | null {
  if (text === '') return null;
  if (kind === CellKind.Number && text.trim() !== '') {
    const n = Number(text);
    if (Number.isFinite(n)) return n;
  }
  return text;
}

/** Ordinal of a numeric line ("001" → 1); null for the alphanumeric ones ("A00"), which sort after 999 by their text. */
export function lineOrdinal(line: string): number | null {
  return /^\d+$/.test(line) ? Number(line) : null;
}

export type EntryType = keyof Ct2IntegrityConfig['entryTypes'];

/** Entry type of a value of the column (texts of the extraction or CT2_DC codes); null when not recognized. */
export function entryTypeLookup(config: Ct2IntegrityConfig): (text: string) => EntryType | null {
  const byValue = new Map<string, EntryType>();
  for (const [type, values] of Object.entries(config.entryTypes) as [EntryType, string[]][]) {
    for (const v of values) byValue.set(v.trim(), type);
  }
  return (text) => byValue.get(text.trim()) ?? null;
}

/** Debit and credit of a line (section 4): double entry on both sides, history continuation and unknown on none. */
export function sidesOf(type: EntryType | null, cents: number): { debit: number; credit: number } {
  switch (type) {
    case 'debitCredit':
      return { debit: cents, credit: cents };
    case 'debit':
      return { debit: cents, credit: 0 };
    case 'credit':
      return { debit: 0, credit: cents };
    default:
      return { debit: 0, credit: 0 };
  }
}
