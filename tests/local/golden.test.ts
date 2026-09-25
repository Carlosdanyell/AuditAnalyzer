/**
 * Compares the ingestion of the real files in local/ with local/golden.json.
 * Failures list only the names of the diverging fields, never the real values, so the output can be
 * shared without exposing data. Each part is skipped when its file is absent.
 */
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { formatIsoDateTime } from '../../src/shared/dates';
import type { FileReconciliation, OperationCount } from '../../src/shared/protocol';
import { runIngestion, type IngestionResult } from '../../src/worker/ingest/pipeline';

const localDir = join(import.meta.dirname, '..', '..', 'local');
const goldenPath = join(localDir, 'golden.json');

interface GoldenFile {
  nome_esperado: string;
  linhas_planilha_incluindo_1o_cabecalho: number;
  linhas_apos_1o_cabecalho: number;
  cabecalhos_repetidos: number;
  linhas_em_branco: number;
  linhas_detalhe: number;
  eventos_por_operacao: Record<string, number>;
  primeiro_evento: string;
  ultimo_evento: string;
}

interface GoldenConsolidated {
  linhas_detalhe: number;
  eventos_por_operacao: Record<string, number>;
  primeiro_evento: string;
  ultimo_evento: string;
}

const golden = existsSync(goldenPath)
  ? (JSON.parse(readFileSync(goldenPath, 'utf8')) as {
      arquivo_agosto: GoldenFile;
      arquivo_setembro: GoldenFile;
      consolidado: GoldenConsolidated;
    })
  : null;

const pathOf = (g: GoldenFile | undefined) => (g ? join(localDir, g.nome_esperado) : '');
const has = (g: GoldenFile | undefined) => g !== undefined && existsSync(pathOf(g));

async function ingest(files: GoldenFile[]): Promise<IngestionResult> {
  const inputs = await Promise.all(files.map(async (g) => ({ name: g.nome_esperado, blob: await openAsBlob(pathOf(g)) })));
  const started = performance.now();
  const result = await runIngestion(inputs, defaultConfig(), () => {});
  const ms = performance.now() - started;
  const rows = result.reconciliation.files.reduce((n, f) => n + f.rows.totalRows, 0);
  console.log(
    `[medição] ${files.map((f) => f.nome_esperado).join(' + ')}: ${(ms / 1000).toFixed(1)} s, ` +
      `${Math.round(rows / (ms / 1000)).toLocaleString('pt-BR')} linhas/s, ` +
      `RSS ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB, heap ${Math.round(process.memoryUsage().heapUsed / 2 ** 20)} MB; ` +
      `etapas: ${result.reconciliation.files.map((f) => f.timings.map((t) => `${t.stage} ${t.ms} ms`).join(', ')).join(' | ')}`,
  );
  return result;
}

function mismatches(expected: Record<string, unknown>, actual: Record<string, unknown>): string[] {
  return Object.keys(expected).filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]));
}

const byOperation = (events: OperationCount[]) =>
  Object.fromEntries(events.filter((e) => e.count > 0 || e.operation !== '(operação não reconhecida)').map((e) => [e.operation, e.count]));

function compareFile(g: GoldenFile, f: FileReconciliation): string[] {
  const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort());
  return mismatches(
    {
      linhas_planilha_incluindo_1o_cabecalho: g.linhas_planilha_incluindo_1o_cabecalho,
      linhas_apos_1o_cabecalho: g.linhas_apos_1o_cabecalho,
      cabecalhos_repetidos: g.cabecalhos_repetidos,
      linhas_em_branco: g.linhas_em_branco,
      linhas_detalhe: g.linhas_detalhe,
      eventos_por_operacao: sortKeys(g.eventos_por_operacao),
      primeiro_evento: g.primeiro_evento,
      ultimo_evento: g.ultimo_evento,
    },
    {
      linhas_planilha_incluindo_1o_cabecalho: f.rows.totalRows,
      linhas_apos_1o_cabecalho: f.rows.rowsAfterHeader,
      cabecalhos_repetidos: f.rows.repeatedHeaders,
      linhas_em_branco: f.rows.blankRows,
      linhas_detalhe: f.rows.detailRows,
      eventos_por_operacao: sortKeys(byOperation(f.events)),
      primeiro_evento: f.firstEvent === null ? null : formatIsoDateTime(f.firstEvent),
      ultimo_evento: f.lastEvent === null ? null : formatIsoDateTime(f.lastEvent),
    },
  );
}

function expectClean(result: IngestionResult) {
  const failed = result.reconciliation.checks.filter((c) => !c.passed && c.severity === 'error').map((c) => c.id);
  expect(failed, 'invariantes com falha').toEqual([]);
  for (const f of result.reconciliation.files) expect(f.rows.balanced, `${f.name}: reconciliação`).toBe(true);
}

describe.skipIf(!golden)('local golden reference', () => {
  it.skipIf(!has(golden?.arquivo_setembro))('September file alone matches golden.json', async () => {
    const result = await ingest([golden!.arquivo_setembro]);
    expectClean(result);
    expect(compareFile(golden!.arquivo_setembro, result.reconciliation.files[0]!), 'campos divergentes').toEqual([]);
  });

  it.skipIf(!has(golden?.arquivo_agosto))('August file alone matches golden.json', async () => {
    const result = await ingest([golden!.arquivo_agosto]);
    expectClean(result);
    expect(compareFile(golden!.arquivo_agosto, result.reconciliation.files[0]!), 'campos divergentes').toEqual([]);
  });

  it.skipIf(!has(golden?.arquivo_agosto) || !has(golden?.arquivo_setembro))('both files match golden.json', async () => {
    const result = await ingest([golden!.arquivo_agosto, golden!.arquivo_setembro]);
    expectClean(result);
    const [a, s] = result.reconciliation.files;
    expect(compareFile(golden!.arquivo_agosto, a!), 'agosto: campos divergentes').toEqual([]);
    expect(compareFile(golden!.arquivo_setembro, s!), 'setembro: campos divergentes').toEqual([]);
    const c = result.reconciliation.consolidated;
    const g = golden!.consolidado;
    const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort());
    expect(
      mismatches(
        {
          linhas_detalhe: g.linhas_detalhe,
          eventos_por_operacao: sortKeys(g.eventos_por_operacao),
          primeiro_evento: g.primeiro_evento,
          ultimo_evento: g.ultimo_evento,
        },
        {
          linhas_detalhe: c.detailRows,
          eventos_por_operacao: sortKeys(byOperation(c.events)),
          primeiro_evento: c.firstEvent === null ? null : formatIsoDateTime(c.firstEvent),
          ultimo_evento: c.lastEvent === null ? null : formatIsoDateTime(c.lastEvent),
        },
      ),
      'consolidado: campos divergentes',
    ).toEqual([]);
  });
});
