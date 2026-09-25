import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZipFormatError, readEntryBytes, readZipDirectory } from '../../src/worker/ingest/zip';
import type { InflateMode } from '../../src/worker/ingest/inflate';

const enc = (s: string) => new TextEncoder().encode(s);
const big = enc('linha de teste '.repeat(20_000));

function makeZip(): Uint8Array {
  return zipSync(
    {
      'a.txt': [enc('olá'), { level: 0 }],
      'dir/b.xml': [big, { level: 9 }],
    },
    { mtime: new Date(2026, 0, 1) },
  );
}

const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);

describe('zip reader', () => {
  it('lists entries from the central directory', async () => {
    const entries = await readZipDirectory(blob(makeZip()));
    expect(entries.map((e) => [e.name, e.method, e.uncompressedSize])).toEqual([
      ['a.txt', 0, 4],
      ['dir/b.xml', 8, big.length],
    ]);
  });

  it.each<InflateMode>(['native', 'fallback'])('reads stored and deflated entries with %s inflate', async (mode) => {
    const b = blob(makeZip());
    const [a, x] = await readZipDirectory(b);
    const ra = await readEntryBytes(b, a!, mode);
    const rx = await readEntryBytes(b, x!, mode);
    expect(new TextDecoder().decode(ra.bytes)).toBe('olá');
    expect(rx.bytes).toEqual(big);
    expect(ra.integrity.ok && rx.integrity.ok).toBe(true);
  });

  it('detects a CRC mismatch', async () => {
    const bytes = makeZip();
    // Corrupt the CRC of the first central-directory entry.
    const view = new DataView(bytes.buffer);
    let cd = bytes.length - 22;
    while (view.getUint32(cd, true) !== 0x02014b50) cd--;
    let first = cd;
    for (let p = cd; p >= 0; p--) if (view.getUint32(p, true) === 0x02014b50) first = p;
    view.setUint32(first + 16, view.getUint32(first + 16, true) ^ 1, true);
    const b = blob(bytes);
    const [a] = await readZipDirectory(b);
    const { integrity } = await readEntryBytes(b, a!);
    expect(integrity.ok).toBe(false);
    expect(integrity.actualCrc).not.toBe(integrity.expectedCrc);
  });

  it('rejects data that is not a ZIP', async () => {
    await expect(readZipDirectory(blob(enc('isto não é um xlsx')))).rejects.toThrow(ZipFormatError);
    await expect(readZipDirectory(blob(new Uint8Array(0)))).rejects.toThrow(ZipFormatError);
  });

  it('rejects ZIP64 with a clear message', async () => {
    const bytes = makeZip();
    const view = new DataView(bytes.buffer);
    const eocd = bytes.length - 22;
    view.setUint16(eocd + 10, 0xffff, true);
    await expect(readZipDirectory(blob(bytes))).rejects.toThrow(/ZIP64/);
  });
});
