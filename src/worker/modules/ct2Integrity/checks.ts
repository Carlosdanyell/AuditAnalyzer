/**
 * Invariants of the analysis (docs/REGRAS_CT2_INTEGRIDADE.md, section 8): CI-3 (debit and credit equal at every
 * level), CI-5 (exceptions = marks), CI-6 (blocks = distinct keys, counted without the order), and the alerts CI-9
 * (optional columns) and CI-10 (period). Each one recounts by a path of its own.
 */
import { CT2_TESTS, type Ct2Field, type Ct2IntegrityConfig, type Ct2TestCode } from '../../../config/ct2IntegritySchema';
import { INVALID_TIME, formatDay } from '../../../shared/dates';
import { formatCents } from '../../../shared/format';
import { CT2_TEST_INFO, type Ct2RunParameters, type Ct2TestResult } from '../../../shared/modules/ct2Integrity';
import type { CheckResult } from '../../../shared/protocol';
import type { ChunkedArray } from '../../store/chunked';
import { rowSides, type Ct2Blocks } from './aggregate';
import { BIT, marksOf, type Ct2Marks } from './marks';
import type { Ct2Ingested } from './ingest';
import { keyLevels } from './order';
import { distinctTuples } from './tuples';

export interface CheckInput {
  base: Ct2Ingested;
  blocks: Ct2Blocks;
  marks: Ct2Marks;
  exceptions: { count: number; test: ChunkedArray<Uint8Array> };
  isException: (code: Ct2TestCode) => boolean;
  present: ReadonlySet<Ct2Field>;
  state: (code: Ct2TestCode) => Ct2TestResult['state'];
  parameters: Ct2RunParameters;
  config: Ct2IntegrityConfig;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sum = (values: Float64Array) => values.reduce((s, v) => s + v, 0);

/** CI-3: Σ debit and Σ credit of the rows (in reading order) = documents = batches = days = segments = totals. */
function totalsCheck({ base, blocks }: CheckInput): CheckResult {
  let debit = 0;
  let credit = 0;
  for (let i = 0; i < base.store.rows; i++) {
    const sides = rowSides(base.store, i);
    debit += sides.debit;
    credit += sides.credit;
  }
  const levels: [string, number, number][] = [
    ['base ordenada', sum(blocks.debit), sum(blocks.credit)],
    ['documentos', sum(blocks.documentDebit), sum(blocks.documentCredit)],
    ['lotes', sum(blocks.batchDebit), sum(blocks.batchCredit)],
    ['dias', sum(blocks.dayDebit), sum(blocks.dayCredit)],
    ['segmentos', sum(blocks.segmentDebit), sum(blocks.segmentCredit)],
    ['totais da leitura', base.summary.segments.reduce((s, x) => s + x.debitCents, 0), base.summary.segments.reduce((s, x) => s + x.creditCents, 0)],
  ];
  const wrong = levels.filter(([, d, c]) => d !== debit || c !== credit);
  return {
    id: 'ct2-totals',
    label: 'Débito e crédito iguais em todos os níveis',
    severity: 'error',
    passed: wrong.length === 0,
    message:
      wrong.length === 0
        ? `Σ débito ${formatCents(debit)} e Σ crédito ${formatCents(credit)} das linhas são os mesmos nos documentos, lotes, dias, segmentos e nos totais da leitura.`
        : `Somas diferentes das linhas (débito ${formatCents(debit)}, crédito ${formatCents(credit)}): ${wrong
            .map(([name, d, c]) => `${name} com débito ${formatCents(d)} e crédito ${formatCents(c)}`)
            .join('; ')}.`,
  };
}

/** CI-5: for each test that is an exception, the occurrences marked = the items of the list. */
function exceptionsCheck({ marks, exceptions, isException }: CheckInput): CheckResult {
  const listed = new Array<number>(CT2_TESTS.length).fill(0);
  for (let k = 0; k < exceptions.count; k++) listed[exceptions.test.get(k)]!++;
  const wrong: string[] = [];
  for (const [index, code] of CT2_TESTS.entries()) {
    const level = marksOf(marks, CT2_TEST_INFO[code].level);
    let marked = 0;
    if (level && isException(code)) {
      for (let k = 0; k < level.length; k++) if (level[k]! & BIT[code]) marked++;
    }
    if (marked !== listed[index]) wrong.push(`${code}: ${marked} marcadas e ${listed[index]} listadas`);
  }
  return {
    id: 'ct2-exceptions',
    label: 'Exceções conferidas com as marcas',
    severity: 'error',
    passed: wrong.length === 0,
    message:
      wrong.length === 0
        ? `${plural(exceptions.count, 'exceção listada', 'exceções listadas')}: em cada teste de Erro ou Alerta, as ocorrências marcadas são as da lista.`
        : `A lista de exceções não confere com as marcas: ${wrong.join('; ')}.`,
  };
}

/** CI-6: documents, batches and days = distinct keys (segment + key), counted with a hash table, without the order. */
function countsCheck({ base, blocks, config }: CheckInput): CheckResult {
  const levels = keyLevels(config);
  const rows = base.order.length;
  const distinct = (to: number) => distinctTuples(base.keys, 0, to, rows).count;
  const counts: [string, number, number, number][] = [
    ['documentos', blocks.documents, distinct(levels.document), base.summary.documents],
    ['lotes', blocks.batches, distinct(levels.batch), base.summary.batches],
    ['dias', blocks.days, distinct(levels.day), base.summary.days],
    ['segmentos', blocks.segments, distinct(levels.segment), base.summary.segments.length],
  ];
  const wrong = counts.filter(([, a, b, c]) => a !== b || a !== c);
  return {
    id: 'ct2-counts',
    label: 'Contagens de documentos, lotes e dias',
    severity: 'error',
    passed: wrong.length === 0,
    message:
      wrong.length === 0
        ? `${plural(blocks.documents, 'documento', 'documentos')}, ${plural(blocks.batches, 'lote', 'lotes')} e ${plural(blocks.days, 'dia', 'dias')}: cada um é uma chave distinta (segmento + chave), contada também sem a ordem da base.`
        : `Contagens diferentes: ${wrong.map(([name, a, b, c]) => `${name}: ${a} blocos, ${b} chaves distintas, ${c} na leitura`).join('; ')}.`,
  };
}

/** What a missing optional column does to the tests (CI-9): absent from every file, or from some of them. */
const EFFECT: Partial<Record<Ct2Field, { all: string; some: string }>> = {
  amountCurrency1: { all: 'I4 desligado', some: 'I4 não testa essas linhas' },
  ctkSequence: { all: 'P3 desligado', some: 'P3 não considera essas linhas' },
  manual: { all: 'P2 desligado', some: 'P2 conta essas linhas como não identificadas' },
  routine: { all: 'P1 sem a rotina', some: 'P1 com a rotina vazia nessas linhas' },
  standardEntry: { all: 'P1 sem o lançamento padrão', some: 'P1 com o lançamento padrão vazio nessas linhas' },
  companyOrigin: { all: 'E1 compara as linhas sem ela', some: 'E1 compara essas linhas com ela vazia' },
  branchOrigin: { all: 'E1 compara as linhas sem ela', some: 'E1 compara essas linhas com ela vazia' },
  origin: { all: 'nenhum teste usa', some: 'nenhum teste usa' },
};

function optionalCheck({ base, config, present }: CheckInput): CheckResult {
  const files = base.reconciliation.files;
  const all: string[] = [];
  const some: string[] = [];
  for (const [field, effect] of Object.entries(EFFECT) as [Ct2Field, { all: string; some: string }][]) {
    if (config.columns[field].required) continue;
    const title = config.columns[field].title;
    const lacking = files.filter((f) => !f.header.mapped.some((m) => m.field === field)).map((f) => f.name);
    if (lacking.length === 0) continue;
    if (!present.has(field)) all.push(`${title} (${effect.all})`);
    else some.push(`${title} em ${lacking.join(', ')} (${effect.some})`);
  }
  const parts = [
    ...(all.length > 0 ? [`Colunas opcionais ausentes: ${all.join(', ')}.`] : []),
    ...(some.length > 0 ? [`Colunas opcionais ausentes em parte dos arquivos: ${some.join(', ')}.`] : []),
  ];
  return {
    id: 'ct2-optional',
    label: 'Colunas opcionais',
    severity: 'warning',
    passed: parts.length === 0,
    message: parts.length === 0 ? 'Todas as colunas opcionais estão em todos os arquivos.' : parts.join(' '),
  };
}

/** CI-10: dates read outside the period of the run (the lines of E5), counted over the rows in reading order. */
function periodCheck({ base, parameters, state }: CheckInput): CheckResult {
  const { periodStart: start, periodEnd: end } = parameters;
  const result = (passed: boolean, message: string): CheckResult => ({ id: 'ct2-period', label: 'Período da análise', severity: 'warning', passed, message });
  if (start === null || end === null) return result(true, 'Nenhuma data válida foi lida: não há período para conferir.');
  let outside = 0;
  for (let i = 0; i < base.store.rows; i++) {
    const day = base.store.day.get(i);
    if (day !== INVALID_TIME && (day < start || day > end)) outside++;
  }
  const period = `${formatDay(start)} a ${formatDay(end)}`;
  if (outside === 0) return result(true, `O período da análise (${period}) cobre todas as datas lidas.`);
  const e5 = state('E5') === 'on' ? 'apontadas no teste E5' : 'o teste E5 está desligado';
  return result(false, `O período da análise (${period}) não cobre todas as datas lidas: ${plural(outside, 'linha', 'linhas')} fora dele (${e5}).`);
}

export function analysisChecks(input: CheckInput): CheckResult[] {
  return [totalsCheck(input), exceptionsCheck(input), countsCheck(input), optionalCheck(input), periodCheck(input)];
}
