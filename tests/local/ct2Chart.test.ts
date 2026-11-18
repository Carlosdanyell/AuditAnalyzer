/**
 * The real chart of accounts with the real CT2 extraction, in local/ct2/ (tests C1-C5, decisions of 18/11/2026): both
 * are read together without error, the chart is recognized by its header and the counts are printed to the console
 * only (accounts, duplicates, conflicting, unknown flags, accounts of the extraction outside the chart and the
 * occurrences of C1-C5). No real value is asserted or written anywhere. Skipped when the files are absent.
 */
import { existsSync, openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CT2_CHART_TESTS, ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
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
});
