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
