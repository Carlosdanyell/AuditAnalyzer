/**
 * Chart of accounts loaded with the CT2 extraction (configuration `chart`, version 4; decisions of 18/11/2026): one
 * entry per distinct account with the flags of the entities it requires or accepts, for the tests C1-C5. Read in the
 * same pass as the extraction files (readSheet), kept in the worker's memory with the Base and never stored. The
 * rules of the tests (CHART_RULES, sideFails) are pure and shared by the analysis and the reasons.
 */
import { CT2_CHART_FLAGS, CT2_ENTITY_PAIRS, type CT2_CHART_TESTS, type Ct2ChartFlag, type Ct2IntegrityConfig } from '../../../config/ct2IntegritySchema';
import type { ChartHeaderMatch } from '../../../modules/ct2Integrity/header';
import type { CellText } from '../../ingest/readSheet';
import { CellKind, type ParsedRow } from '../../ingest/sheetStream';
import type { TextField } from './store';

/** A flag of an account: yes, no, or unknown (blank, another value, or an account repeated with other flags). */
export type ChartValue = 'yes' | 'no' | null;
export type ChartFlags = Record<Ct2ChartFlag, ChartValue>;
export type Ct2ChartTest = (typeof CT2_CHART_TESTS)[number];

export interface Ct2Chart {
  /** Flags of each distinct account, by its exact text (trimmed), in reading order. */
  accounts: Map<string, ChartFlags>;
  /** Flag columns found in the chart; the others are unknown for every account. */
  columns: readonly Ct2ChartFlag[];
}

/** Counts of the reading of the chart (Ct2ChartReconciliation). */
export interface ChartCounts {
  rows: number;
  withoutAccount: number;
  repeatedRows: number;
  duplicates: number;
  conflicting: number;
  unknownFlags: number;
}

const isBlank = (t: string) => t.trim() === '';
/** Flag values compared after trim and without case (the same as the validation of the configuration). */
const flagKey = (v: string) => v.trim().toLowerCase();

/** Account of a cell: the text without spaces at the ends; a whole number as its integer text. */
export function accountFromCell(kind: CellKind, text: string): string {
  if (kind === CellKind.Number) {
    const v = Number(text);
    if (Number.isSafeInteger(v)) return String(v);
  }
  return text.trim();
}

/** Value of a flag cell under the yes/no values of the configuration. */
export function flagValue(config: Ct2IntegrityConfig): (text: string) => ChartValue {
  const yes = new Set(config.chart.yes.map(flagKey));
  const no = new Set(config.chart.no.map(flagKey));
  return (text) => {
    const key = flagKey(text);
    return yes.has(key) ? 'yes' : no.has(key) ? 'no' : null;
  };
}

/** Reads the detail rows of the chart sheet, given one by one after its header. */
export class ChartReader {
  private readonly accounts = new Map<string, ChartFlags>();
  /** Accounts read more than once: whether every repetition had the flags of the first row. */
  private readonly repeated = new Map<string, boolean>();
  private readonly flag: (text: string) => ChartValue;
  private readonly flagColumns: { flag: Ct2ChartFlag; column: number }[];
  private readonly accountColumn: number;
  private readonly counts: ChartCounts = { rows: 0, withoutAccount: 0, repeatedRows: 0, duplicates: 0, conflicting: 0, unknownFlags: 0 };

  constructor(
    private readonly header: ChartHeaderMatch,
    config: Ct2IntegrityConfig,
    private readonly width: number,
  ) {
    this.flag = flagValue(config);
    this.accountColumn = header.columns.account!;
    this.flagColumns = CT2_CHART_FLAGS.flatMap((flag) => (header.columns[flag] === undefined ? [] : [{ flag, column: header.columns[flag] }]));
  }

  get headerRow(): number {
    return this.header.row;
  }

  onRow(r: number, row: ParsedRow, cell: CellText): void {
    if (r <= this.header.row) return;
    let content = false;
    for (let c = 0; c < this.width && !content; c++) if (row.kind[c] !== CellKind.Empty && !isBlank(cell(row, c))) content = true;
    for (let e = 0; e < row.extras && !content; e++) if (!isBlank(cell(row, this.width + e))) content = true;
    if (!content) return;
    this.counts.rows++;
    const column = this.accountColumn;
    const account = row.kind[column] === CellKind.Empty ? '' : accountFromCell(row.kind[column] as CellKind, cell(row, column));
    if (account === '') {
      this.counts.withoutAccount++;
      return;
    }
    const flags = Object.fromEntries(CT2_CHART_FLAGS.map((f) => [f, null])) as ChartFlags;
    for (const { flag, column } of this.flagColumns) {
      const value = row.kind[column] === CellKind.Empty ? null : this.flag(cell(row, column));
      if (value === null) this.counts.unknownFlags++;
      flags[flag] = value;
    }
    const first = this.accounts.get(account);
    if (!first) {
      this.accounts.set(account, flags);
      return;
    }
    this.counts.repeatedRows++;
    const same = CT2_CHART_FLAGS.every((f) => first[f] === flags[f]);
    this.repeated.set(account, (this.repeated.get(account) ?? true) && same);
  }

  /** The chart and its counts; an account repeated with other flags has every flag unknown. */
  finish(): { chart: Ct2Chart; counts: ChartCounts } {
    for (const [account, same] of this.repeated) {
      if (same) this.counts.duplicates++;
      else {
        this.counts.conflicting++;
        this.accounts.set(account, Object.fromEntries(CT2_CHART_FLAGS.map((f) => [f, null])) as ChartFlags);
      }
    }
    return { chart: { accounts: this.accounts, columns: this.flagColumns.map((c) => c.flag) }, counts: this.counts };
  }
}

/**
 * The tests against the chart (decisions of 18/11/2026): the flag of the account each one reads, the value that makes
 * the side checked, the entity of each side and whether an empty (required, C1-C2) or a filled entity (not accepted,
 * C3-C5) fails the side.
 */
export const CHART_RULES: Record<Ct2ChartTest, { flag: Ct2ChartFlag; when: 'yes' | 'no'; entity: readonly [TextField, TextField]; fails: 'empty' | 'filled' }> = {
  C1: { flag: 'costCenterRequired', when: 'yes', entity: CT2_ENTITY_PAIRS[0], fails: 'empty' },
  C2: { flag: 'itemRequired', when: 'yes', entity: CT2_ENTITY_PAIRS[1], fails: 'empty' },
  C3: { flag: 'costCenterAccepted', when: 'no', entity: CT2_ENTITY_PAIRS[0], fails: 'filled' },
  C4: { flag: 'itemAccepted', when: 'no', entity: CT2_ENTITY_PAIRS[1], fails: 'filled' },
  C5: { flag: 'valueClassAccepted', when: 'no', entity: CT2_ENTITY_PAIRS[2], fails: 'filled' },
};

/**
 * Sides of a line by its entry type (stored code, values.ts): the same rule as the side of the amount — debit on a
 * double entry and a debit, credit on a double entry and a credit, none on a history continuation or an unknown type.
 */
export const lineSides = (entryType: number): { debit: boolean; credit: boolean } => ({ debit: entryType === 1 || entryType === 2, credit: entryType === 1 || entryType === 3 });

/** Whether a side fails a test: its account found with the flag of the rule, and its entity empty or filled. */
export function sideFails(rule: (typeof CHART_RULES)[Ct2ChartTest], flags: ChartFlags | undefined, entity: string): boolean {
  return flags !== undefined && flags[rule.flag] === rule.when && (rule.fails === 'empty') === (entity === '');
}
