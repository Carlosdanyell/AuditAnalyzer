import { describe, expect, it } from 'vitest';
import { PrinterEscapeFilter, SpoolLineSplitter, decodeSpool, normalizeSpoolControls, spoolLines } from '../../src/worker/ingest/spoolText';
import { readSpoolLines } from '../../src/worker/modules/reconciliation/formats/text';

/** Normalization of the plain-text spool (docs/REGRAS_CONCILIADOR.md, section 4.1). */
const bytes = (...parts: (string | number[])[]) => {
  const chunks = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : new Uint8Array(p)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};
const ESC = 0x1b;

describe('printer control sequences (4.1, step 2)', () => {
  it('removes ESC and the two bytes after it, also across chunks', () => {
    const filter = new PrinterEscapeFilter();
    const text = (u: Uint8Array) => new TextDecoder().decode(u);
    expect(text(filter.push(bytes('AB', [ESC, 0x21, 0x02], 'C')))).toBe('ABC');
    expect(text(filter.push(bytes('D', [ESC])))).toBe('D');
    expect(text(filter.push(bytes([0x45])))).toBe('');
    expect(text(filter.push(bytes([0x46], 'GH')))).toBe('GH');
    // An ESC at the end of the file takes what is left.
    expect(text(filter.push(bytes('I', [ESC, 0x30])))).toBe('I');
  });
});

describe('control characters and lines (4.1, step 3)', () => {
  it('keeps LF, turns FF into a line end and removes the other characters 0x00-0x1F (0x02/0x03 left by step 2, CR, TAB)', () => {
    expect(normalizeSpoolControls('AB\u0002C\u0003\r\n  D\fE\tF\n')).toBe('ABC\n  D\nEF\n');
    // Other characters are kept, and nothing is trimmed: the positions are absolute after steps 2 and 3.
    expect(normalizeSpoolControls('  ç\u007f �  ')).toBe('  ç\u007f �  ');
  });

  it('splits the lines across chunks, CRLF and LF alike, the last one without a line end included', () => {
    const lines: string[] = [];
    const splitter = new SpoolLineSplitter();
    splitter.push('A10 X\n  B2', (l) => lines.push(l));
    splitter.push('0\n\nC', (l) => lines.push(l));
    splitter.end((l) => lines.push(l));
    expect(lines).toEqual(['A10 X', '  B20', '', 'C']);
    expect(spoolLines(bytes('L1\r\nL2\nL3\r\n')).lines).toEqual(['L1', 'L2', 'L3']);
  });

  it('applies the whole normalization in order: ESC sequences, then controls, then lines', () => {
    const read = spoolLines(bytes('AB', [ESC, 0x21, 0x02], 'C', [0x02], 'D', [0x03], '\r\n  E\fF\n'));
    expect(read).toEqual({ encoding: 'utf-8', lines: ['ABCD', '  E', 'F'] });
  });
});

describe('encoding (4.1, step 1)', () => {
  it('reads UTF-8 when the strict decoding succeeds (U+FFFD of the real files is kept as it is)', () => {
    expect(decodeSpool(bytes('Fun��o'), true)).toEqual({ encoding: 'utf-8', text: 'Fun��o' });
  });

  it('falls back to windows-1252 when it fails', () => {
    expect(decodeSpool(bytes('Fun', [0xe7, 0xe3], 'o'), true)).toEqual({ encoding: 'windows-1252', text: 'Função' });
  });

  it('a beginning cut in the middle of a character is still UTF-8 (the probe reads only the first bytes)', () => {
    const cut = bytes('Olá').slice(0, 3);
    expect(decodeSpool(cut, false)).toEqual({ encoding: 'utf-8', text: 'Ol' });
    expect(decodeSpool(cut, true).encoding).toBe('windows-1252');
    // The last line of a cut beginning may be partial: it is left out.
    expect(spoolLines(bytes('L1\nL2\nL3'), false).lines).toEqual(['L1', 'L2']);
  });
});

describe('reading a spool in a stream', () => {
  it('gives every normalized line with its number, the encoding and the bytes read', async () => {
    const lines: [number, string][] = [];
    const blob = new Blob([bytes('L1\r\n', [ESC, 0x40, 0x41], '  L2\f', 'L3 ç\n')]);
    const read = await readSpoolLines(blob, (line, n) => lines.push([n, line]));
    expect(read).toEqual({ encoding: 'utf-8', bytes: blob.size, lines: 3 });
    expect(lines).toEqual([
      [1, 'L1'],
      [2, '  L2'],
      [3, 'L3 ç'],
    ]);
  });

  it('decodes the whole file as windows-1252 when any byte is not UTF-8, even near the end', async () => {
    const lines: string[] = [];
    const blob = new Blob([bytes('Ac\n', 'x'.repeat(200_000), '\n', [0xe7], '\n')]);
    const read = await readSpoolLines(blob, (line) => lines.push(line));
    expect(read.encoding).toBe('windows-1252');
    expect(lines[2]).toBe('ç');
  });
});
