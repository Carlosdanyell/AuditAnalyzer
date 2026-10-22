/**
 * Streaming parser for xl/sharedStrings.xml (docs/REGRAS_CFGR700.md, section 1).
 * Each <si> is plain text (<t>) or rich text (<r><t>…); all <t> are concatenated and <rPh> (phonetic
 * runs) are ignored. Only one <si> at a time is held as a string besides the result.
 */
import { decodeCellText } from './xmlText';

const PHONETIC = /<rPh\b[\s\S]*?<\/rPh>/g;
const TEXT = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;

function parseItem(inner: string): string {
  const withoutPhonetic = inner.indexOf('<rPh') >= 0 ? inner.replace(PHONETIC, '') : inner;
  let out = '';
  for (const m of withoutPhonetic.matchAll(TEXT)) out += m[1];
  return decodeCellText(out);
}

export class SharedStringsParser {
  private buffer = '';
  private closed = false;
  private readonly strings: string[] = [];
  declaredUniqueCount: number | null = null;

  push(text: string): void {
    let buf = this.buffer + text;
    if (this.declaredUniqueCount === null) {
      const sst = buf.indexOf('<sst');
      const gt = sst >= 0 ? buf.indexOf('>', sst) : -1;
      if (gt > 0) {
        const m = /uniqueCount="(\d+)"/.exec(buf.slice(sst, gt));
        this.declaredUniqueCount = m ? Number(m[1]) : -1;
      } else {
        // Still in the XML prolog or inside the <sst …> tag: wait for more text.
        this.buffer = buf;
        return;
      }
    }
    let pos = 0;
    for (;;) {
      const start = buf.indexOf('<si', pos);
      if (start < 0) {
        if (buf.indexOf('</sst>', pos) >= 0) this.closed = true;
        // Keep a short tail: it may hold the beginning of "<si" or "</sst>".
        pos = Math.max(pos, buf.length - 6);
        break;
      }
      const after = buf.charCodeAt(start + 3);
      if (Number.isNaN(after)) {
        pos = start;
        break;
      }
      if (after === 47 /* / */) {
        if (start + 5 > buf.length) {
          pos = start;
          break;
        }
        this.strings.push('');
        pos = start + 5;
        continue;
      }
      const end = buf.indexOf('</si>', start);
      if (end < 0) {
        pos = start;
        break;
      }
      this.strings.push(parseItem(buf.slice(buf.indexOf('>', start) + 1, end)));
      pos = end + 5;
    }
    buf = buf.slice(pos);
    this.buffer = buf;
  }

  finish(): string[] {
    if (!this.closed && this.buffer.indexOf('</sst>') < 0) {
      throw new Error('sharedStrings.xml terminou antes do fim (</sst> não encontrado).');
    }
    return this.strings;
  }
}

const LT = 60;
const GT = 62;
const SLASH = 47;
const ascii = (s: string) => new TextEncoder().encode(s);
const B_SST = ascii('<sst');
const B_SI = ascii('<si');
const B_SI_END = ascii('</si>');
const B_SST_END = ascii('</sst>');
const B_T_END = ascii('</t>');
const utf8 = new TextDecoder('utf-8');

function matchAt(buf: Uint8Array, at: number, pattern: Uint8Array): boolean {
  if (at + pattern.length > buf.length) return false;
  for (let i = 0; i < pattern.length; i++) if (buf[at + i] !== pattern[i]) return false;
  return true;
}

function find(buf: Uint8Array, pattern: Uint8Array, from: number): number {
  let i = buf.indexOf(pattern[0]!, from);
  while (i >= 0) {
    if (matchAt(buf, i, pattern)) return i;
    i = buf.indexOf(pattern[0]!, i + 1);
  }
  return -1;
}

/**
 * The same parsing on the UTF-8 bytes, for large files (docs/ARQUITETURA.md, section 1.3): each <si> is decoded on its
 * own, so every string is independent. Decoding whole chunks and cutting them into strings, as the text parser does,
 * makes the engine keep each chunk alive for as long as any string taken from it (all of them, in the end).
 * The usual item, <si><t>text</t></si>, is decoded directly; any other is given to the text parser's parseItem.
 */
export class SharedStringsBytesParser {
  private carry: Uint8Array | null = null;
  private closed = false;
  private readonly strings: string[] = [];
  declaredUniqueCount: number | null = null;

  /** Strings parsed so far. */
  get count(): number {
    return this.strings.length;
  }

  /** The strings parsed so far (a partial read stops early). */
  partial(): string[] {
    return this.strings;
  }

  push(chunk: Uint8Array): void {
    let buf = chunk;
    if (this.carry) {
      buf = new Uint8Array(this.carry.length + chunk.length);
      buf.set(this.carry, 0);
      buf.set(chunk, this.carry.length);
    }
    let pos = 0;
    if (this.declaredUniqueCount === null) {
      const sst = find(buf, B_SST, 0);
      const gt = sst >= 0 ? buf.indexOf(GT, sst) : -1;
      if (gt < 0) {
        // Still in the XML prolog or inside the <sst …> tag: wait for more bytes.
        this.carry = buf.slice();
        return;
      }
      const m = /uniqueCount="(\d+)"/.exec(utf8.decode(buf.subarray(sst, gt)));
      this.declaredUniqueCount = m ? Number(m[1]) : -1;
    }
    for (;;) {
      const start = find(buf, B_SI, pos);
      if (start < 0) {
        if (find(buf, B_SST_END, pos) >= 0) this.closed = true;
        // Keep a short tail: it may hold the beginning of "<si" or "</sst>".
        pos = Math.max(pos, buf.length - 6);
        break;
      }
      const after = buf[start + 3];
      if (after === undefined) {
        pos = start;
        break;
      }
      if (after === SLASH) {
        if (start + 5 > buf.length) {
          pos = start;
          break;
        }
        this.strings.push('');
        pos = start + 5;
        continue;
      }
      const end = find(buf, B_SI_END, start);
      if (end < 0) {
        pos = start;
        break;
      }
      this.strings.push(this.item(buf, buf.indexOf(GT, start) + 1, end));
      pos = end + 5;
    }
    this.carry = pos < buf.length ? buf.slice(pos) : null;
  }

  /** Text of the bytes between <si …> and </si>. */
  private item(buf: Uint8Array, from: number, to: number): string {
    const b2 = buf[from + 2]!;
    if (buf[from] === LT && buf[from + 1] === 116 /* t */ && (b2 === GT || b2 <= 32)) {
      const textFrom = buf.indexOf(GT, from) + 1;
      if (buf[textFrom - 2] !== SLASH) {
        const lt = buf.indexOf(LT, textFrom);
        if (lt === to - B_T_END.length && matchAt(buf, lt, B_T_END)) return decodeCellText(utf8.decode(buf.subarray(textFrom, lt)));
      }
    }
    return parseItem(utf8.decode(buf.subarray(from, to)));
  }

  finish(): string[] {
    if (!this.closed && (this.carry === null || find(this.carry, B_SST_END, 0) < 0)) {
      throw new Error('sharedStrings.xml terminou antes do fim (</sst> não encontrado).');
    }
    return this.strings;
  }
}
