/**
 * Ingestion of the chart of accounts (docs/REGRAS_PLANO_DE_CONTAS.md, sections 3, 4, 5 and 7) in four stages with
 * progress: file check (SHA-256 and the strict UTF-8 decoding, in one pass), reading (decoding with the encoding found,
 * tokenizer and tables, chunk by chunk), validation (E01–E07, A01–A09) and transformation (the rows of the workbook and
 * the summary of the screen). Only one .csv per analysis. The rows are kept only when nothing blocks; nothing is stored
 * outside the memory of the worker.
 */
import { createSHA256 } from 'hash-wasm';
import type { ChartConfig } from '../../../config/chartOfAccountsSchema';
import { formatInteger } from '../../../shared/format';
import {
  CHART_MAX_OCCURRENCES,
  type ChartFileCard,
  type ChartIssue,
  type ChartReconciliation,
  type ChartSummary,
} from '../../../shared/modules/chartOfAccounts';
import type { Alert, CheckResult, WorkerEvent } from '../../../shared/protocol';
import { IngestError } from '../../ingest/errors';
import type { IngestInput, IngestOptions } from '../../ingest/pipeline';
import { ProgressReporter } from '../../ingest/progress';
import { CHART_MAX_OUTLINE } from './layout';
import { Utf8Check, parseChartBlob, type ChartParsed, type IgnoredReason } from './parse';
import { chartSummary, transformChart, type PlanRow } from './transform';
import { validateChart } from './validate';

export interface ChartIngested {
  reconciliation: ChartReconciliation;
  summary: ChartSummary;
  /** The rows of the workbook; null when a blocking validation failed (the workbook is not generated). */
  rows: PlanRow[] | null;
  sourceName: string;
}

const n = formatInteger;

/** Lines listed in a message of the reading (the count is always complete). */
const LISTED_LINES = 20;

function lineList(lines: readonly number[]): string {
  const shown = lines.slice(0, LISTED_LINES).join(', ');
  return lines.length > LISTED_LINES ? `${shown}… (mais ${n(lines.length - LISTED_LINES)})` : shown;
}

/** The check of the board for a validation: passed without occurrences; otherwise the count and the first ones. */
function checkOf(issue: ChartIssue, parsed: ChartParsed): CheckResult {
  const id = issue.code;
  const label = `${issue.code} · ${issue.label}`;
  if (issue.count === 0) {
    const message =
      id === 'E01' && parsed.ct1Header
        ? `Cabeçalho da CT1 na linha ${parsed.ct1Header.line}, com ${n(parsed.ct1Header.columns)} colunas.`
        : id === 'A01' && parsed.cvdHeader
          ? `Cabeçalho da CVD na linha ${parsed.cvdHeader.line}, com ${n(parsed.cvdHeader.columns)} colunas.`
          : 'Nenhuma ocorrência.';
    return { id, label, severity: issue.severity, passed: true, message };
  }
  const first = issue.occurrences.slice(0, 3).map((o) => (o.line !== null ? `linha ${o.line}: ${o.text}` : o.text));
  const more = issue.count > first.length ? ` (e mais ${n(issue.count - first.length)})` : '';
  return { id, label, severity: issue.severity, passed: false, message: `${n(issue.count)} ocorrência(s). ${first.join(' · ')}${more}` };
}

const IGNORED_TEXT: Record<IgnoredReason, string> = {
  unknownType: 'com tipo de registro desconhecido na primeira coluna (nem 0, 1 ou 2)',
  beforeHeader: 'de dados antes do cabeçalho da sua tabela',
  repeatedHeader: 'com um segundo cabeçalho da mesma tabela',
};

/** What the reading noticed beyond the validations of section 4 (never blocking). */
function readingAlerts(parsed: ChartParsed, deepest: number): Alert[] {
  const alerts: Alert[] = [];
  if (parsed.controlTables === null) alerts.push({ level: 'info', message: 'O arquivo não tem a linha de controle (0;CT1;CVD); as tabelas foram achadas pelos cabeçalhos.' });
  for (const reason of ['unknownType', 'beforeHeader', 'repeatedHeader'] as const) {
    const lines = parsed.ignored.filter((i) => i.reason === reason).map((i) => i.line);
    if (lines.length > 0) alerts.push({ level: 'warning', message: `${n(lines.length)} linha(s) ${IGNORED_TEXT[reason]} ficaram de fora: ${lineList(lines)}.` });
  }
  for (const table of ['CT1', 'CVD'] as const) {
    const lines = parsed.widthMismatch.filter((w) => w.table === table).map((w) => w.line);
    if (lines.length > 0) {
      alerts.push({
        level: 'warning',
        message: `${n(lines.length)} registro(s) da ${table} com número de campos diferente do cabeçalho; os campos foram lidos pela posição do cabeçalho: linhas ${lineList(lines)}.`,
      });
    }
  }
  if (deepest - 1 > CHART_MAX_OUTLINE) {
    alerts.push({ level: 'warning', message: `A hierarquia chega ao nível ${deepest}; o Excel agrupa até 7 níveis, e as contas abaixo do nível 8 ficam no agrupamento 7.` });
  }
  return alerts;
}

export async function ingestChart(inputs: IngestInput[], config: ChartConfig, post: (e: WorkerEvent) => void, options: IngestOptions = {}): Promise<ChartIngested> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const progress = new ProgressReporter(post, now, options.progressIntervalMs ?? 100);
  if (inputs.length !== 1) throw new IngestError('fileCheck', `Carregue um único arquivo .csv do plano de contas (foram ${n(inputs.length)}).`);
  const input = inputs[0]!;
  if (!input.name.toLowerCase().endsWith('.csv')) {
    throw new IngestError('fileCheck', `${input.name}: o plano de contas é lido do CSV exportado do Protheus (extensão .csv).`);
  }

  // 1. File check: SHA-256 and whether the bytes are UTF-8, in one pass.
  progress.begin('fileCheck', 0, input.blob.size, 'bytes', `Conferindo ${input.name}`);
  const hasher = await createSHA256();
  hasher.init();
  const utf8 = new Utf8Check();
  const reader = (input.blob.stream() as ReadableStream<Uint8Array>).getReader();
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    hasher.update(r.value);
    utf8.push(r.value);
    done += r.value.length;
    progress.update(done);
  }
  const sha256 = hasher.digest('hex');
  const encoding = utf8.finish();

  // 2. Reading: the tables of the file, mapped by the names of the headers.
  progress.begin('rows', 0, input.blob.size, 'bytes', `Lendo ${input.name}`);
  let parsed: ChartParsed;
  try {
    parsed = await parseChartBlob(input.blob, encoding, (read) => progress.update(read));
  } catch (e) {
    throw new IngestError('rows', `Não foi possível ler ${input.name}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Validation.
  progress.begin('checks', undefined, 1, 'steps', 'Validando o plano de contas');
  const validation = validateChart(parsed, config);
  progress.update(1);

  // 4. Transformation: the rows of the workbook and the summary.
  progress.begin('transform', undefined, 1, 'steps', 'Montando as linhas da planilha');
  const rows = transformChart(parsed, validation, config);
  const summary = chartSummary(rows, parsed, validation, config);
  progress.update(1);
  progress.closeStage();

  const file: ChartFileCard = {
    name: input.name,
    size: input.blob.size,
    sha256,
    encoding: parsed.encoding,
    lines: parsed.lines,
    blankLines: parsed.blankLines,
    controlTables: parsed.controlTables ?? [],
    ct1HeaderLine: parsed.ct1Header?.line ?? null,
    cvdHeaderLine: parsed.cvdHeader?.line ?? null,
    ct1Columns: parsed.ct1Header?.columns ?? 0,
    cvdColumns: parsed.cvdHeader?.columns ?? 0,
    ct1Records: parsed.ct1.length,
    cvdRecords: parsed.cvd.length,
    ignoredLines: parsed.ignored.length,
  };
  const deepest = rows.reduce((max, r) => Math.max(max, r.level ?? 1), 1);
  const reconciliation: ChartReconciliation = {
    module: 'chartOfAccounts',
    file,
    checks: validation.issues.map((i) => checkOf(i, parsed)),
    issues: validation.issues.map((i) => ({ ...i, occurrences: i.occurrences.slice(0, CHART_MAX_OCCURRENCES) })),
    alerts: readingAlerts(parsed, deepest),
    totalMs: Math.round(now() - started),
  };
  return { reconciliation, summary, rows: validation.blocking === 0 ? rows : null, sourceName: input.name };
}
