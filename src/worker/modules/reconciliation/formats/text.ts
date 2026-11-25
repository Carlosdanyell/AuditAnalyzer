/**
 * Format adapter of the plain-text spool (docs/REGRAS_CONCILIADOR.md, sections 2 and 4.1): Blob → normalized lines,
 * in a stream, for every report printed to the spool (GPER040, CTBR400 and, in Phase 16, GPER070/GPER090). Knows no
 * report. The normalization itself is in src/worker/ingest/spoolText.ts, shared with the probe of the start screen.
 */
import { PrinterEscapeFilter, SpoolLineSplitter, isStrictUtf8, normalizeSpoolControls, type SpoolEncoding } from '../../../ingest/spoolText';

/** What the reading of a spool reports (Reconciliação de leitura). */
export interface SpoolReading {
  encoding: SpoolEncoding;
  bytes: number;
  lines: number;
}

/**
 * Calls `onLine` with each normalized line and its number (1-based, counted after the normalization, FF included).
 * The encoding is decided first, over the whole file (the strict UTF-8 decoding can fail at its last byte), by a pass
 * that keeps nothing; the second pass decodes. Neither holds more than a chunk and one line.
 */
export async function readSpoolLines(
  blob: Blob,
  onLine: (line: string, lineNumber: number) => void,
  onBytes?: (read: number, total: number) => void,
): Promise<SpoolReading> {
  const encoding: SpoolEncoding = (await isStrictUtf8(blob.stream())) ? 'utf-8' : 'windows-1252';
  const filter = new PrinterEscapeFilter();
  const decoder = new TextDecoder(encoding);
  const splitter = new SpoolLineSplitter();
  let lines = 0;
  let bytes = 0;
  const emit = (line: string) => onLine(line, ++lines);
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    splitter.push(normalizeSpoolControls(decoder.decode(filter.push(value), { stream: true })), emit);
    onBytes?.(bytes, blob.size);
  }
  splitter.push(normalizeSpoolControls(decoder.decode()), emit);
  splitter.end(emit);
  return { encoding, bytes, lines };
}
