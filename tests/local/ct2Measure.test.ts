/**
 * Time and memory of the CT2 reading and analysis with large synthetic extractions (docs/MEDICOES.md). Opt-in: runs only with
 * MEDIR_CT2=1 (`npm run test:local`); the files are generated once in the system temporary folder, never in local/.
 * Memory (heap + external ArrayBuffers, above what was in use before the run): the peak sampled during the run,
 * which includes garbage not yet collected; the live peak, sampled after a full collection about every second (the
 * measure comparable to the browser's, measureUserAgentSpecificMemory); and what the Base keeps at the end.
 * Decompression: fflate by default, whose memory is the one comparable to the browser's; MEDIR_CT2_INFLATE=native
 * measures the native one (the browser's path; in Node its DecompressionStream reads the whole compressed sheet
 * ahead, without backpressure, which inflates the memory). One mode per process: memory released late by one run
 * would distort the next.
 */
import { closeSync, existsSync, mkdirSync, openAsBlob, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import type { WorkerEvent } from '../../src/shared/protocol';
import type { InflateMode } from '../../src/worker/ingest/inflate';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { writeLargeCt2, type LargeCt2Expected, type LargeCt2Options } from '../synthetic/ct2Large';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const dir = join(tmpdir(), 'auditanalyzer-ct2');
const mb = (n: number) => `${Math.round(n / 2 ** 20)} MB`;
const inflateMode: InflateMode = process.env.MEDIR_CT2_INFLATE === 'native' ? 'native' : 'fallback';

function generated(name: string, o: LargeCt2Options): { path: string; expected: LargeCt2Expected } {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const sidecar = `${path}.json`;
  const key = JSON.stringify(o);
  if (existsSync(path) && existsSync(sidecar)) {
    const saved = JSON.parse(readFileSync(sidecar, 'utf8')) as { key: string; expected: LargeCt2Expected };
    if (saved.key === key) return { path, expected: saved.expected };
  }
  const started = performance.now();
  const fd = openSync(`${path}.part`, 'w');
  const expected = writeLargeCt2((chunk) => writeSync(fd, chunk), o);
  closeSync(fd);
  renameSync(`${path}.part`, path);
  writeFileSync(sidecar, JSON.stringify({ key, expected }));
  console.log(`[medição] ${name} gerado em ${((performance.now() - started) / 1000).toFixed(1)} s (${mb(expected.bytes)})`);
  return { path, expected };
}

async function measure(label: string, files: { name: string; path: string; expected: LargeCt2Expected }[]) {
  gc();
  const base = process.memoryUsage();
  let peak = 0;
  let livePeak = 0;
  let lastCollection = performance.now();
  const used = () => {
    const m = process.memoryUsage();
    return m.heapUsed + m.external - base.heapUsed - base.external;
  };
  const sample = () => {
    peak = Math.max(peak, used());
    if (performance.now() - lastCollection >= 1000) {
      gc();
      livePeak = Math.max(livePeak, used());
      lastCollection = performance.now();
    }
  };
  const timer = setInterval(sample, 20);
  const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, blob: await openAsBlob(f.path) })));
  const started = performance.now();
  // Time of the stages that run once (sort, analysis, invariants), from the progress events.
  const once: { stage: string; at: number }[] = [];
  const post = (e: WorkerEvent) => {
    sample();
    if (e.type === 'progress' && e.fileIndex === undefined && once.at(-1)?.stage !== e.stage) once.push({ stage: e.stage, at: performance.now() });
  };
  const result = await ingestCt2(inputs, ct2DefaultConfig(), post, { inflateMode }, { holidays: new Set() });
  const ms = performance.now() - started;
  const onceText = once.map((x, i) => `${x.stage} ${(((once[i + 1]?.at ?? started + ms) - x.at) / 1000).toFixed(1)} s`).join(', ');
  sample();
  clearInterval(timer);
  gc();
  const after = process.memoryUsage();
  const kept = after.heapUsed + after.external - base.heapUsed - base.external;
  const stages = result.reconciliation.files.map((f) => f.timings.map((t) => `${t.stage} ${(t.ms / 1000).toFixed(1)} s`).join(', ')).join(' | ');
  console.log(
    `[medição] ${label}, ${inflateMode === 'native' ? 'descompressão nativa' : 'fflate'}: ${(ms / 1000).toFixed(1)} s (inclui as coletas da medição); ` +
      `pico ${mb(peak)} com lixo, ${mb(livePeak)} vivo; ` +
      `mantido ${mb(kept)} (base ${mb(result.store.bytes())}), ` +
      `RSS máximo ${mb(process.resourceUsage().maxRSS * 1024)}; ${stages} | ${onceText}; ` +
      `${result.summary.analysis!.exceptions} exceções`,
  );
  expect(result.reconciliation.checks.filter((c) => c.severity === 'error').every((c) => c.passed)).toBe(true);
  expect(result.summary.lines).toBe(files.reduce((n, f) => n + f.expected.detailRows, 0));
  expect(result.summary.documents).toBe(files.reduce((n, f) => n + f.expected.documents, 0));
  return result;
}

describe.runIf(process.env.MEDIR_CT2)('CT2 reading: measurements', () => {
  it('one file of ~1 million detail rows', async () => {
    const a = generated('ct2-1m.xlsx', { rows: 1_000_000, seed: 11, firstDate: '01/09/2026', days: 22, firstBatch: 0 });
    const result = await measure('1 arquivo, ~1 milhão de linhas', [{ name: 'ct2-1m.xlsx', ...a }]);
    expect(result.summary.segments).toEqual(a.expected.segments);
  });

  it('two files, ~1.3 million detail rows', async () => {
    const a = generated('ct2-700k.xlsx', { rows: 700_000, seed: 21, firstDate: '01/08/2026', days: 21, firstBatch: 0 });
    const b = generated('ct2-600k.xlsx', { rows: 600_000, seed: 22, firstDate: '01/09/2026', days: 22, firstBatch: 100_000 });
    await measure('2 arquivos, ~1,3 milhão de linhas', [{ name: 'ct2-700k.xlsx', ...a }, { name: 'ct2-600k.xlsx', ...b }]);
  });
});
