/**
 * Reading of the CSV of the chart of accounts exported by the Protheus (docs/REGRAS_PLANO_DE_CONTAS.md, section 3):
 * UTF-8 when the strict decoding succeeds, otherwise windows-1252; separator `;`; CRLF or LF; fields between quotes
 * accepted (with the separator, a doubled quote or a line break inside); every value trimmed. The first column gives the
 * type of the record (0 control, 1 CT1, 2 CVD); each header is found by its content (CT1_FILIAL or CVD_FILIAL in the
 * second column) and the fields are mapped by name, never by position. Only the fields the module uses are kept.
 * Pure functions: the worker feeds the tokenizer chunk by chunk; the tests read whole byte arrays.
 */

/** CT1 fields used by the module (section 3.3), in the order of the specification. */
export const CT1_FIELDS = [
  'CT1_CONTA',
  'CT1_DESC01',
  'CT1_DESC02',
  'CT1_CLASSE',
  'CT1_NORMAL',
  'CT1_CTASUP',
  'CT1_RES',
  'CT1_NTSPED',
  'CT1_BLOQ',
  'CT1_DTBLIN',
  'CT1_DTBLFI',
  'CT1_DC',
  'CT1_ACCUST',
  'CT1_CCOBRG',
  'CT1_ACITEM',
  'CT1_ITOBRG',
  'CT1_ACCLVL',
  'CT1_DTEXIS',
] as const;
export type Ct1Field = (typeof CT1_FIELDS)[number];

export const CVD_FIELDS = ['CVD_CONTA', 'CVD_CTAREF', 'CVD_CTASUP', 'CVD_CODPLA'] as const;
export type CvdField = (typeof CVD_FIELDS)[number];

/** Text of the second column that marks each header. */
const CT1_MARK = 'CT1_FILIAL';
const CVD_MARK = 'CVD_FILIAL';

export interface Ct1Record {
  line: number;
  fields: Record<Ct1Field, string>;
}

export interface CvdRecord {
  line: number;
  fields: Record<CvdField, string>;
}

export interface TableHeader<F extends string> {
  line: number;
  /** Columns of the header, the type column included. */
  columns: number;
  /** Used fields absent from the header. */
  missing: F[];
}

export type IgnoredReason = 'unknownType' | 'beforeHeader' | 'repeatedHeader';

export interface ChartParsed {
  encoding: 'utf-8' | 'windows-1252';
  /** Physical lines of the file. */
  lines: number;
  blankLines: number;
  /** Tables named by the control line; null when the file has none. */
  controlTables: string[] | null;
  ct1Header: TableHeader<Ct1Field> | null;
  cvdHeader: TableHeader<CvdField> | null;
  ct1: Ct1Record[];
  cvd: CvdRecord[];
  ignored: { line: number; reason: IgnoredReason }[];
  /** Data records with another number of fields than their header (trailing empty fields not counted). */
  widthMismatch: { table: 'CT1' | 'CVD'; line: number; fields: number; expected: number }[];
}

// ── Tokenizer ──

const SEPARATOR = ';';
const QUOTE = '"';

/**
 * Records of a delimited text arriving in chunks. `onRecord` receives the raw fields (not trimmed) and the physical
 * line where the record starts (1-based). A blank line gives one empty field. A CR right before LF is dropped.
 */
export class CsvTokenizer {
  private fields: string[] = [];
  private field = '';
  private quoted = false;
  /** Inside a quoted field. */
  private inQuotes = false;
  /** A quote read inside a quoted field: either the end of it or the first of a doubled quote. */
  private quotePending = false;
  /** A CR read outside quotes: dropped if LF follows. */
  private crPending = false;
  private line = 1;
  private recordLine = 1;
  /** Characters read since the last record ended (a final line without line end). */
  private open = false;

  constructor(private readonly onRecord: (fields: string[], line: number) => void) {}

  /** Physical lines seen so far (the last one counted once it has a character or a line end). */
  get lines(): number {
    return this.open ? this.line : this.line - 1;
  }

  push(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      this.open = true;
      if (this.crPending) {
        this.crPending = false;
        if (ch === '\n') {
          this.endRecord();
          continue;
        }
        this.field += '\r';
      }
      if (this.quotePending) {
        this.quotePending = false;
        if (ch === QUOTE) {
          this.field += QUOTE;
          continue;
        }
        this.inQuotes = false;
      }
      if (this.inQuotes) {
        if (ch === QUOTE) this.quotePending = true;
        else {
          if (ch === '\n') this.line++;
          this.field += ch;
        }
        continue;
      }
      if (ch === SEPARATOR) {
        this.fields.push(this.field);
        this.field = '';
        this.quoted = false;
      } else if (ch === '\n') {
        this.endRecord();
      } else if (ch === '\r') {
        this.crPending = true;
      } else if (ch === QUOTE && this.field === '' && !this.quoted) {
        this.inQuotes = true;
        this.quoted = true;
      } else {
        this.field += ch;
      }
    }
  }

  end(): void {
    if (this.crPending) {
      this.crPending = false;
      this.endRecord();
      return;
    }
    this.quotePending = false;
    this.inQuotes = false;
    if (this.open) {
      this.fields.push(this.field);
      this.emit();
      this.line++;
      this.open = false;
    }
  }

  private endRecord(): void {
    this.fields.push(this.field);
    this.emit();
    this.line++;
    this.recordLine = this.line;
    this.open = false;
  }

  private emit(): void {
    const fields = this.fields;
    this.fields = [];
    this.field = '';
    this.quoted = false;
    this.onRecord(fields, this.recordLine);
  }
}

// ── Tables ──

interface HeaderMap<F extends string> {
  header: TableHeader<F>;
  index: Map<F, number>;
}

function headerOf<F extends string>(fields: string[], line: number, used: readonly F[]): HeaderMap<F> {
  const position = new Map<string, number>();
  fields.forEach((name, i) => {
    if (!position.has(name)) position.set(name, i);
  });
  const index = new Map<F, number>();
  const missing: F[] = [];
  for (const f of used) {
    const at = position.get(f);
    if (at === undefined) missing.push(f);
    else index.set(f, at);
  }
  return { header: { line, columns: fields.length, missing }, index };
}

function valuesOf<F extends string>(fields: string[], map: HeaderMap<F>, used: readonly F[]): Record<F, string> {
  const out = {} as Record<F, string>;
  for (const f of used) {
    const at = map.index.get(f);
    out[f] = at === undefined ? '' : (fields[at] ?? '');
  }
  return out;
}

/** Fields of a record up to the last one not empty. */
function width(fields: string[]): number {
  let n = fields.length;
  while (n > 0 && fields[n - 1] === '') n--;
  return n;
}

/** Builds the tables from the records of the tokenizer. */
export class ChartTableReader {
  private ct1Map: HeaderMap<Ct1Field> | null = null;
  private cvdMap: HeaderMap<CvdField> | null = null;
  private readonly out: Omit<ChartParsed, 'encoding' | 'lines'> = {
    blankLines: 0,
    controlTables: null,
    ct1Header: null,
    cvdHeader: null,
    ct1: [],
    cvd: [],
    ignored: [],
    widthMismatch: [],
  };

  record(raw: string[], line: number): void {
    const fields = raw.map((f) => f.trim());
    if (fields.length === 1 && fields[0] === '') {
      this.out.blankLines++;
      return;
    }
    const type = fields[0];
    if (type === '0') {
      this.out.controlTables ??= fields.slice(1).filter((t) => t !== '');
      return;
    }
    if (type === '1') return this.table(fields, line, CT1_MARK, 'CT1');
    if (type === '2') return this.table(fields, line, CVD_MARK, 'CVD');
    this.out.ignored.push({ line, reason: 'unknownType' });
  }

  private table(fields: string[], line: number, mark: string, table: 'CT1' | 'CVD'): void {
    const isCt1 = table === 'CT1';
    const map = isCt1 ? this.ct1Map : this.cvdMap;
    if (fields[1] === mark) {
      if (map) {
        this.out.ignored.push({ line, reason: 'repeatedHeader' });
        return;
      }
      if (isCt1) {
        this.ct1Map = headerOf(fields, line, CT1_FIELDS);
        this.out.ct1Header = this.ct1Map.header;
      } else {
        this.cvdMap = headerOf(fields, line, CVD_FIELDS);
        this.out.cvdHeader = this.cvdMap.header;
      }
      return;
    }
    if (!map) {
      this.out.ignored.push({ line, reason: 'beforeHeader' });
      return;
    }
    // Exactly the columns of the header, or more only when the extra ones are empty (a trailing separator).
    const expected = map.header.columns;
    if (fields.length < expected || (fields.length > expected && width(fields) > expected)) {
      this.out.widthMismatch.push({ table, line, fields: fields.length, expected });
    }
    if (isCt1) this.out.ct1.push({ line, fields: valuesOf(fields, this.ct1Map!, CT1_FIELDS) });
    else this.out.cvd.push({ line, fields: valuesOf(fields, this.cvdMap!, CVD_FIELDS) });
  }

  finish(encoding: ChartParsed['encoding'], lines: number): ChartParsed {
    return { encoding, lines, ...this.out };
  }
}

// ── Decoding ──

/** Whether the bytes are valid UTF-8, fed in chunks (the decision of step 1 of section 3.1). */
export class Utf8Check {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private valid = true;

  push(chunk: Uint8Array): void {
    if (!this.valid) return;
    try {
      this.decoder.decode(chunk, { stream: true });
    } catch {
      this.valid = false;
    }
  }

  /** The encoding of the file once every chunk was pushed. */
  finish(): 'utf-8' | 'windows-1252' {
    if (this.valid) {
      try {
        this.decoder.decode();
      } catch {
        this.valid = false;
      }
    }
    return this.valid ? 'utf-8' : 'windows-1252';
  }
}

/** Whole bytes → text, UTF-8 when strict decoding succeeds, otherwise windows-1252 (the BOM of UTF-8 is removed). */
export function decodeChartBytes(bytes: Uint8Array): { encoding: 'utf-8' | 'windows-1252'; text: string } {
  const check = new Utf8Check();
  check.push(bytes);
  const encoding = check.finish();
  return { encoding, text: new TextDecoder(encoding).decode(bytes) };
}

/** Whole bytes → tables (tests and small files). */
export function parseChartBytes(bytes: Uint8Array): ChartParsed {
  const { encoding, text } = decodeChartBytes(bytes);
  const reader = new ChartTableReader();
  const tokenizer = new CsvTokenizer((fields, line) => reader.record(fields, line));
  tokenizer.push(text);
  tokenizer.end();
  return reader.finish(encoding, tokenizer.lines);
}

/**
 * A blob → tables, chunk by chunk, with the encoding already decided by a first pass (Utf8Check). `onBytes` reports the
 * bytes read (progress).
 */
export async function parseChartBlob(blob: Blob, encoding: ChartParsed['encoding'], onBytes: (read: number) => void): Promise<ChartParsed> {
  const decoder = new TextDecoder(encoding);
  const reader = new ChartTableReader();
  const tokenizer = new CsvTokenizer((fields, line) => reader.record(fields, line));
  const stream = (blob.stream() as ReadableStream<Uint8Array>).getReader();
  let read = 0;
  for (;;) {
    const r = await stream.read();
    if (r.done) break;
    tokenizer.push(decoder.decode(r.value, { stream: true }));
    read += r.value.length;
    onBytes(read);
  }
  tokenizer.push(decoder.decode());
  tokenizer.end();
  return reader.finish(encoding, tokenizer.lines);
}
