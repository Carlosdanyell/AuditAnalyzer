/**
 * A column of text or numbers stored in the narrowest form that fits (docs/ARQUITETURA.md, section 1.3): nothing while
 * every row is empty or equal; otherwise a code per row (1, 2 or 4 bytes) into a table of the distinct values of the
 * column; a column of many distinct numbers (e.g. amounts) keeps the numbers themselves (8 bytes) instead of a table.
 */
import { ChunkedArray } from './chunked';

export type PackedValue = string | number;

/** Distinct values beyond which a column of numbers keeps the numbers instead of codes. */
const NUMERIC_AFTER = 65536;

type Codes = ChunkedArray<Uint8Array> | ChunkedArray<Uint16Array> | ChunkedArray<Uint32Array>;

const makeCodes = (distinct: number): Codes =>
  distinct <= 0xff
    ? new ChunkedArray((n) => new Uint8Array(n))
    : distinct <= 0xffff
      ? new ChunkedArray((n) => new Uint16Array(n))
      : new ChunkedArray((n) => new Uint32Array(n));

export class PackedColumn {
  /** Value of each code; code 0 is the empty cell. */
  private table: (PackedValue | null)[] = [null];
  private index = new Map<PackedValue, number>();
  /** Null while every row has `constant` as its code. */
  private codes: Codes | null = null;
  private codeBytes: 1 | 2 | 4 = 1;
  private constant = 0;
  /** Set when the column keeps numbers (NaN = empty). */
  private numbers: ChunkedArray<Float64Array> | null = null;
  private onlyNumbers = true;
  length = 0;

  /** Bytes per row: 0 (empty or constant), 1, 2, 4 (codes) or 8 (numbers). */
  get width(): 0 | 1 | 2 | 4 | 8 {
    return this.numbers ? 8 : this.codes ? this.codeBytes : 0;
  }

  /** Distinct values other than empty (in code mode). */
  get distinct(): number {
    return this.table.length - 1;
  }

  push(value: PackedValue | null): void {
    if (value === '') value = null;
    if (this.numbers) {
      if (value === null || typeof value === 'number') {
        this.numbers.push(value ?? NaN);
        this.length++;
        return;
      }
      this.backToCodes();
    }
    this.pushCode(this.codeOf(value));
  }

  /** Empty rows up to `rows` (a column absent from a file, or added after the first file). */
  padTo(rows: number): void {
    while (this.length < rows) this.push(null);
  }

  get(index: number): PackedValue | null {
    if (this.numbers) {
      const v = this.numbers.get(index);
      return Number.isNaN(v) ? null : v;
    }
    return this.table[this.code(index)]!;
  }

  /** Code of a row (code mode only). */
  code(index: number): number {
    return this.codes ? this.codes.get(index) : this.constant;
  }

  /** Rank of each code: 0 for empty, then the values in order of their text (code units, no locale). */
  ranks(): Uint32Array {
    if (this.numbers) throw new Error('Coluna numérica sem códigos.');
    const order = this.table.map((v, code) => ({ text: v === null ? '' : String(v), code })).slice(1);
    order.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : a.code - b.code));
    const rank = new Uint32Array(this.table.length);
    order.forEach((o, i) => (rank[o.code] = i + 1));
    return rank;
  }

  bytes(): number {
    return this.numbers ? this.numbers.bytes() : (this.codes?.bytes() ?? 0);
  }

  private codeOf(value: PackedValue | null): number {
    if (value === null) return 0;
    let code = this.index.get(value);
    if (code === undefined) {
      code = this.table.length;
      this.table.push(value);
      this.index.set(value, code);
      if (typeof value !== 'number') this.onlyNumbers = false;
    }
    return code;
  }

  private pushCode(code: number): void {
    if (!this.codes) {
      if (this.length === 0 || code === this.constant) {
        this.constant = code;
        this.length++;
        return;
      }
      this.codes = makeCodes(this.distinct);
      this.codeBytes = this.distinct <= 0xff ? 1 : this.distinct <= 0xffff ? 2 : 4;
      for (let i = 0; i < this.length; i++) this.codes.push(this.constant);
    } else if (this.distinct > (this.codeBytes === 1 ? 0xff : this.codeBytes === 2 ? 0xffff : Infinity)) {
      this.codeBytes = this.codeBytes === 1 ? 2 : 4;
      this.codes = this.codeBytes === 2 ? this.codes.convert((n) => new Uint16Array(n)) : this.codes.convert((n) => new Uint32Array(n));
    }
    this.codes.push(code);
    this.length++;
    if (this.onlyNumbers && this.distinct > NUMERIC_AFTER) this.toNumbers();
  }

  /** Many distinct numbers: keep the numbers, drop the table. */
  private toNumbers(): void {
    const numbers = new ChunkedArray((n) => new Float64Array(n));
    for (let i = 0; i < this.length; i++) {
      const v = this.table[this.code(i)];
      numbers.push(typeof v === 'number' ? v : NaN);
    }
    this.numbers = numbers;
    this.codes = null;
    this.table = [null];
    this.index = new Map();
  }

  /** A text arrived in a column of numbers: back to codes, for good. */
  private backToCodes(): void {
    const numbers = this.numbers!;
    this.numbers = null;
    this.onlyNumbers = false;
    this.codes = new ChunkedArray((n) => new Uint32Array(n));
    this.codeBytes = 4;
    const rows = this.length;
    this.length = 0;
    for (let i = 0; i < rows; i++) {
      const v = numbers.get(i);
      this.codes.push(this.codeOf(Number.isNaN(v) ? null : v));
      this.length++;
    }
  }
}
