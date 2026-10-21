/** Integrity of an input file: SHA-256 of the whole file and CRC32/size of each ZIP entry (CLAUDE.md, restriction 5). */
import { createSHA256 } from 'hash-wasm';
import type { EntryIntegrity, Stage } from '../../shared/protocol';
import { IngestError } from './errors';
import type { ProgressReporter } from './progress';

export async function sha256(blob: Blob, progress: ProgressReporter): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const reader = (blob.stream() as ReadableStream<Uint8Array>).getReader();
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    hasher.update(r.value);
    done += r.value.length;
    progress.update(done);
  }
  return hasher.digest('hex');
}

export function requireIntact(integrity: EntryIntegrity, stage: Stage): EntryIntegrity {
  if (!integrity.ok) {
    throw new IngestError(
      stage,
      `O arquivo está corrompido: o CRC32 ou o tamanho da entrada ${integrity.name} não confere com o diretório do ZIP.`,
      `CRC32 esperado ${integrity.expectedCrc.toString(16)}, obtido ${integrity.actualCrc.toString(16)}; ` +
        `tamanho esperado ${integrity.expectedSize}, obtido ${integrity.actualSize}.`,
    );
  }
  return integrity;
}
