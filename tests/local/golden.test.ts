/**
 * Compares the analysis of the real files in local/ with local/golden.json.
 * Failures list only the names of the diverging fields, never the real values, so the output can be
 * shared without exposing data. Each part is skipped when its files are absent.
 */
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { dayOfSeconds, formatIsoDateTime, parseDate } from '../../src/shared/dates';
import type { FileReconciliation, OperationCount, ScopeStats } from '../../src/shared/protocol';
import type { ScopeAnalysis } from '../../src/worker/engine/analysis';
import { FULL_PERIOD, periodPanel, type CategoryPanel, type DayPeriod } from '../../src/worker/engine/periods';
import { runIngestion, type IngestionResult } from '../../src/worker/ingest/pipeline';

const localDir = join(import.meta.dirname, '..', '..', 'local');
const goldenPath = join(localDir, 'golden.json');

interface GoldenStats {
  registros_distintos: number;
  documentos: number;
  alteracoes_por_tipo: Record<string, number>;
  tpsald_total: number;
  tpsald_9_para_1: number;
  registros_nao_identificados: number;
  documentos_base_parcial: number;
  documentos_desbalanceados_base_completa: number;
  partidas_excluidas: number;
  linhas_aba_alteracoes_efetivas: number;
}

interface GoldenFile extends GoldenStats {
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

interface GoldenConsolidated extends GoldenStats {
  linhas_detalhe: number;
  eventos_por_operacao: Record<string, number>;
  primeiro_evento: string;
  ultimo_evento: string;
  registros_nas_duas_extracoes: number;
}

interface GoldenCell {
  lancamentos: number;
  documentos: number;
  valor_debitado_centavos: number;
}
type GoldenCategory = { manual: GoldenCell; automatico: GoldenCell; documentos_mistos: number };
type GoldenPanel = { excluido: GoldenCategory; alterado: GoldenCategory; postado: GoldenCategory };

interface Golden {
  arquivo_agosto: GoldenFile;
  arquivo_setembro: GoldenFile;
  consolidado: GoldenConsolidated;
  paineis_somente_agosto: Record<string, GoldenPanel>;
  paineis_consolidado: Record<string, GoldenPanel>;
  casos_pontuais: {
    documento_com_exclusao_em_duas_janelas: string;
    registro_so_com_carimbo: string;
    exclusoes_17_a_24_08: { documentos: number; partidas: number; valor_debitado_centavos: number };
  };
}

const golden = existsSync(goldenPath) ? (JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden) : null;

const pathOf = (g: GoldenFile | undefined) => (g ? join(localDir, g.nome_esperado) : '');
const has = (g: GoldenFile | undefined) => g !== undefined && existsSync(pathOf(g));
const hasAugust = has(golden?.arquivo_agosto);
const hasSeptember = has(golden?.arquivo_setembro);

const cache = new Map<string, Promise<IngestionResult>>();

function ingest(files: GoldenFile[]): Promise<IngestionResult> {
  const key = files.map((f) => f.nome_esperado).join('+');
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const inputs = await Promise.all(files.map(async (g) => ({ name: g.nome_esperado, blob: await openAsBlob(pathOf(g)) })));
      const started = performance.now();
      const result = await runIngestion(inputs, defaultConfig(), () => {});
      const ms = performance.now() - started;
      const rows = result.reconciliation.files.reduce((n, f) => n + f.rows.totalRows, 0);
      console.log(
        `[medição] ${key}: ${(ms / 1000).toFixed(1)} s, ` +
          `${Math.round(rows / (ms / 1000)).toLocaleString('pt-BR')} linhas/s, ` +
          `RSS ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB, heap ${Math.round(process.memoryUsage().heapUsed / 2 ** 20)} MB; ` +
          `etapas: ${result.reconciliation.files.map((f) => f.timings.map((t) => `${t.stage} ${t.ms} ms`).join(', ')).join(' | ')}`,
      );
      return result;
    })();
    cache.set(key, pending);
  }
  return pending;
}

function mismatches(expected: Record<string, unknown>, actual: Record<string, unknown>): string[] {
  return Object.keys(expected).filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]));
}

const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort());
const byOperation = (events: OperationCount[]) =>
  sortKeys(Object.fromEntries(events.filter((e) => e.count > 0 || e.operation !== '(operação não reconhecida)').map((e) => [e.operation, e.count])));

function compareReading(g: GoldenFile, f: FileReconciliation): string[] {
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
      eventos_por_operacao: byOperation(f.events),
      primeiro_evento: f.firstEvent === null ? null : formatIsoDateTime(f.firstEvent),
      ultimo_evento: f.lastEvent === null ? null : formatIsoDateTime(f.lastEvent),
    },
  );
}

function compareStats(g: GoldenStats, s: ScopeStats): string[] {
  return mismatches(
    {
      registros_distintos: g.registros_distintos,
      documentos: g.documentos,
      alteracoes_por_tipo: sortKeys(g.alteracoes_por_tipo),
      tpsald_total: g.tpsald_total,
      tpsald_9_para_1: g.tpsald_9_para_1,
      registros_nao_identificados: g.registros_nao_identificados,
      documentos_base_parcial: g.documentos_base_parcial,
      documentos_desbalanceados_base_completa: g.documentos_desbalanceados_base_completa,
      partidas_excluidas: g.partidas_excluidas,
      linhas_aba_alteracoes_efetivas: g.linhas_aba_alteracoes_efetivas,
    },
    {
      registros_distintos: s.records,
      documentos: s.documents,
      alteracoes_por_tipo: sortKeys({
        'Alteração efetiva': s.alterations.effective,
        'Efetivação do tipo de saldo (9 → 1)': s.alterations.activation,
        'Somente carimbo de usuário (CT2_USERGA)': s.alterations.stamp,
      }),
      tpsald_total: s.balanceType.total,
      tpsald_9_para_1: s.balanceType.expected,
      registros_nao_identificados: s.unidentifiedRecords,
      documentos_base_parcial: s.partialBaseDocuments,
      documentos_desbalanceados_base_completa: s.unbalancedCompleteDocuments,
      partidas_excluidas: s.deletedRecords,
      linhas_aba_alteracoes_efetivas: s.effectiveChangeRows,
    },
  );
}

/** "17_a_24_08" → 17/08–24/08 of the log's year; "log_completo" → everything. */
function periodOf(key: string, year: string): DayPeriod {
  if (key === 'log_completo') return FULL_PERIOD;
  const m = /^(\d\d)_a_(\d\d)_(\d\d)$/.exec(key);
  if (!m) throw new Error(`período desconhecido no golden: ${key}`);
  return { startDay: parseDate(`${m[1]}/${m[3]}/${year}`), endDay: parseDate(`${m[2]}/${m[3]}/${year}`) };
}

function comparePanels(expected: Record<string, GoldenPanel>, scope: ScopeAnalysis, year: string): string[] {
  const cell = (c: CategoryPanel['manual']): GoldenCell => ({
    lancamentos: c.lines,
    documentos: c.documents,
    valor_debitado_centavos: c.debitCents,
  });
  const category = (c: CategoryPanel): GoldenCategory => ({
    manual: cell(c.manual),
    automatico: cell(c.automatic),
    documentos_mistos: c.mixedDocuments,
  });
  const out: string[] = [];
  for (const [key, g] of Object.entries(expected)) {
    const p = periodPanel(scope, periodOf(key, year));
    const actual: GoldenPanel = { excluido: category(p.deleted), alterado: category(p.changed), postado: category(p.posted) };
    for (const cat of ['excluido', 'alterado', 'postado'] as const) {
      for (const col of ['manual', 'automatico', 'documentos_mistos'] as const) {
        if (col === 'documentos_mistos') {
          if (g[cat][col] !== actual[cat][col]) out.push(`${key}.${cat}.${col}`);
        } else {
          for (const f of mismatches({ ...g[cat][col] }, { ...actual[cat][col] })) out.push(`${key}.${cat}.${col}.${f}`);
        }
      }
    }
  }
  return out;
}

function expectClean(result: IngestionResult) {
  const failed = result.reconciliation.checks.filter((c) => !c.passed && c.severity === 'error').map((c) => c.id);
  expect(failed, 'invariantes com falha').toEqual([]);
}

const yearOf = (g: Golden) => g.arquivo_agosto.primeiro_evento.slice(0, 4);

describe.skipIf(!golden)('local golden reference', () => {
  describe.skipIf(!hasSeptember)('September file alone', () => {
    it('reading matches golden.json', async () => {
      const result = await ingest([golden!.arquivo_setembro]);
      expectClean(result);
      expect(compareReading(golden!.arquivo_setembro, result.reconciliation.files[0]!), 'campos divergentes').toEqual([]);
    });

    it('analysis matches golden.json', async () => {
      const result = await ingest([golden!.arquivo_setembro]);
      expect(compareStats(golden!.arquivo_setembro, result.summary.scopes[0]!.stats), 'campos divergentes').toEqual([]);
    });

    it('point case "registro só com carimbo", when its Recno is in this file', async () => {
      const recno = Number(/(\d+)/.exec(golden!.casos_pontuais.registro_so_com_carimbo)?.[1]);
      const scope = (await ingest([golden!.arquivo_setembro])).analyses[0]!;
      const record = scope.records.find((r) => r.recno === recno);
      if (!record) {
        console.log('[caso pontual] registro só com carimbo: o Recno não está neste arquivo');
        return;
      }
      expect({ origin: record.origin, doc: record.documentIndex, changes: record.changeCount, activations: record.activationCount })
        .toEqual({ origin: 'unidentified', doc: -1, changes: 0, activations: 0 });
      expect(record.stampCount).toBeGreaterThan(0);
    });
  });

  describe.skipIf(!hasAugust)('August file alone', () => {
    it('reading and analysis match golden.json', async () => {
      const result = await ingest([golden!.arquivo_agosto]);
      expectClean(result);
      expect(compareReading(golden!.arquivo_agosto, result.reconciliation.files[0]!), 'leitura: campos divergentes').toEqual([]);
      expect(compareStats(golden!.arquivo_agosto, result.summary.scopes[0]!.stats), 'análise: campos divergentes').toEqual([]);
    });

    it('August-only panels match golden.json', async () => {
      const result = await ingest([golden!.arquivo_agosto]);
      expect(comparePanels(golden!.paineis_somente_agosto, result.analyses[0]!, yearOf(golden!)), 'painéis divergentes').toEqual([]);
    });
  });

  describe.skipIf(!hasAugust || !hasSeptember)('both files', () => {
    const both = () => ingest([golden!.arquivo_agosto, golden!.arquivo_setembro]);

    it('reading, per-file and consolidated analysis match golden.json', async () => {
      const result = await both();
      expectClean(result);
      const [a, s] = result.reconciliation.files;
      expect(compareReading(golden!.arquivo_agosto, a!), 'agosto: campos divergentes').toEqual([]);
      expect(compareReading(golden!.arquivo_setembro, s!), 'setembro: campos divergentes').toEqual([]);
      const c = result.reconciliation.consolidated;
      const g = golden!.consolidado;
      const stats = result.summary.scopes.at(-1)!.stats;
      expect(
        [
          ...mismatches(
            {
              linhas_detalhe: g.linhas_detalhe,
              eventos_por_operacao: sortKeys(g.eventos_por_operacao),
              primeiro_evento: g.primeiro_evento,
              ultimo_evento: g.ultimo_evento,
              registros_nas_duas_extracoes: g.registros_nas_duas_extracoes,
            },
            {
              linhas_detalhe: c.detailRows,
              eventos_por_operacao: byOperation(c.events),
              primeiro_evento: c.firstEvent === null ? null : formatIsoDateTime(c.firstEvent),
              ultimo_evento: c.lastEvent === null ? null : formatIsoDateTime(c.lastEvent),
              registros_nas_duas_extracoes: stats.recordsInSeveralFiles,
            },
          ),
          ...compareStats(g, stats),
        ],
        'consolidado: campos divergentes',
      ).toEqual([]);
    });

    it('consolidated panels match golden.json', async () => {
      const result = await both();
      expect(comparePanels(golden!.paineis_consolidado, result.analyses.at(-1)!, yearOf(golden!)), 'painéis divergentes').toEqual([]);
    });

    it('point cases match golden.json', async () => {
      const scope = (await both()).analyses.at(-1)!;
      const year = yearOf(golden!);
      const cases = golden!.casos_pontuais;
      const doc = scope.documents.find((d) => d.key === cases.documento_com_exclusao_em_duas_janelas);
      const w1 = periodOf('17_a_24_08', year);
      const w2 = periodOf('25_a_31_08', year);
      const within = (t: number, p: DayPeriod) => dayOfSeconds(t) >= p.startDay && dayOfSeconds(t) <= p.endDay;
      expect(
        doc !== undefined && within(doc.firstDeletion, w1) && within(doc.lastDeletion, w2),
        'documento com exclusão em duas janelas',
      ).toBe(true);

      const deleted = periodPanel(scope, w1).deleted;
      expect(
        mismatches(cases.exclusoes_17_a_24_08, {
          documentos: deleted.totalDocuments,
          partidas: deleted.manual.lines + deleted.automatic.lines + deleted.unidentifiedLines,
          valor_debitado_centavos: deleted.manual.debitCents + deleted.automatic.debitCents,
        }),
        'exclusões 17–24/08: campos divergentes',
      ).toEqual([]);
    });
  });
});
