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
import { closeSync, existsSync, mkdirSync, openAsBlob, openSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import type { WorkerEvent } from '../../src/shared/protocol';
import type { InflateMode } from '../../src/worker/ingest/inflate';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { filterIndex } from '../../src/worker/modules/ct2Integrity/filter';
import { ct2Overview } from '../../src/worker/modules/ct2Integrity/overview';
import { segmentMap } from '../../src/worker/modules/ct2Integrity/segments';
import { dateParts } from '../../src/shared/dates';
import { ProgressReporter } from '../../src/worker/ingest/progress';
import { readSheet } from '../../src/worker/ingest/readSheet';
import { CellKind } from '../../src/worker/ingest/sheetStream';
import { CT2_COLUMNS } from '../synthetic/ct2Extraction';
import { writeLargeCt2, type LargeCt2Expected, type LargeCt2Options } from '../synthetic/ct2Large';
import { execFileSync } from 'node:child_process';

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

/**
 * The same extraction in the XML the system writes (docs/REGRAS_CT2_INTEGRIDADE.md, section 2.1), transcribed row by
 * row from the .xlsx: every column of every row as a cell with ss:Index and a style (empty texts as empty CDATA), the
 * date as DateTime, CRLF line ends. About 7 KB per row, as the real file. With `zipped`, also the .zip of it (zip -1).
 */
async function transcribed(name: string, source: { path: string; expected: LargeCt2Expected }, zipped = false): Promise<{ path: string; expected: LargeCt2Expected }> {
  const path = join(dir, name);
  if (!existsSync(path)) {
    const started = performance.now();
    const fd = openSync(`${path}.part`, 'w');
    let buffer = '';
    const write = (s: string, force = false) => {
      buffer += s;
      if (force || buffer.length > 1 << 20) {
        writeSync(fd, buffer);
        buffer = '';
      }
    };
    write('<?xml version="1.0" encoding="UTF-8" ?>\r\n<?mso-application progid="Excel.Sheet"?>\r\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\r\n<Worksheet ss:Name="SCADYFW0.XML">\r\n<Table>\r\n');
    const width = CT2_COLUMNS.length;
    await readSheet({ name, blob: await openAsBlob(source.path) }, {
      fileIndex: 0,
      progress: new ProgressReporter(() => {}, () => 0, 1e9),
      inflateMode,
      width: 256,
      chooseSheet: async () => 0,
      onRow: (r, row, cell) => {
        let xml = `<Row ss:Index="${r}">\r\n`;
        for (let c = 0; c < width; c++) {
          const kind = row.kind[c];
          const text = cell(row, c);
          let data: string;
          if (kind === CellKind.Number && c === 0 && r > 3) {
            const [y, m, d] = dateParts(Number(text) - 36526);
            data = `<Data ss:Type="DateTime">${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000</Data>`;
          } else if (kind === CellKind.Number) data = `<Data ss:Type="Number">${text}</Data>`;
          else data = `<Data ss:Type="String"><![CDATA[${text}]]></Data>`;
          xml += `<Cell ss:Index="${c + 1}" ss:StyleID="s${c + 1}">\r\n${data}\r\n</Cell>\r\n`;
        }
        write(`${xml}</Row>\r\n`);
      },
    });
    write('</Table>\r\n</Worksheet>\r\n</Workbook>\r\n', true);
    closeSync(fd);
    renameSync(`${path}.part`, path);
    console.log(`[medição] ${name} gerado em ${((performance.now() - started) / 1000).toFixed(1)} s`);
  }
  if (zipped && !existsSync(`${path}.zip`)) execFileSync('zip', ['-1', '-j', '-q', `${path}.zip`, path]);
  return { path: zipped ? `${path}.zip` : path, expected: source.expected };
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

  // Phase 14 (section 3.6): the overview is answered from the typed arrays; measured without and with a filter.
  it('overview of ~1 million detail rows', async () => {
    const a = generated('ct2-1m.xlsx', { rows: 1_000_000, seed: 11, firstDate: '01/09/2026', days: 22, firstBatch: 0 });
    const result = await ingestCt2([{ name: 'ct2-1m.xlsx', blob: await openAsBlob(a.path) }], ct2DefaultConfig(), () => {}, { inflateMode }, { holidays: new Set() });
    const analysis = result.analysis!;
    let started = performance.now();
    const index = filterIndex(result, segmentMap(result, analysis.blocks));
    const indexMs = performance.now() - started;
    const time = (filter: Parameters<typeof ct2Overview>[3]) => {
      const runs: number[] = [];
      let lines = 0;
      for (let n = 0; n < 5; n++) {
        started = performance.now();
        lines = ct2Overview(result, analysis, index, filter, new Set()).counts.lines;
        runs.push(performance.now() - started);
      }
      return { ms: Math.min(...runs), first: runs[0]!, lines };
    };
    const all = time({});
    const combined = time({ segment: 0, origins: ['mixed', 'manual'], routine: 'FINA370' });
    console.log(
      `[medição] overview, ${result.summary.lines} linhas: índice do filtro ${indexMs.toFixed(0)} ms; ` +
        `sem filtro ${all.ms.toFixed(0)} ms (1ª ${all.first.toFixed(0)} ms); ` +
        `segmento + origem + rotina ${combined.ms.toFixed(0)} ms (1ª ${combined.first.toFixed(0)} ms, ${combined.lines} linhas)`,
    );
    expect(all.lines).toBe(result.summary.lines);
  });

  // The XML the system writes: the extraction of a year (~340 thousand rows), plain and in a .zip.
  it.runIf(process.env.MEDIR_CT2_XML)('one year in the XML of the system (~340 thousand rows), plain and zipped', async () => {
    const a = generated('ct2-340k.xlsx', { rows: 340_000, seed: 31, firstDate: '02/01/2026', days: 250, firstBatch: 0 });
    for (const zipped of [false, true]) {
      const x = await transcribed('ct2-340k.xml', a, zipped);
      const name = zipped ? 'ct2-340k.zip' : 'ct2-340k.xml';
      const result = await measure(`XML do sistema${zipped ? ' em .zip' : ''}, ~340 mil linhas (${mb(statSync(x.path).size)})`, [{ name, ...x }]);
      expect(result.summary.segments).toEqual(a.expected.segments);
    }
  });

  it('two files, ~1.3 million detail rows', async () => {
    const a = generated('ct2-700k.xlsx', { rows: 700_000, seed: 21, firstDate: '01/08/2026', days: 21, firstBatch: 0 });
    const b = generated('ct2-600k.xlsx', { rows: 600_000, seed: 22, firstDate: '01/09/2026', days: 22, firstBatch: 100_000 });
    await measure('2 arquivos, ~1,3 milhão de linhas', [{ name: 'ct2-700k.xlsx', ...a }, { name: 'ct2-600k.xlsx', ...b }]);
  });
});
