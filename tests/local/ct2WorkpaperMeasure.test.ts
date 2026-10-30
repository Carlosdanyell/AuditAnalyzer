/**
 * Size, time and memory of the CT2 workpaper with large synthetic extractions, and its recalculation in LibreOffice
 * (docs/REGRAS_CT2_INTEGRIDADE.md, section 7.9; docs/MEDICOES.md). Opt-in: MEDIR_CT2_PLANILHA=1 with the sizes in
 * MEDIR_CT2_LINHAS (default "40000,300000"); the extractions and the workpapers go to the system temporary folder,
 * never to local/. When `soffice` is installed, the workpaper is opened headless, recalculated and its Resumo exported
 * as CSV: every status of the matrix and of the board must be OK / Confere after the recalculation.
 * MEDIR_CT2_SO_MAPEADAS=1 measures a Base with only the mapped columns (an alternative under discussion, section 7.9).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openAsBlob, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { buildCt2Workpaper } from '../../src/worker/modules/ct2Integrity/workpaper';
import { writeLargeCt2 } from '../synthetic/ct2Large';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const dir = join(tmpdir(), 'auditanalyzer-ct2-planilha');
const mb = (n: number) => `${Math.round(n / 2 ** 20)} MB`;
const sizes = (process.env.MEDIR_CT2_LINHAS ?? '40000,300000').split(',').map(Number);
const soffice = spawnSync('which', ['soffice']).status === 0;
const onlyMapped = process.env.MEDIR_CT2_SO_MAPEADAS === '1';

function extraction(rows: number): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `ct2-${rows}.xlsx`);
  if (existsSync(path)) return path;
  const fd = openSync(`${path}.part`, 'w');
  writeLargeCt2((chunk) => writeSync(fd, chunk), { rows, seed: 31, firstDate: '01/09/2026', days: 22, firstBatch: 0 });
  closeSync(fd);
  renameSync(`${path}.part`, path);
  return path;
}

describe.runIf(process.env.MEDIR_CT2_PLANILHA)('CT2 workpaper: measurements', () => {
  for (const rows of sizes) {
    it(`${rows} detail rows`, async () => {
      const source = extraction(rows);
      const config = ct2DefaultConfig();
      const ingested = await ingestCt2([{ name: 'ct2.xlsx', blob: await openAsBlob(source) }], config, () => {}, { inflateMode: 'fallback' }, { holidays: new Set() });
      gc();
      const before = process.memoryUsage();
      // Sampled at every progress call: the writing of the Base is synchronous, so a timer would not run.
      let peak = 0;
      const sample = () => {
        const m = process.memoryUsage();
        peak = Math.max(peak, m.heapUsed + m.external - before.heapUsed - before.external);
      };
      const started = performance.now();
      // Only the mapped columns: the same store without the other columns of the extraction.
      const store = onlyMapped ? Object.assign(Object.create(Object.getPrototypeOf(ingested.store) as object) as typeof ingested.store, ingested.store, { other: new Map() }) : ingested.store;
      const out = await buildCt2Workpaper(
        {
          base: { ...ingested, store },
          analysis: ingested.analysis!,
          config,
          holidays: [],
          language: 'pt',
          generatedAt: '29/10/2026 10:30:00',
          appVersion: 'medição',
          configHash: '-',
          configDifferences: [],
          confirmedFailures: [],
        },
        sample,
      );
      sample();
      const ms = performance.now() - started;
      const path = join(dir, `planilha-${rows}${onlyMapped ? '-mapeadas' : ''}.xlsx`);
      writeFileSync(path, new Uint8Array(await out.blob.arrayBuffer()));
      const xml = execFileSync('unzip', ['-l', path]).toString();
      const sheetBytes = Math.max(...[...xml.matchAll(/^\s*(\d+)\s+\S+\s+\S+\s+xl\/worksheets\//gm)].map((m) => Number(m[1])));
      let recalc = '—';
      let statuses: string[] = [];
      if (soffice) {
        const outDir = join(dir, `csv-${rows}${onlyMapped ? '-mapeadas' : ''}`);
        rmSync(outDir, { recursive: true, force: true });
        const t = performance.now();
        // Sheet 1 (Resumo) as CSV, after LibreOffice computes every formula (the workbook has no cached values).
        execFileSync('soffice', ['--headless', '--calc', '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,1', '--outdir', outDir, path], { timeout: 3_600_000 });
        recalc = `${((performance.now() - t) / 1000).toFixed(0)} s`;
        const csv = readFileSync(join(outDir, `planilha-${rows}${onlyMapped ? '-mapeadas' : ''}-Resumo.csv`), 'utf8');
        // The status of each level of the matrix (7th column) and the tie-out of each test of the board (9th column).
        const lines = csv.split('\n').map((l) => l.split(','));
        const matrix = ['Base', 'Documentos', 'Lotes', 'Dias', 'Ferramenta (motor)'];
        statuses = lines.flatMap((c) => (matrix.includes(c[0]!) ? [c[6]!] : /^[BIEP]\d$/.test(c[0]!) ? [c[8]!] : []));
      }
      console.log(
        `[medição] planilha CT2${onlyMapped ? ' (só colunas mapeadas)' : ''}, ${rows} linhas: geração ${(ms / 1000).toFixed(1)} s, arquivo ${mb(statSync(path).size)}, maior aba ${mb(sheetBytes)} descompactada, ` +
          `pico da geração ${mb(peak)}; LibreOffice (abrir, recalcular, exportar o Resumo): ${recalc}; matriz e quadro: ${statuses.filter((s) => s === 'OK' || s === 'Confere').length} OK/Confere, ${statuses.filter((s) => s !== 'OK' && s !== 'Confere').length} outros`,
      );
      if (soffice) {
        expect(statuses.length).toBeGreaterThan(5);
        expect(statuses.filter((s) => s !== 'OK' && s !== 'Confere')).toEqual([]);
      }
    }, 7_200_000);
  }
});
