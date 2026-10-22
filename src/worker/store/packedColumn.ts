/**
 * A column of text or numbers stored in the narrowest form that fits (docs/ARQUITETURA.md, section 1.3): nothing while
 * every row is empty or equal; otherwise a code per row (1, 2 or 4 bytes) into a table of the distinct values of the
 * column; a column of many distinct numbers (e.g. amounts) keeps the numbers themselves (8 bytes) instead of a table;
 * a column of mostly distinct texts (e.g. histories) keeps the UTF-8 bytes of each row (TextBytes) instead of a table,
 * whose strings and index would cost far more.
 */
import { ChunkedArray } from './chunked';

export type PackedValue = string | number;

/** Distinct values beyond which a column of numbers keeps the numbers instead of codes. */
const NUMERIC_AFTER = 65536;
/** Approximate bytes of each entry of the table and its index, besides the characters (V8 string and map entry). */
const TABLE_ENTRY_BYTES = 100;
/** Size of each block of TextBytes; a value never spans two blocks. */
const BLOCK_BYTES = 1 << 20;
/** Marks a number among the texts (U+0000 never occurs in the text of a cell: XML does not allow it). */
const NUMBER_MARK = 0;

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/** Texts in UTF-8, one after the other in fixed blocks, with the end of each row (an empty row has no bytes). */
class TextBytes {
  private readonly blocks: Uint8Array[] = [];
  private readonly ends = new ChunkedArray((n) => new Uint32Array(n));
  private end = 0;

  push(value: PackedValue | null): void {
    if (value !== null) {
      const text = typeof value === 'number' ? String.fromCharCode(NUMBER_MARK) + String(value) : value;
      const most = text.length * 3;
      if (most > BLOCK_BYTES) throw new Error('Texto de célula maior que o limite do armazenamento.');
      let block = Math.floor(this.end / BLOCK_BYTES);
      let at = this.end - block * BLOCK_BYTES;
      if (at + most > BLOCK_BYTES) {
        block++;
        at = 0;
      }
      if (block === this.blocks.length) this.blocks.push(new Uint8Array(BLOCK_BYTES));
      const target = this.blocks[block]!;
      let written = 0;
      for (; written < text.length; written++) {
        const c = text.charCodeAt(written);
        if (c >= 0x80) break;
        target[at + written] = c;
      }
      if (written < text.length) written = encoder.encodeInto(text, target.subarray(at)).written;
      this.end = block * BLOCK_BYTES + at + written;
    }
    this.ends.push(this.end);
  }

  get(index: number): PackedValue | null {
    const end = this.ends.get(index);
    const previous = index === 0 ? 0 : this.ends.get(index - 1);
    if (end === previous) return null;
    // The value lies in the block of its last byte, from the previous end or from the start of that block.
    const block = Math.floor((end - 1) / BLOCK_BYTES);
    const start = Math.max(previous, block * BLOCK_BYTES);
    const bytes = this.blocks[block]!.subarray(start - block * BLOCK_BYTES, end - block * BLOCK_BYTES);
    if (bytes[0] === NUMBER_MARK) return Number(decoder.decode(bytes.subarray(1)));
    return decoder.decode(bytes);
  }

  bytes(): number {
    return this.blocks.length * BLOCK_BYTES + this.ends.bytes();
  }
}

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
  /** Set when the column keeps the texts themselves. */
  private text: TextBytes | null = null;
  /** Characters of the distinct texts of the table. */
  private tableChars = 0;
  /** Last value coded: repeated values skip the index. */
  private lastValue: PackedValue | null = null;
  private lastCode = 0;
  length = 0;

  /** How the rows are kept: one code for all, a code each, the numbers or the texts themselves. */
  get mode(): 'constant' | 'codes' | 'numbers' | 'text' {
    return this.text ? 'text' : this.numbers ? 'numbers' : this.codes ? 'codes' : 'constant';
  }

  /** Bytes per row: 0 (empty or constant), 1, 2, 4 (codes or the end of each text) or 8 (numbers). */
  get width(): 0 | 1 | 2 | 4 | 8 {
    return this.text ? 4 : this.numbers ? 8 : this.codes ? this.codeBytes : 0;
  }

  /** Distinct values other than empty (in code mode). */
  get distinct(): number {
    return this.table.length - 1;
  }

  push(value: PackedValue | null): void {
    if (value === '') value = null;
    if (this.text) {
      this.text.push(value);
      this.length++;
      return;
    }
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
    if (this.text) return this.text.get(index);
    if (this.numbers) {
      const v = this.numbers.get(index);
      return Number.isNaN(v) ? null : v;
    }
    return this.table[this.code(index)]!;
  }

  /** Code of a row, for ranks(); in text mode the row itself. */
  code(index: number): number {
    if (this.text) return index;
    return this.codes ? this.codes.get(index) : this.constant;
  }

  /** Rank of each code: 0 for empty, then the values in order of their text (code units, no locale). */
  ranks(): Uint32Array {
    if (this.numbers) throw new Error('Coluna numérica sem códigos.');
    if (this.text) return this.textRanks();
    const order = this.table.map((v, code) => ({ text: v === null ? '' : String(v), code })).slice(1);
    order.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : a.code - b.code));
    const rank = new Uint32Array(this.table.length);
    order.forEach((o, i) => (rank[o.code] = i + 1));
    return rank;
  }

  bytes(): number {
    return this.text ? this.text.bytes() : this.numbers ? this.numbers.bytes() : (this.codes?.bytes() ?? 0);
  }

  private codeOf(value: PackedValue | null): number {
    if (value === null) return 0;
    if (value === this.lastValue) return this.lastCode;
    let code = this.index.get(value);
    if (code === undefined) {
      code = this.table.length;
      this.table.push(value);
      this.index.set(value, code);
      if (typeof value !== 'number') {
        this.onlyNumbers = false;
        this.tableChars += value.length;
      }
    }
    this.lastValue = value;
    this.lastCode = code;
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
      if (this.codeBytes === 2 && this.textIsSmaller()) {
        const value = this.table[code]!;
        this.toText();
        this.text!.push(value);
        this.length++;
        return;
      }
      this.codeBytes = this.codeBytes === 1 ? 2 : 4;
      this.codes = this.codeBytes === 2 ? this.codes.convert((n) => new Uint16Array(n)) : this.codes.convert((n) => new Uint32Array(n));
    }
    this.codes.push(code);
    this.length++;
    if (this.onlyNumbers && this.distinct > NUMERIC_AFTER) this.toNumbers();
  }

  /**
   * Mostly distinct texts: the bytes of every row (characters + 4 per row) against 4 per row + the table (characters
   * + the entry of each distinct value). Decided once, when 2-byte codes are no longer enough.
   */
  private textIsSmaller(): boolean {
    if (this.onlyNumbers) return false;
    const chars = this.tableChars / this.distinct;
    return chars * this.length < (chars + TABLE_ENTRY_BYTES) * this.distinct;
  }

  private toText(): void {
    const text = new TextBytes();
    for (let i = 0; i < this.length; i++) text.push(this.table[this.code(i)]!);
    this.text = text;
    this.codes = null;
    this.table = [null];
    this.index = new Map();
    this.lastValue = null;
  }

  /** Ranks of the rows of a text column: equal texts tie, empty first. */
  private textRanks(): Uint32Array {
    const texts = Array.from({ length: this.length }, (_, i) => {
      const v = this.text!.get(i);
      return v === null ? '' : String(v);
    });
    const rows = Array.from({ length: this.length }, (_, i) => i).sort((a, b) => (texts[a]! < texts[b]! ? -1 : texts[a]! > texts[b]! ? 1 : a - b));
    const rank = new Uint32Array(this.length);
    let current = 0;
    let previous = '';
    for (const i of rows) {
      const t = texts[i]!;
      if (t !== '' && t !== previous) current++;
      rank[i] = t === '' ? 0 : current;
      previous = t;
    }
    return rank;
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
    this.lastValue = null;
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
