/**
 * Streaming SpreadsheetML worksheet parser working directly on UTF-8 bytes (docs/ARQUITETURA.md, 1.2).
 * The report sheet is ~225 MB of XML where almost every cell is a shared-string index, so bytes are
 * scanned without decoding the whole text. Only complete <row>…</row> elements are parsed; the
 * incomplete tail of a chunk is carried over to the next one.
 *
 * Handled: <dimension ref>, <row r>, <c r t>, <v>, <is><t> (ignoring <rPh>), self-closing rows and
 * cells, rows and cells without the r attribute.
 */
import { decodeCellText } from './xmlText';

export const CellKind = {
  Empty: 0,
  /** t="s": `sharedIndex` holds the index (-1 if not a valid integer). */
  Shared: 1,
  /** No t or t="n": `text` holds the raw number text. */
  Number: 2,
  /** t="inlineStr" or t="str": `text` holds the decoded string. */
  Text: 3,
  /** t="b", t="e", t="d": `text` holds the raw value. */
  Other: 4,
} as const;
export type CellKind = (typeof CellKind)[keyof typeof CellKind];

export class ParsedRow {
  readonly kind: Uint8Array;
  readonly sharedIndex: Int32Array;
  readonly text: string[];
  /** Cells beyond `width` columns (ignored). */
  extraCells = 0;

  constructor(readonly width: number) {
    this.kind = new Uint8Array(width);
    this.sharedIndex = new Int32Array(width);
    this.text = new Array<string>(width).fill('');
  }

  reset(): void {
    this.kind.fill(0);
    this.extraCells = 0;
  }
}

export interface SheetDimension {
  lastRow: number;
  lastColumn: number;
}

const LT = 60;
const GT = 62;
const SLASH = 47;
const EQ = 61;

const bytes = (s: string) => new TextEncoder().encode(s);
const P_ROW = bytes('<row');
const P_ROW_END = bytes('</row>');
const P_SHEETDATA = bytes('<sheetData');
const P_SHEETDATA_END = bytes('</sheetData>');
const P_DIMENSION = bytes('<dimension');
const P_C_END = bytes('</c>');
const P_V_OPEN = bytes('<v');
const P_V_END = bytes('</v>');
const P_T_END = bytes('</t>');
const P_RPH = bytes('<rPh');
const P_RPH_END = bytes('</rPh>');

function matchAt(buf: Uint8Array, at: number, pattern: Uint8Array): boolean {
  if (at + pattern.length > buf.length) return false;
  for (let i = 0; i < pattern.length; i++) if (buf[at + i] !== pattern[i]) return false;
  return true;
}

function find(buf: Uint8Array, pattern: Uint8Array, from: number, to = buf.length): number {
  const first = pattern[0]!;
  const last = to - pattern.length;
  let i = buf.indexOf(first, from);
  while (i >= 0 && i <= last) {
    if (matchAt(buf, i, pattern)) return i;
    i = buf.indexOf(first, i + 1);
  }
  return -1;
}

/** True if the byte ends a tag name: whitespace, '>' or '/'. */
function endsName(b: number | undefined): boolean {
  return b !== undefined && (b <= 32 || b === GT || b === SLASH);
}

const utf8 = new TextDecoder('utf-8');

function ascii(buf: Uint8Array, from: number, to: number): string {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(buf[i]!);
  return s;
}

export class SheetParser {
  dimension: SheetDimension | null = null;
  /** Row number of the last row seen (explicit or implied). */
  lastRowNumber = 0;

  private readonly row: ParsedRow;
  private carry: Uint8Array | null = null;
  private dimensionSeen = false;
  private inSheetData = false;
  private done = false;

  // Attribute ranges filled by scanAttributes().
  private rFrom = -1;
  private rTo = -1;
  private tFrom = -1;
  private tTo = -1;

  constructor(
    private readonly onRow: (rowNumber: number, row: ParsedRow) => void,
    width: number,
  ) {
    this.row = new ParsedRow(width);
  }

  push(chunk: Uint8Array): void {
    if (this.done) return;
    let buf: Uint8Array;
    if (this.carry) {
      buf = new Uint8Array(this.carry.length + chunk.length);
      buf.set(this.carry, 0);
      buf.set(chunk, this.carry.length);
    } else {
      buf = chunk;
    }
    const consumed = this.process(buf);
    this.carry = consumed < buf.length ? buf.slice(consumed) : null;
  }

  finish(): void {
    if (this.done) return;
    if (this.inSheetData) throw new Error('A aba terminou antes do fim dos dados (</sheetData> não encontrado).');
    throw new Error('Dados da aba não encontrados (<sheetData> ausente).');
  }

  /** Parses what it can and returns how many bytes were consumed. */
  private process(buf: Uint8Array): number {
    let pos = 0;
    if (!this.inSheetData) {
      const sd = find(buf, P_SHEETDATA, 0);
      if (!this.dimensionSeen) {
        const d = find(buf, P_DIMENSION, 0, sd < 0 ? buf.length : sd);
        if (d >= 0) {
          const gt = buf.indexOf(GT, d);
          if (gt < 0) return d;
          this.readDimension(buf, d + P_DIMENSION.length, gt);
          this.dimensionSeen = true;
        }
      }
      if (sd < 0) return Math.max(0, buf.length - 16);
      const gt = buf.indexOf(GT, sd);
      if (gt < 0) return sd;
      this.dimensionSeen = true;
      if (buf[gt - 1] === SLASH) {
        this.done = true;
        return buf.length;
      }
      this.inSheetData = true;
      pos = gt + 1;
    }

    for (;;) {
      const lt = buf.indexOf(LT, pos);
      if (lt < 0) return buf.length;
      if (lt + P_SHEETDATA_END.length > buf.length) return lt;

      if (matchAt(buf, lt, P_ROW) && endsName(buf[lt + 4])) {
        const tagEnd = buf.indexOf(GT, lt);
        if (tagEnd < 0) return lt;
        const selfClosing = buf[tagEnd - 1] === SLASH;
        let close = -1;
        if (!selfClosing) {
          close = find(buf, P_ROW_END, tagEnd + 1);
          if (close < 0) return lt;
        }
        this.scanAttributes(buf, lt + 4, selfClosing ? tagEnd - 1 : tagEnd);
        const rowNumber = this.rFrom >= 0 ? Number(ascii(buf, this.rFrom, this.rTo)) : this.lastRowNumber + 1;
        this.row.reset();
        if (!selfClosing) this.readCells(buf, tagEnd + 1, close);
        this.lastRowNumber = rowNumber;
        this.onRow(rowNumber, this.row);
        pos = selfClosing ? tagEnd + 1 : close + P_ROW_END.length;
        continue;
      }

      if (matchAt(buf, lt, P_SHEETDATA_END)) {
        this.done = true;
        this.inSheetData = false;
        return buf.length;
      }

      const gt = buf.indexOf(GT, lt);
      if (gt < 0) return lt;
      pos = gt + 1;
    }
  }

  private readDimension(buf: Uint8Array, from: number, to: number): void {
    this.scanAttributes(buf, from, to, true);
    if (this.rFrom < 0) return;
    const ref = ascii(buf, this.rFrom, this.rTo);
    const last = ref.slice(ref.indexOf(':') + 1);
    const m = /^([A-Z]+)(\d+)$/.exec(last);
    if (!m) return;
    let col = 0;
    for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
    this.dimension = { lastRow: Number(m[2]), lastColumn: col };
  }

  /**
   * Finds attribute values in a tag. Sets rFrom/rTo for "r" (or "ref" when `wantRef`) and tFrom/tTo for "t".
   */
  private scanAttributes(buf: Uint8Array, from: number, to: number, wantRef = false): void {
    this.rFrom = this.rTo = this.tFrom = this.tTo = -1;
    let i = from;
    while (i < to) {
      while (i < to && buf[i]! <= 32) i++;
      const nameFrom = i;
      while (i < to && buf[i] !== EQ && buf[i]! > 32 && buf[i] !== SLASH) i++;
      const nameTo = i;
      while (i < to && buf[i]! <= 32) i++;
      if (i >= to || buf[i] !== EQ) {
        i++;
        continue;
      }
      i++;
      while (i < to && buf[i]! <= 32) i++;
      const quote = buf[i];
      const valueFrom = i + 1;
      const valueTo = buf.indexOf(quote!, valueFrom);
      if (valueTo < 0 || valueTo > to) return;
      const len = nameTo - nameFrom;
      const c0 = buf[nameFrom];
      if (wantRef) {
        if (len === 3 && c0 === 114 && buf[nameFrom + 1] === 101 && buf[nameFrom + 2] === 102) {
          this.rFrom = valueFrom;
          this.rTo = valueTo;
        }
      } else if (len === 1 && c0 === 114 /* r */) {
        this.rFrom = valueFrom;
        this.rTo = valueTo;
      } else if (len === 1 && c0 === 116 /* t */) {
        this.tFrom = valueFrom;
        this.tTo = valueTo;
      }
      i = valueTo + 1;
    }
  }

  private readCells(buf: Uint8Array, from: number, to: number): void {
    const row = this.row;
    let column = -1;
    let pos = from;
    while (pos < to) {
      const lt = buf.indexOf(LT, pos);
      if (lt < 0 || lt >= to) return;
      const tagEnd = buf.indexOf(GT, lt);
      if (buf[lt + 1] !== 99 /* c */ || !endsName(buf[lt + 2])) {
        pos = tagEnd + 1;
        continue;
      }
      const selfClosing = buf[tagEnd - 1] === SLASH;
      this.scanAttributes(buf, lt + 2, selfClosing ? tagEnd - 1 : tagEnd);

      if (this.rFrom >= 0) {
        let col = 0;
        for (let i = this.rFrom; i < this.rTo; i++) {
          const b = buf[i]!;
          if (b < 65 || b > 90) break;
          col = col * 26 + (b - 64);
        }
        column = col - 1;
      } else {
        column++;
      }

      const close = selfClosing ? -1 : find(buf, P_C_END, tagEnd + 1, to);
      pos = selfClosing ? tagEnd + 1 : close + P_C_END.length;
      if (column < 0 || column >= row.width) {
        row.extraCells++;
        continue;
      }
      if (selfClosing) continue;

      const tLen = this.tTo - this.tFrom;
      const t0 = this.tFrom >= 0 ? buf[this.tFrom] : -1;
      if (tLen === 9 && t0 === 105 /* inlineStr */) {
        row.kind[column] = CellKind.Text;
        row.text[column] = this.readInlineString(buf, tagEnd + 1, close);
        continue;
      }

      // Value in <v>…</v>.
      const vOpen = find(buf, P_V_OPEN, tagEnd + 1, close);
      if (vOpen < 0) continue;
      const vFrom = buf.indexOf(GT, vOpen) + 1;
      if (buf[vFrom - 2] === SLASH) continue; // <v/>
      const vTo = find(buf, P_V_END, vFrom, close);
      if (vTo < 0) continue;

      if (tLen === 1 && t0 === 115 /* s */) {
        let n = 0;
        let ok = vTo > vFrom;
        for (let i = vFrom; i < vTo; i++) {
          const d = buf[i]! - 48;
          if (d < 0 || d > 9) {
            ok = false;
            break;
          }
          n = n * 10 + d;
        }
        row.kind[column] = CellKind.Shared;
        row.sharedIndex[column] = ok ? n : -1;
      } else if (this.tFrom < 0 || (tLen === 1 && t0 === 110 /* n */)) {
        row.kind[column] = CellKind.Number;
        row.text[column] = ascii(buf, vFrom, vTo);
      } else if (tLen === 3 && t0 === 115 /* str */) {
        row.kind[column] = CellKind.Text;
        row.text[column] = decodeCellText(utf8.decode(buf.subarray(vFrom, vTo)));
      } else {
        row.kind[column] = CellKind.Other;
        row.text[column] = decodeCellText(utf8.decode(buf.subarray(vFrom, vTo)));
      }
    }
  }

  /** Concatenates the <t> texts of an <is> element, skipping phonetic runs. */
  private readInlineString(buf: Uint8Array, from: number, to: number): string {
    let out = '';
    let pos = from;
    for (;;) {
      const lt = buf.indexOf(LT, pos);
      if (lt < 0 || lt >= to) break;
      if (matchAt(buf, lt, P_RPH)) {
        const end = find(buf, P_RPH_END, lt, to);
        if (end < 0) break;
        pos = end + P_RPH_END.length;
        continue;
      }
      const gt = buf.indexOf(GT, lt);
      if (buf[lt + 1] === 116 /* t */ && endsName(buf[lt + 2]) && buf[gt - 1] !== SLASH) {
        const end = find(buf, P_T_END, gt + 1, to);
        if (end < 0) break;
        out += utf8.decode(buf.subarray(gt + 1, end));
        pos = end + P_T_END.length;
        continue;
      }
      pos = gt + 1;
    }
    return decodeCellText(out);
  }
}

