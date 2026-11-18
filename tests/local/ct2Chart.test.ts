/**
 * The real chart of accounts with the real CT2 extraction, in local/ct2/ (tests C1-C5, decisions of 18/11/2026): both
 * are read together without error, the chart is recognized by its header and the counts are printed to the console
 * only (accounts, duplicates, conflicting, unknown flags, accounts of the extraction outside the chart and the
 * occurrences of C1-C5). With `soffice` installed, the workpaper of both is written to the temporary folder,
 * recalculated by LibreOffice and its Resumo checked: every status of the matrix and of the board OK / Confere, C1-C5
 * among them; only the counts of statuses are printed, and the files are deleted. No real value is asserted or written
 * anywhere. Skipped when the files are absent.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, openAsBlob, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CT2_CHART_TESTS, ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { buildCt2Workpaper } from '../../src/worker/modules/ct2Integrity/workpaper';
import { localDir } from './realFiles';

const dir = join(localDir, 'ct2');
const extraction = join(dir, 'ct2-protheus.xml');
const chart = join(dir, 'plano-de-contas.xlsx');

describe.skipIf(!existsSync(extraction) || !existsSync(chart))('real chart of accounts with the real extraction (local/ct2)', () => {
  it('reads both, applies C1-C5 and prints the counts', async () => {
    const result = await ingestCt2(
      [
        { name: 'plano', blob: await openAsBlob(chart) },
        { name: 'extracao', blob: await openAsBlob(extraction) },
      ],
      ct2DefaultConfig(),
      () => {},
      {},
      { holidays: new Set() },
    );
    const r = result.reconciliation;
    expect(r.files).toHaveLength(1);
    expect(r.chart).not.toBeNull();
    expect(r.checks.filter((c) => c.severity === 'error' && !c.passed).map((c) => c.id)).toEqual([]);
    const c = r.chart!;
    const tests = result.analysis!.tests.filter((t) => (CT2_CHART_TESTS as readonly string[]).includes(t.code));
    expect(tests.every((t) => t.state === 'on')).toBe(true);
    console.log(
      `[plano] cabeçalho na linha ${c.headerRow}; ${c.rows} linhas, ${c.accounts} contas, ${c.duplicates} repetidas com as mesmas marcas, ` +
        `${c.conflicting} com marcas diferentes, ${c.unknownFlags} marcas desconhecidas, ${c.withoutAccount} linhas sem conta, ` +
        `colunas ausentes: ${c.missingColumns.length}; contas da extração fora do plano: ${c.missingAccounts.count}; ` +
        tests.map((t) => `${t.code} ${t.occurrences}`).join(', '),
    );
  });

  it.runIf(spawnSync('which', ['soffice']).status === 0)('exports the workpaper with C1-C5, which ties out after LibreOffice recalculates it', async () => {
    const config = ct2DefaultConfig();
    const read = await ingestCt2(
      [
        { name: 'plano.xlsx', blob: await openAsBlob(chart) },
        { name: 'extracao.xml', blob: await openAsBlob(extraction) },
      ],
      config,
      () => {},
      {},
      { holidays: new Set() },
    );
    const out = await buildCt2Workpaper(
      { base: read, analysis: read.analysis!, config, holidays: [], language: 'pt', generatedAt: '18/11/2026 10:00:00', appVersion: 'local', configHash: '-', configDifferences: [], confirmedFailures: [] },
      () => {},
    );
    const temp = mkdtempSync(join(tmpdir(), 'auditanalyzer-ct2-plano-'));
    try {
      const path = join(temp, 'planilha.xlsx');
      writeFileSync(path, new Uint8Array(await out.blob.arrayBuffer()));
      execFileSync('soffice', ['--headless', '--calc', '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,1', '--outdir', temp, path], { timeout: 3_600_000, stdio: 'pipe' });
      const lines = readFileSync(join(temp, 'planilha-Resumo.csv'), 'utf8').split('\n').map((l) => l.split(','));
      const matrix = ['Base', 'Documentos', 'Lotes', 'Dias', 'Ferramenta (motor)'];
      const statuses = lines.flatMap((c) => (matrix.includes(c[0]!) ? [c[6]!] : /^[BIECP]\d[a-c]?$/.test(c[0]!) ? [c[8]!] : []));
      const chartBoard = lines.filter((c) => (CT2_CHART_TESTS as readonly string[]).includes(c[0]!)).map((c) => c[8]);
      console.log(
        `[plano] planilha recalculada no LibreOffice: matriz e quadro ${statuses.filter((x) => x === 'OK' || x === 'Confere').length} OK/Confere, ` +
          `${statuses.filter((x) => x !== 'OK' && x !== 'Confere').length} outros; C1 a C5 no quadro: ${chartBoard.filter((x) => x === 'Confere').length} Confere de ${chartBoard.length}`,
      );
      expect(chartBoard).toEqual(CT2_CHART_TESTS.map(() => 'Confere'));
      expect(statuses.filter((x) => x !== 'OK' && x !== 'Confere')).toEqual([]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 3_600_000);
});
