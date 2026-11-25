/**
 * Normalization of a plain-text spool of the Protheus (docs/REGRAS_CONCILIADOR.md, section 4.1), shared by the probe
 * of the start screen and the readers of reports:
 * 1. UTF-8 when the strict decoding succeeds, otherwise windows-1252 (the encoding used is reported);
 * 2. printer control sequences removed: ESC (0x1B) and the two bytes after it;
 * 3. FF (0x0C) is a line end; the other characters 0x00-0x1F are removed, except LF (so CRLF and LF both end a line);
 * 4. nothing is trimmed: positions are absolute after steps 2 and 3.
 * Step 2 runs on the bytes, before the decoding: the two bytes are "any bytes", so they never take a character of the
 * text with them nor make the strict UTF-8 decoding fail. Everything works chunk by chunk (no file whole in memory).
 */

export type SpoolEncoding = 'utf-8' | 'windows-1252';

const ESC = 0x1b;
const FF = 0x0c;

/** Step 2: removes ESC and the two bytes after it, also when the sequence is split between chunks. */
export class PrinterEscapeFilter {
  /** Bytes of a sequence still to skip at the start of the next chunk. */
  private skip = 0;

  push(chunk: Uint8Array): Uint8Array {
    let out: Uint8Array | null = null;
    let n = 0;
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]!;
      if (this.skip > 0) {
        this.skip--;
      } else if (b === ESC) {
        this.skip = 2;
      } else {
        if (out) out[n] = b;
        n++;
        continue;
      }
      // First byte removed: from here on the kept bytes are copied.
      if (!out) {
        out = new Uint8Array(chunk.length);
        out.set(chunk.subarray(0, n));
      }
    }
    return out ? out.subarray(0, n) : chunk;
  }
}

/** Step 3 over decoded text: FF becomes LF; every other character 0x00-0x1F but LF is removed. */
export function normalizeSpoolControls(text: string): string {
  // eslint-disable-next-line no-control-regex -- the control characters are what this removes
  return text.replace(/[\x00-\x09\x0b-\x1f]/g, (c) => (c.charCodeAt(0) === FF ? '\n' : ''));
}

/** Lines of normalized text arriving in chunks; the last line, without a line end, comes with `end`. */
export class SpoolLineSplitter {
  private rest = '';

  push(text: string, onLine: (line: string) => void): void {
    let i = text.indexOf('\n');
    if (i < 0) {
      this.rest += text;
      return;
    }
    onLine(this.rest + text.slice(0, i));
    let start = i + 1;
    while ((i = text.indexOf('\n', start)) >= 0) {
      onLine(text.slice(start, i));
      start = i + 1;
    }
    this.rest = text.slice(start);
  }

  end(onLine: (line: string) => void): void {
    if (this.rest !== '') onLine(this.rest);
    this.rest = '';
  }
}

/**
 * Step 1 over bytes already free of printer sequences. `complete` false = only the beginning of the file: a character
 * cut at the end is not a decoding failure.
 */
export function decodeSpool(bytes: Uint8Array, complete: boolean): { encoding: SpoolEncoding; text: string } {
  try {
    return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: !complete }) };
  } catch {
    return { encoding: 'windows-1252', text: new TextDecoder('windows-1252').decode(bytes) };
  }
}

/**
 * The normalized lines of a spool in memory (the beginning read by the probe, or a small file). With `complete` false
 * the last line, possibly cut, is left out.
 */
export function spoolLines(bytes: Uint8Array, complete = true): { encoding: SpoolEncoding; lines: string[] } {
  const { encoding, text } = decodeSpool(new PrinterEscapeFilter().push(bytes), complete);
  const lines: string[] = [];
  const splitter = new SpoolLineSplitter();
  splitter.push(normalizeSpoolControls(text), (l) => lines.push(l));
  if (complete) splitter.end((l) => lines.push(l));
  return { encoding, lines };
}

/** Whether the bytes of a stream decode as strict UTF-8 after step 2 (first pass of a full reading; nothing is kept). */
export async function isStrictUtf8(stream: ReadableStream<Uint8Array>): Promise<boolean> {
  const filter = new PrinterEscapeFilter();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      decoder.decode(filter.push(value), { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
