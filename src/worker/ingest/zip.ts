/**
 * Random-access ZIP reader over a Blob (docs/ARQUITETURA.md, 1.1). Only the central directory and the
 * entries actually read are loaded; entry data is streamed and checked against the CRC32 and size
 * recorded in the central directory.
 */
import type { EntryIntegrity } from '../../shared/protocol';
import { crc32 } from './crc32';
import { inflateRaw, type InflateMode } from './inflate';

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipFormatError extends Error {
  override name = 'ZipFormatError';
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_EOCD_SEARCH = 22 + 0xffff;

const NOT_XLSX = 'O arquivo não é um arquivo .xlsx válido (estrutura ZIP não encontrada).';
const ZIP64 =
  'O arquivo usa o formato ZIP64, que ainda não é suportado. Divida a extração em períodos menores ou informe o caso.';

async function readBytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

export async function readZipDirectory(blob: Blob): Promise<ZipEntry[]> {
  if (blob.size < 22) throw new ZipFormatError(NOT_XLSX);
  const tailStart = Math.max(0, blob.size - MAX_EOCD_SEARCH);
  const tail = await readBytes(blob, tailStart, blob.size);

  let eocd = -1;
  for (let p = tail.byteLength - 22; p >= 0; p--) {
    if (tail.getUint32(p, true) === SIG_EOCD) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError(NOT_XLSX);

  const totalEntries = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const hasLocator = eocd >= 20 && tail.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR;
  if (hasLocator || totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipFormatError(ZIP64);
  }
  if (cdOffset + cdSize > blob.size) throw new ZipFormatError(NOT_XLSX);

  const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) throw new ZipFormatError(NOT_XLSX);
    const nameLength = cd.getUint16(p + 28, true);
    const extraLength = cd.getUint16(p + 30, true);
    const commentLength = cd.getUint16(p + 32, true);
    const entry: ZipEntry = {
      flags: cd.getUint16(p + 8, true),
      method: cd.getUint16(p + 10, true),
      crc32: cd.getUint32(p + 16, true),
      compressedSize: cd.getUint32(p + 20, true),
      uncompressedSize: cd.getUint32(p + 24, true),
      localHeaderOffset: cd.getUint32(p + 42, true),
      name: decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength)),
    };
    if (entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff || entry.localHeaderOffset === 0xffffffff) {
      throw new ZipFormatError(ZIP64);
    }
    entries.push(entry);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function openEntry(blob: Blob, entry: ZipEntry, mode: InflateMode): Promise<ReadableStream<Uint8Array>> {
  if (entry.flags & 1) throw new ZipFormatError(`A entrada ${entry.name} está criptografada.`);
  const header = await readBytes(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (header.byteLength < 30 || header.getUint32(0, true) !== SIG_LOCAL) {
    throw new ZipFormatError(`Cabeçalho local da entrada ${entry.name} não encontrado.`);
  }
  const start = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const raw = blob.slice(start, start + entry.compressedSize).stream() as ReadableStream<Uint8Array>;
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw, mode);
  throw new ZipFormatError(`A entrada ${entry.name} usa um método de compressão não suportado (${entry.method}).`);
}

export interface ReadEntryOptions {
  inflateMode?: InflateMode;
  /** Called after each chunk with the number of uncompressed bytes read so far. */
  onBytes?: (bytes: number) => void;
}

/**
 * Streams an entry's uncompressed bytes to `onChunk`, computing CRC32 and size on the way.
 * Chunks are only valid during the call.
 */
export async function readEntry(
  blob: Blob,
  entry: ZipEntry,
  onChunk: (chunk: Uint8Array) => void,
  options: ReadEntryOptions = {},
): Promise<EntryIntegrity> {
  const reader = (await openEntry(blob, entry, options.inflateMode ?? 'auto')).getReader();
  let crc = 0;
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32(value, crc);
    size += value.length;
    onChunk(value);
    options.onBytes?.(size);
  }
  return {
    name: entry.name,
    expectedCrc: entry.crc32,
    actualCrc: crc,
    expectedSize: entry.uncompressedSize,
    actualSize: size,
    ok: crc === entry.crc32 && size === entry.uncompressedSize,
  };
}

/** Reads a (small) entry fully into memory. */
export async function readEntryBytes(
  blob: Blob,
  entry: ZipEntry,
  inflateMode: InflateMode = 'auto',
): Promise<{ bytes: Uint8Array; integrity: EntryIntegrity }> {
  const parts: Uint8Array[] = [];
  const integrity = await readEntry(blob, entry, (c) => parts.push(c.slice()), { inflateMode });
  const bytes = new Uint8Array(integrity.actualSize);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { bytes, integrity };
}
