/**
 * The real chart of accounts (docs/REGRAS_PLANO_DE_CONTAS.md, sections 9.2 to 9.4), on the developer's machine only.
 * The CSV comes from the variable PLANO_CSV_REAL or from local/plano-de-contas/ (named in the golden file); the reference
 * workbook from PLANO_XLSX_REF or the golden file. Skipped without the CSV. Failures name only the diverging fields and
 * cells, never the real values, so the output can be shared. Format of local/plano-de-contas/golden-plano-de-contas.json:
 *
 *   {
 *     "csv": "plano.csv",                     // in local/plano-de-contas/ (PLANO_CSV_REAL takes precedence)
 *     "referencia": "plano-referencia.xlsx",  // optional; equivalence of 9.4 (PLANO_XLSX_REF takes precedence)
 *     "periodo": null,                        // MM.AAAA of the export compared, or null
 *     "contagens": {                          // 9.2; every key optional
 *       "ct1": 0, "cvd": 0, "sinteticas": 0, "analiticas": 0, "devedoras": 0, "credoras": 0, "ativas": 0, "bloqueadas": 0,
 *       "niveis": { "1": 0 }, "niveisPorTipo": { "4": { "sinteticas": 0, "analiticas": 0 } }, "sped": { "01": 0 },
 *       "bloqueioInicio": 0, "bloqueioFim": 0, "complementar": 0,
 *       "alertas": { "A02": 0 }, "alertasContas": { "A04": ["conta"] }
 *     },
 *     "amostras": [                           // 9.3; every key but "conta" optional
 *       { "conta": "x", "nivel": 1, "tipo": "Sintética", "preenchimento": "B4C3DE", "agrupamento": 0, "recuo": 0,
 *         "colunas": { "G": "texto", "R": "dd/mm/aaaa", "S": null }, "situacaoVermelha": true, "descricaoContem": "–" }
 *     ]
 *   }
 */
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chartDefaultConfig } from '../../src/config/chartOfAccountsSchema';
import { parseDate } from '../../src/shared/dates';
import { ingestChart } from '../../src/worker/modules/chartOfAccounts/ingest';
import { buildChartWorkbook } from '../../src/worker/modules/chartOfAccounts/workbook';
import { compareChartSheets } from '../support/chartEquivalence';
import { readWorkbookData } from '../support/xlsxStyles';
import { localDir } from './realFiles';

interface Sample {
  conta: string;
  nivel?: number;
  tipo?: string;
  preenchimento?: string | null;
  agrupamento?: number;
  recuo?: number;
  colunas?: Record<string, string | number | null>;
  situacaoVermelha?: boolean;
  descricaoContem?: string;
}

interface Golden {
  csv?: string;
  referencia?: string;
  periodo?: string | null;
  contagens?: {
    ct1?: number;
    cvd?: number;
    sinteticas?: number;
    analiticas?: number;
    devedoras?: number;
    credoras?: number;
    ativas?: number;
    bloqueadas?: number;
    niveis?: Record<string, number>;
    niveisPorTipo?: Record<string, { sinteticas?: number; analiticas?: number }>;
    sped?: Record<string, number>;
    bloqueioInicio?: number;
    bloqueioFim?: number;
    complementar?: number;
    alertas?: Record<string, number>;
    alertasContas?: Record<string, string[]>;
  };
  amostras?: Sample[];
}

const dir = join(localDir, 'plano-de-contas');
const goldenPath = join(dir, 'golden-plano-de-contas.json');
const golden: Golden | null = existsSync(goldenPath) ? (JSON.parse(readFileSync(goldenPath, 'utf8')) as Golden) : null;
const csvPath = process.env.PLANO_CSV_REAL ?? (golden?.csv ? join(dir, golden.csv) : null);
const refPath = process.env.PLANO_XLSX_REF ?? (golden?.referencia ? join(dir, golden.referencia) : null);
const hasCsv = csvPath !== null && existsSync(csvPath);
const hasRef = hasCsv && refPath !== null && existsSync(refPath);

async function run() {
  const blob = await openAsBlob(csvPath!);
  const state = await ingestChart([{ name: basename(csvPath!), blob }], chartDefaultConfig(), () => {});
  if (!state.rows) throw new Error(`Erros bloqueantes no arquivo real: ${state.reconciliation.checks.filter((c) => !c.passed && c.severity === 'error').map((c) => c.id).join(', ')}`);
  const out = await buildChartWorkbook(state.rows, { sourceName: state.sourceName, period: golden?.periodo ?? null });
  return { state, workbook: readWorkbookData(new Uint8Array(await out.blob.arrayBuffer())) };
}

describe.skipIf(!hasCsv)('real chart of accounts', async () => {
  const { state, workbook } = hasCsv ? await run() : ({} as Awaited<ReturnType<typeof run>>);

  it.skipIf(!golden?.contagens)('matches the control figures of the golden file (9.2)', () => {
    const c = golden!.contagens!;
    const s = state.summary;
    const issueCount = (code: string) => state.reconciliation.issues.find((i) => i.code === code)?.count ?? null;
    const diffs: string[] = [];
    const check = (key: string, expected: number | undefined, actual: number | undefined) => {
      if (expected !== undefined && expected !== actual) diffs.push(key);
    };
    check('ct1', c.ct1, s.accounts);
    check('cvd', c.cvd, s.cvdRecords);
    check('sinteticas', c.sinteticas, s.synthetic);
    check('analiticas', c.analiticas, s.analytic);
    check('devedoras', c.devedoras, s.debit);
    check('credoras', c.credoras, s.credit);
    check('ativas', c.ativas, s.active);
    check('bloqueadas', c.bloqueadas, s.blocked);
    check('bloqueioInicio', c.bloqueioInicio, s.withBlockStart);
    check('bloqueioFim', c.bloqueioFim, s.withBlockEnd);
    check('complementar', c.complementar, s.withComplement);
    for (const [level, n] of Object.entries(c.niveis ?? {})) check(`niveis.${level}`, n, s.levels.find((l) => l.level === Number(level))?.total ?? 0);
    for (const [level, n] of Object.entries(c.niveisPorTipo ?? {})) {
      const l = s.levels.find((x) => x.level === Number(level));
      check(`niveisPorTipo.${level}.sinteticas`, n.sinteticas, l?.synthetic ?? 0);
      check(`niveisPorTipo.${level}.analiticas`, n.analiticas, l?.analytic ?? 0);
    }
    for (const [code, n] of Object.entries(c.sped ?? {})) check(`sped.${code}`, n, s.sped.find((x) => x.code === code)?.count ?? 0);
    for (const [code, n] of Object.entries(c.alertas ?? {})) check(`alertas.${code}`, n, issueCount(code) ?? undefined);
    for (const [code, accounts] of Object.entries(c.alertasContas ?? {})) {
      const found = (state.reconciliation.issues.find((i) => i.code === code)?.occurrences ?? []).flatMap((o) => o.accounts.slice(0, 1));
      if (JSON.stringify([...found].sort()) !== JSON.stringify([...accounts].sort())) diffs.push(`alertasContas.${code}`);
    }
    expect(diffs, 'campos divergentes (valores omitidos)').toEqual([]);
    expect(s.blocking, 'erros bloqueantes').toBe(0);
  });

  it.skipIf(!golden?.amostras?.length)('checks the sample rows of the workbook (9.3)', () => {
    const sheet = workbook.sheets[0]!;
    const rowOfAccount = new Map<string, number>();
    for (let r = 5; r <= sheet.maxRow; r++) {
      const v = sheet.cells.get(`A${r}`)?.value;
      if (typeof v === 'string' && !rowOfAccount.has(v)) rowOfAccount.set(v, r);
    }
    const diffs: string[] = [];
    for (const sample of golden!.amostras!) {
      const r = rowOfAccount.get(sample.conta);
      const tag = `amostra ${golden!.amostras!.indexOf(sample) + 1}`;
      if (r === undefined) {
        diffs.push(`${tag}: conta ausente`);
        continue;
      }
      const cell = (l: string) => sheet.cells.get(`${l}${r}`);
      if (sample.nivel !== undefined && cell('C')?.value !== sample.nivel) diffs.push(`${tag}: nível`);
      if (sample.tipo !== undefined && cell('D')?.value !== sample.tipo) diffs.push(`${tag}: tipo`);
      if (sample.preenchimento !== undefined && 'ABCDEFGHIJKLMNOPQRSTUV'.split('').some((l) => (cell(l)?.style.fill ?? null) !== sample.preenchimento)) diffs.push(`${tag}: preenchimento`);
      if (sample.agrupamento !== undefined && (sheet.rows.get(r)?.outlineLevel ?? 0) !== sample.agrupamento) diffs.push(`${tag}: agrupamento`);
      if (sample.recuo !== undefined && (cell('B')?.style.indent ?? 0) !== sample.recuo) diffs.push(`${tag}: recuo`);
      if (sample.situacaoVermelha !== undefined && (cell('I')?.style.color === 'C00000') !== sample.situacaoVermelha) diffs.push(`${tag}: cor da situação`);
      if (sample.descricaoContem !== undefined && !String(cell('B')?.value ?? '').includes(sample.descricaoContem)) diffs.push(`${tag}: descrição`);
      for (const [col, expected] of Object.entries(sample.colunas ?? {})) {
        const actual = cell(col)?.value ?? null;
        const day = typeof expected === 'string' ? parseDate(expected) : NaN;
        // A date "dd/mm/aaaa" is compared with the serial of the cell (day number + 36526).
        const want = typeof expected === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(expected) ? day + 36526 : expected;
        if (actual !== want) diffs.push(`${tag}: coluna ${col}`);
      }
    }
    expect(diffs, 'amostras divergentes (valores omitidos)').toEqual([]);
  });

  it.skipIf(!hasRef)('is equivalent to the reference workbook, cell by cell (9.4)', async () => {
    const reference = readWorkbookData(new Uint8Array(readFileSync(refPath!)));
    const report = compareChartSheets(workbook, reference);
    expect(report.total, JSON.stringify({ divergencias: report.counts, porColuna: report.byColumn, exemplos: report.examples }, null, 1)).toBe(0);
  });
});
