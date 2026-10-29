/**
 * Payload types of the CT2 integrity module (docs/REGRAS_CT2_INTEGRIDADE.md): reading reconciliation (section 2),
 * the invariants of the reading (CI-1, CI-2, CI-4; section 8) and the totals of the Base. They carry
 * `module: 'ct2Integrity'`; the CFGR700 payloads carry no mark, so their content does not change.
 */
import type { Alert, CheckResult, EntryIntegrity, Stage } from '../protocol';
import type { Reconciliation, Summary } from './cfgr700';

/** Processing stages of the CT2 reading; the first three repeat for each file. */
export const CT2_STAGES = ['fileCheck', 'sharedStrings', 'rows', 'reconciliation', 'sort', 'checks'] as const satisfies readonly Stage[];

/** Detail rows with a value that cannot be used (CI-4), by kind. */
export interface Ct2Unreadable {
  /** A field of the document key (date, batch, sub-batch, document) empty. */
  incompleteKey: number;
  /** Line empty. */
  line: number;
  /** Balance type or currency empty. */
  segment: number;
  /** Date not a valid dd/mm/aaaa or a whole Excel date. */
  date: number;
  /** Amount unreadable, or empty outside history continuation lines. */
  amount: number;
  /** Numeric code that is not a whole number. */
  code: number;
  /** Cell pointing outside the shared strings. */
  sharedString: number;
}

export interface Ct2FileReconciliation {
  fileIndex: number;
  name: string;
  size: number;
  sha256: string;
  entries: EntryIntegrity[];
  sheetName: string;
  sheetNames: string[];
  header: {
    row: number;
    /** Columns found for the fields of the configuration (1-based column numbers). */
    mapped: { field: string; title: string; column: number }[];
    /** Optional columns absent from the file. */
    missingOptional: string[];
    /** Other columns of the extraction, kept in the Base. */
    unmapped: string[];
  };
  rows: {
    /** Last row according to <dimension>, when present. */
    dimensionRows: number | null;
    /** Rows of the sheet, up to the last one (or the dimension). */
    totalRows: number;
    headerRow: number;
    rowsAfterHeader: number;
    /** Rows without any value after the header, including rows missing from the XML. */
    blankRows: number;
    /** Rows absent from the XML (gaps in the r attribute and after the last row), included in blankRows. */
    missingRows: number;
    detailRows: number;
    /** rowsAfterHeader − blankRows = detailRows. */
    balanced: boolean;
    /**
     * Values in columns without a title, or beyond the columns read: not stored, so the reading fails CI-1. A cell
     * without text (only a style, or spaces) is not a value.
     */
    outsideCells: number;
  };
  unreadable: Ct2Unreadable & { rows: number; examples: number[] };
  /** "Valor Moeda1" present but unreadable (alert; the I4 test does not use these lines). */
  amountCurrency1Unreadable: number;
  alerts: Alert[];
  timings: { stage: Stage; ms: number }[];
}

export interface Ct2Reconciliation {
  module: 'ct2Integrity';
  files: Ct2FileReconciliation[];
  consolidated: { detailRows: number; alerts: Alert[] };
  checks: CheckResult[];
  totalMs: number;
}

/** Totals of one segment (balance type + currency), section 3: balances are never added across segments. */
export interface Ct2Segment {
  balanceType: string;
  currency: string;
  lines: number;
  documents: number;
  /** Section 4: double entry on both sides; history continuation and unknown types on none. Unreadable amounts left out. */
  debitCents: number;
  creditCents: number;
}

export interface Ct2Summary {
  module: 'ct2Integrity';
  lines: number;
  segments: Ct2Segment[];
  /** Blocks of the Base (CI-2): documents and batches are counted per segment and day. */
  documents: number;
  batches: number;
  days: number;
  /** First and last valid entry date (day numbers); null when none is valid. */
  firstDay: number | null;
  lastDay: number | null;
}

export function isCt2Reconciliation(r: Reconciliation | Ct2Reconciliation): r is Ct2Reconciliation {
  return 'module' in r && r.module === 'ct2Integrity';
}

export function isCt2Summary(s: Summary | Ct2Summary): s is Ct2Summary {
  return 'module' in s && s.module === 'ct2Integrity';
}
