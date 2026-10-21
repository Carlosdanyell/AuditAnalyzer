/**
 * The detail rows of the CT2 extraction in the worker's memory (docs/ARQUITETURA.md, section 1.3): numbers in typed
 * arrays grown in fixed blocks, texts in packed columns. Rows in reading order (file, row); the Base order is a
 * separate permutation (order.ts).
 */
import { ChunkedArray } from '../../store/chunked';
import { PackedColumn } from '../../store/packedColumn';

/** Mapped fields kept as text (codes keep their zeros). */
export const TEXT_FIELDS = [
  'batch',
  'subBatch',
  'document',
  'line',
  'balanceType',
  'currency',
  'entryType',
  'debitAccount',
  'creditAccount',
  'history',
  'routine',
  'standardEntry',
  'ctkSequence',
  'manual',
  'origin',
  'companyOrigin',
  'branchOrigin',
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export interface Ct2StoreRow {
  source: number;
  sourceRow: number;
  /** Day number, or INVALID_TIME. */
  day: number;
  /** Cents; NaN when unreadable. */
  amount: number;
  /** Cents; NaN when empty or unreadable. */
  amountCurrency1: number;
  /** 0 = not recognized; 1-4 = the entry types of the configuration, in order. */
  entryType: number;
  /** Reading problems of the row (CI-4), as bits of `RowFlag`. */
  flags: number;
  text: Partial<Record<TextField, string>>;
}

export class Ct2Store {
  readonly source = new ChunkedArray((n) => new Uint8Array(n));
  readonly sourceRow = new ChunkedArray((n) => new Uint32Array(n));
  readonly day = new ChunkedArray((n) => new Int32Array(n));
  readonly amount = new ChunkedArray((n) => new Float64Array(n));
  readonly amountCurrency1 = new ChunkedArray((n) => new Float64Array(n));
  readonly entryType = new ChunkedArray((n) => new Uint8Array(n));
  readonly flags = new ChunkedArray((n) => new Uint16Array(n));
  readonly text = Object.fromEntries(TEXT_FIELDS.map((f) => [f, new PackedColumn()])) as Record<TextField, PackedColumn>;
  /** Columns of the extraction not mapped to a field, by title, in order of first appearance. */
  readonly other = new Map<string, PackedColumn>();

  get rows(): number {
    return this.source.length;
  }

  pushRow(row: Ct2StoreRow): void {
    this.source.push(row.source);
    this.sourceRow.push(row.sourceRow);
    this.day.push(row.day);
    this.amount.push(row.amount);
    this.amountCurrency1.push(row.amountCurrency1);
    this.entryType.push(row.entryType);
    this.flags.push(row.flags);
    for (const f of TEXT_FIELDS) this.text[f].push(row.text[f] ?? null);
  }

  /** The unmapped column with this title, created empty for the rows already stored. */
  otherColumn(title: string): PackedColumn {
    let column = this.other.get(title);
    if (!column) {
      column = new PackedColumn();
      column.padTo(this.rows - 1);
      this.other.set(title, column);
    }
    return column;
  }

  /** Every unmapped column with one value per row (after a file without some of them). */
  padOther(): void {
    for (const column of this.other.values()) column.padTo(this.rows);
  }

  bytes(): number {
    const arrays = [this.source, this.sourceRow, this.day, this.amount, this.amountCurrency1, this.entryType, this.flags];
    const columns = [...Object.values(this.text), ...this.other.values()];
    return arrays.reduce((n, a) => n + a.bytes(), 0) + columns.reduce((n, c) => n + c.bytes(), 0);
  }
}
