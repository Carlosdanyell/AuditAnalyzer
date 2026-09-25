/**
 * Ingestion of one or more CFGR700 files (docs/ARQUITETURA.md, section 1; docs/REGRAS_CFGR700.md,
 * sections 1–8): integrity, parameters, shared strings, streamed report rows into the columnar store,
 * row reconciliation, events per operation, the analysis of each file and of the consolidated base,
 * and the invariants of section 11.
 *
 * Runs in the worker, but only depends on Blob/streams, so tests run it directly in Node.
 */
import { createSHA256 } from 'hash-wasm';
import { OPERATION_KEYS, REPORT_COLUMN_ROLES, type AnalyzerConfig, type ReportColumnRole } from '../../config/schema';
import { INVALID_TIME, parseDateTime } from '../../shared/dates';
import type {
  Alert,
  CheckResult,
  EntryIntegrity,
  FileReconciliation,
  OperationCount,
  ParameterPair,
  Reconciliation,
  Stage,
  Summary,
  WorkerEvent,
} from '../../shared/protocol';
import { analyzeScope, buildLogIndex, type ScopeAnalysis } from '../engine/analysis';
import { scopeChecks, type ScopeCheckResults } from '../engine/checks';
import { countEvents, sortByEventKey, OP_UNKNOWN, OP_UPDATE, type EventCounts } from '../engine/events';
import { coverageAlerts } from '../engine/periods';
import { DetailColumns } from '../store/columns';
import { Dictionary, EMPTY_ID } from '../store/dictionary';
import type { InflateMode } from './inflate';
import { checkParameters, normalizeLabel, parseParameterRows } from './parametros';
import { CellKind, SheetParser, type ParsedRow } from './sheetStream';
import { SharedStringsParser } from './sst';
import { parseRelationships, parseWorkbookSheets, resolvePartPath } from './workbook';
import { ZipFormatError, readEntry, readEntryBytes, readZipDirectory, type ZipEntry } from './zip';

export class IngestError extends Error {
  override name = 'IngestError';
  constructor(
    readonly stage: Stage,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export interface IngestInput {
  name: string;
  blob: Blob;
}

export interface IngestOptions {
  inflateMode?: InflateMode;
  now?: () => number;
  progressIntervalMs?: number;
}

export interface IngestionResult {
  reconciliation: Reconciliation;
  summary: Summary;
  /** One analysis per file, plus the consolidated one when there are several files (same order as summary.scopes). */
  analyses: ScopeAnalysis[];
  dictionary: Dictionary;
  details: DetailColumns;
}

type ProgressEvent = Extract<WorkerEvent, { type: 'progress' }>;

/** Emits a progress event at each stage start and at most every `intervalMs` in between. */
class ProgressReporter {
  private current: ProgressEvent | null = null;
  private lastEmit = -Infinity;
  private stageStart = 0;
  readonly timings: { stage: Stage; ms: number }[] = [];

  constructor(
    private readonly post: (e: WorkerEvent) => void,
    private readonly now: () => number,
    private readonly intervalMs: number,
  ) {}

  begin(stage: Stage, fileIndex: number | undefined, total: number, unit: ProgressEvent['unit'], message: string): void {
    this.closeStage();
    this.current = { type: 'progress', stage, done: 0, total, unit, message, ...(fileIndex !== undefined && { fileIndex }) };
    this.stageStart = this.now();
    this.emit();
  }

  update(done: number, rows?: number): void {
    if (!this.current) return;
    this.current.done = done;
    if (rows !== undefined) this.current.rows = rows;
    if (this.now() - this.lastEmit >= this.intervalMs) this.emit();
  }

  /** Records the duration of the current stage. */
  closeStage(): void {
    if (this.current) {
      this.timings.push({ stage: this.current.stage, ms: Math.round(this.now() - this.stageStart) });
      this.current = null;
    }
  }

  private emit(): void {
    if (!this.current) return;
    this.lastEmit = this.now();
    this.post({ ...this.current });
  }
}

interface FileState {
  recon: FileReconciliation;
}

const noop = () => {};

async function sha256(blob: Blob, progress: ProgressReporter): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const reader = (blob.stream() as ReadableStream<Uint8Array>).getReader();
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    hasher.update(r.value);
    done += r.value.length;
    progress.update(done);
  }
  return hasher.digest('hex');
}

function requireIntact(integrity: EntryIntegrity, stage: Stage): EntryIntegrity {
  if (!integrity.ok) {
    throw new IngestError(
      stage,
      `O arquivo está corrompido: o CRC32 ou o tamanho da entrada ${integrity.name} não confere com o diretório do ZIP.`,
      `CRC32 esperado ${integrity.expectedCrc.toString(16)}, obtido ${integrity.actualCrc.toString(16)}; ` +
        `tamanho esperado ${integrity.expectedSize}, obtido ${integrity.actualSize}.`,
    );
  }
  return integrity;
}

interface RawCell {
  kind: number;
  shared: number;
  text: string;
}

async function ingestFile(
  input: IngestInput,
  fileIndex: number,
  config: AnalyzerConfig,
  dict: Dictionary,
  details: DetailColumns,
  progress: ProgressReporter,
  inflateMode: InflateMode,
): Promise<FileState> {
  const { name, blob } = input;
  const entriesChecked: EntryIntegrity[] = [];
  const alerts: Alert[] = [];

  // 1. File check: SHA-256, ZIP directory, workbook structure, integrity of the small entries.
  progress.begin('fileCheck', fileIndex, blob.size, 'bytes', `Conferindo ${name}`);
  const hash = await sha256(blob, progress);
  let entries: ZipEntry[];
  try {
    entries = await readZipDirectory(blob);
  } catch (e) {
    if (e instanceof ZipFormatError) throw new IngestError('fileCheck', `${name}: ${e.message}`);
    throw e;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const readText = async (entryName: string): Promise<string> => {
    const entry = byName.get(entryName);
    if (!entry) throw new IngestError('fileCheck', `${name}: o arquivo não é um .xlsx válido (${entryName} ausente).`);
    const { bytes, integrity } = await readEntryBytes(blob, entry, inflateMode);
    entriesChecked.push(requireIntact(integrity, 'fileCheck'));
    return new TextDecoder().decode(bytes);
  };
  const sheets = parseWorkbookSheets(await readText('xl/workbook.xml'));
  const rels = parseRelationships(await readText('xl/_rels/workbook.xml.rels'));
  const relTarget = new Map(rels.map((r) => [r.id, resolvePartPath(r.target)]));

  const wanted = normalizeLabel(config.workbook.reportSheetContains);
  const reportSheet = sheets.find((s) => normalizeLabel(s.name).includes(wanted));
  if (!reportSheet) {
    throw new IngestError(
      'fileCheck',
      `Aba do relatório ("${config.workbook.reportSheetContains}") não encontrada. Abas do arquivo: ${sheets.map((s) => s.name).join(', ')}.`,
    );
  }
  const paramsSheet = sheets.find((s) => normalizeLabel(s.name) === normalizeLabel(config.workbook.parametersSheet));
  const entryOf = (sheet: { relationshipId: string; name: string }): ZipEntry => {
    const path = relTarget.get(sheet.relationshipId);
    const entry = path ? byName.get(path) : undefined;
    if (!entry) throw new IngestError('fileCheck', `${name}: dados da aba "${sheet.name}" não encontrados no arquivo.`);
    return entry;
  };
  const reportEntry = entryOf(reportSheet);
  const paramsEntry = paramsSheet ? entryOf(paramsSheet) : undefined;
  const sstPath = resolvePartPath(rels.find((r) => r.type.endsWith('/sharedStrings'))?.target ?? 'sharedStrings.xml');
  const sstEntry = byName.get(sstPath);

  const streamedLater = new Set([reportEntry.name, paramsEntry?.name, sstEntry?.name]);
  for (const entry of entries) {
    if (streamedLater.has(entry.name) || entriesChecked.some((c) => c.name === entry.name)) continue;
    entriesChecked.push(requireIntact(await readEntry(blob, entry, noop, { inflateMode }), 'fileCheck'));
  }

  // 2. Parameters sheet (cells resolved after the shared strings are loaded).
  const paramCells: RawCell[][] = [];
  if (paramsEntry) {
    progress.begin('parameters', fileIndex, paramsEntry.uncompressedSize, 'bytes', `Lendo os parâmetros de ${name}`);
    const parser = new SheetParser((_, row) => {
      paramCells.push(Array.from({ length: row.width }, (__, c) => ({ kind: row.kind[c]!, shared: row.sharedIndex[c]!, text: row.text[c]! })));
    }, 4);
    entriesChecked.push(requireIntact(await readEntry(blob, paramsEntry, (c) => parser.push(c), { inflateMode }), 'parameters'));
    parser.finish();
  } else {
    progress.begin('parameters', fileIndex, 0, 'steps', `Aba de parâmetros ausente em ${name}`);
    alerts.push({ level: 'warning', message: `Aba "${config.workbook.parametersSheet}" não encontrada; parâmetros não conferidos.` });
  }

  // 3. Shared strings → global dictionary.
  let remap = new Int32Array(0);
  progress.begin('sharedStrings', fileIndex, sstEntry?.uncompressedSize ?? 0, 'bytes', `Lendo as strings compartilhadas de ${name}`);
  if (sstEntry) {
    const sst = new SharedStringsParser();
    const decoder = new TextDecoder('utf-8');
    const integrity = await readEntry(blob, sstEntry, (c) => sst.push(decoder.decode(c, { stream: true })), {
      inflateMode,
      onBytes: (b) => progress.update(b),
    });
    entriesChecked.push(requireIntact(integrity, 'sharedStrings'));
    sst.push(decoder.decode());
    let strings: string[];
    try {
      strings = sst.finish();
    } catch (e) {
      throw new IngestError('sharedStrings', `${name}: as strings compartilhadas estão incompletas.`, String(e));
    }
    if (sst.declaredUniqueCount !== null && sst.declaredUniqueCount >= 0 && sst.declaredUniqueCount !== strings.length) {
      alerts.push({
        level: 'warning',
        message: `sharedStrings declara ${sst.declaredUniqueCount} strings únicas, mas contém ${strings.length}.`,
      });
    }
    remap = new Int32Array(strings.length);
    for (let i = 0; i < strings.length; i++) remap[i] = dict.intern(strings[i]!);
  }

  const invalid = { dateTime: 0, recno: 0, operation: 0, sharedStringIndex: 0, value: 0 };
  const cellId = (row: { kind: ArrayLike<number>; sharedIndex: ArrayLike<number>; text: ArrayLike<string> }, c: number): number => {
    switch (row.kind[c]) {
      case CellKind.Empty:
        return EMPTY_ID;
      case CellKind.Shared: {
        const idx = row.sharedIndex[c]!;
        if (idx >= 0 && idx < remap.length) return remap[idx]!;
        invalid.sharedStringIndex++;
        return EMPTY_ID;
      }
      default:
        return dict.intern(row.text[c]!);
    }
  };

  const parameters: ParameterPair[] = parseParameterRows(
    paramCells.map((cells) =>
      cells.map((cell) => dict.get(cellId({ kind: [cell.kind], sharedIndex: [cell.shared], text: [cell.text] }, 0))),
    ),
  );

  // 4. Report rows, streamed into the columnar store.
  progress.begin('rows', fileIndex, reportEntry.uncompressedSize, 'bytes', `Lendo as linhas de ${name}`);
  const roles = REPORT_COLUMN_ROLES;
  const column = {} as Record<ReportColumnRole, number>;
  const headerFieldId = dict.intern(config.columns.field);
  const operationCode = new Map<number, number>();
  const operationByLabel = new Map(OPERATION_KEYS.map((key, i) => [config.operations[key], i + 1]));
  const secondsById = new Map<number, number>();
  const otherCounts = { dataType: new Map<number, number>(), status: new Map<number, number>(), protectedType: new Map<number, number>() };

  let headerSeen = false;
  let lastRow = 0;
  let presentRows = 0;
  let repeatedHeaders = 0;
  let emptyRows = 0;
  let missingRows = 0;
  let blankRowsWithContent = 0;
  let detailRows = 0;
  let firstEvent = Infinity;
  let lastEvent = -Infinity;
  let reserved = false;

  const count = (map: Map<number, number>, id: number) => map.set(id, (map.get(id) ?? 0) + 1);

  const onRow = (r: number, row: ParsedRow) => {
    presentRows++;
    if (!headerSeen) {
      const texts = Array.from({ length: row.width }, (_, c) => dict.get(cellId(row, c)).trim());
      const missing = roles.filter((role) => !texts.includes(config.columns[role]));
      if (r !== 1 || missing.length > 0) {
        throw new IngestError(
          'rows',
          `A linha 1 da aba "${reportSheet.name}" não é o cabeçalho esperado do relatório.`,
          `Linha ${r}; colunas não encontradas: ${missing.map((role) => config.columns[role]).join(', ') || '(nenhuma)'}.`,
        );
      }
      for (const role of roles) column[role] = texts.indexOf(config.columns[role]);
      headerSeen = true;
      lastRow = r;
      return;
    }
    if (!reserved && parser.dimension) {
      details.reserve(Math.max(0, parser.dimension.lastRow - r + 1));
      reserved = true;
    }
    if (r <= lastRow) {
      throw new IngestError('rows', `Linhas fora de ordem na aba "${reportSheet.name}" (linha ${r} após a linha ${lastRow}).`);
    }
    missingRows += r - lastRow - 1;
    lastRow = r;

    const field = cellId(row, column.field);
    if (field === EMPTY_ID) {
      emptyRows++;
      for (let c = 0; c < row.width; c++) {
        if (c !== column.field && cellId(row, c) !== EMPTY_ID) {
          blankRowsWithContent++;
          break;
        }
      }
      return;
    }
    if (field === headerFieldId) {
      repeatedHeaders++;
      return;
    }

    detailRows++;
    const opId = cellId(row, column.operation);
    let op = operationCode.get(opId);
    if (op === undefined) {
      op = operationByLabel.get(dict.get(opId).trim()) ?? OP_UNKNOWN;
      operationCode.set(opId, op);
    }
    if (op === OP_UNKNOWN) invalid.operation++;

    const dtId = cellId(row, column.dateTime);
    let seconds = secondsById.get(dtId);
    if (seconds === undefined) {
      seconds = parseDateTime(dict.get(dtId));
      secondsById.set(dtId, seconds);
    }
    if (seconds === INVALID_TIME) invalid.dateTime++;
    else {
      if (seconds < firstEvent) firstEvent = seconds;
      if (seconds > lastEvent) lastEvent = seconds;
    }

    let recno = -1;
    const rc = column.recno;
    const recnoText = row.kind[rc] === CellKind.Number ? row.text[rc]! : dict.get(cellId(row, rc));
    if (/^\s*\d+\s*$/.test(recnoText)) {
      const n = Number(recnoText);
      if (n <= 0x7fffffff) recno = n;
    }
    if (recno < 0) invalid.recno++;

    count(otherCounts.dataType, cellId(row, column.dataType));
    count(otherCounts.status, cellId(row, column.status));
    count(otherCounts.protectedType, cellId(row, column.protectedType));

    details.push({
      source: fileIndex,
      field,
      oldVal: cellId(row, column.oldValue),
      newVal: cellId(row, column.newValue),
      user: cellId(row, column.user),
      op,
      dateTime: seconds,
      recno,
    });
  };

  const parser = new SheetParser(onRow, 16);
  const reportIntegrity = await readEntry(blob, reportEntry, (c) => parser.push(c), {
    inflateMode,
    onBytes: (b) => progress.update(b, presentRows),
  });
  requireIntact(reportIntegrity, 'rows');
  entriesChecked.push(reportIntegrity);
  try {
    parser.finish();
  } catch (e) {
    throw new IngestError('rows', `A aba "${reportSheet.name}" de ${name} está incompleta.`, String(e));
  }
  if (!headerSeen) throw new IngestError('rows', `A aba "${reportSheet.name}" de ${name} não tem linhas (cabeçalho ausente).`);
  progress.update(reportEntry.uncompressedSize, presentRows);

  const dimensionRows = parser.dimension?.lastRow ?? null;
  const totalRows = Math.max(lastRow, dimensionRows ?? 0);
  missingRows += totalRows - lastRow;
  if (dimensionRows !== null && dimensionRows !== lastRow) {
    alerts.push({
      level: 'info',
      message: `A dimensão declarada da aba vai até a linha ${dimensionRows}; a última linha com dados é ${lastRow}.`,
    });
  }
  const blankRows = emptyRows + missingRows;
  const rowsAfterHeader = totalRows - 1;
  const first = Number.isFinite(firstEvent) ? firstEvent : null;
  const last = Number.isFinite(lastEvent) ? lastEvent : null;
  alerts.push(...checkParameters(parameters, config, first, last));

  const valueCounts = (map: Map<number, number>) =>
    [...map].map(([id, n]) => ({ value: dict.get(id), count: n })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));

  progress.closeStage();
  const order = new Map(entries.map((e, i) => [e.name, i]));
  return {
    recon: {
      fileIndex,
      name,
      size: blob.size,
      sha256: hash,
      entries: entriesChecked.sort((a, b) => order.get(a.name)! - order.get(b.name)!),
      parameters,
      alerts,
      rows: {
        sheetName: reportSheet.name,
        dimensionRows,
        totalRows,
        rowsAfterHeader,
        repeatedHeaders,
        blankRows,
        missingRows,
        blankRowsWithContent,
        detailRows,
        balanced: rowsAfterHeader - repeatedHeaders - blankRows === detailRows,
      },
      events: [],
      totalEvents: 0,
      firstEvent: first,
      lastEvent: last,
      invalid,
      otherColumns: [
        { column: config.columns.dataType, values: valueCounts(otherCounts.dataType) },
        { column: config.columns.status, values: valueCounts(otherCounts.status) },
        { column: config.columns.protectedType, values: valueCounts(otherCounts.protectedType) },
      ],
      timings: [],
    },
  };
}

function operationCounts(counts: EventCounts, config: AnalyzerConfig): OperationCount[] {
  const list = OPERATION_KEYS.map((key, i) => ({ operation: config.operations[key], count: counts.byOperation[i + 1]! }));
  if (counts.byOperation[OP_UNKNOWN]! > 0) list.push({ operation: '(operação não reconhecida)', count: counts.byOperation[OP_UNKNOWN]! });
  return list;
}

interface ScopeRun {
  label: string;
  analysis: ScopeAnalysis;
  checks: ScopeCheckResults;
}

function invalidDescription(invalid: FileReconciliation['invalid']): string {
  const parts = [
    [invalid.recno, 'Recno inválido(s)'],
    [invalid.operation, 'operação(ões) não reconhecida(s)'],
    [invalid.dateTime, 'Data Hora inválida(s)'],
    [invalid.sharedStringIndex, 'referência(s) de string inexistente(s)'],
    [invalid.value, 'valor(es) ilegível(is) em CT2_VALOR'],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(', ');
}

function buildChecks(
  files: FileReconciliation[],
  consolidated: Reconciliation['consolidated'],
  counts: EventCounts[],
  all: EventCounts,
  scopes: ScopeRun[],
  config: AnalyzerConfig,
): CheckResult[] {
  const listFiles = (bad: FileReconciliation[]) => bad.map((f) => f.name).join(', ');
  const listScopes = (bad: ScopeRun[]) => bad.map((s) => s.label).join(', ');
  const unbalanced = files.filter((f) => !f.rows.balanced);
  const sums = [...counts, all].every((c) => c.byOperation.reduce((a, b) => a + b, 0) === c.total);
  const corrupted = files.filter((f) => f.entries.some((e) => !e.ok));
  const withInvalid = files.filter((f) => Object.values(f.invalid).some((n) => n > 0));
  const consolidatedInvalid = scopes.length > files.length ? scopes.at(-1)!.analysis.stats.invalidValues : 0;
  const paramAlerts = files.filter((f) => f.alerts.some((a) => a.level === 'warning'));
  const failing = (key: keyof ScopeCheckResults) => scopes.filter((s) => !s.checks[key]);
  const alterations = failing('alterationsReconcile');
  const discarded = failing('discardedBalanceTypeExpected');
  const otherTransitions = scopes.filter((s) => s.analysis.stats.balanceType.expected < s.analysis.stats.balanceType.total);
  const contiguity = failing('baseContiguous');
  const partition = failing('periodsPartition');
  const transition = `${config.balanceType.expectedFrom} → ${config.balanceType.expectedTo}`;
  const readable = withInvalid.length === 0 && consolidatedInvalid === 0;
  return [
    {
      id: 'rows-reconciliation',
      label: 'Reconciliação de linhas',
      severity: 'error',
      passed: unbalanced.length === 0,
      message:
        unbalanced.length === 0
          ? 'Linhas após o 1º cabeçalho − cabeçalhos repetidos − linhas em branco = linhas de detalhe, em todos os arquivos.'
          : `Reconciliação de linhas não fecha em: ${listFiles(unbalanced)}.`,
    },
    {
      id: 'events-by-operation',
      label: 'Eventos por operação',
      severity: 'error',
      passed: sums,
      message: sums
        ? 'A soma dos eventos por operação é igual ao número de eventos distintos, por arquivo e no total.'
        : 'A soma dos eventos por operação difere do número de eventos distintos.',
    },
    {
      id: 'alteration-classification',
      label: 'Classificação das alterações',
      severity: 'error',
      passed: alterations.length === 0,
      message:
        alterations.length === 0
          ? 'Descartadas (efetivação e carimbo) + efetivas = eventos de Alteração, por arquivo e no total.'
          : `A classificação das alterações não fecha com os eventos de Alteração em: ${listScopes(alterations)}.`,
    },
    {
      id: 'balance-type',
      label: 'Efetivações do tipo de saldo',
      severity: 'error',
      passed: discarded.length === 0,
      message:
        discarded.length === 0
          ? `Todo evento descartado como efetivação do tipo de saldo tem ${config.balanceType.field} ${transition}.`
          : `Evento descartado como efetivação com transição diferente de ${transition} em: ${listScopes(discarded)}.`,
    },
    {
      id: 'balance-type-other',
      label: 'Outras transições do tipo de saldo',
      severity: 'warning',
      passed: otherTransitions.length === 0,
      message:
        otherTransitions.length === 0
          ? `Nenhuma transição de ${config.balanceType.field} diferente de ${transition}.`
          : otherTransitions
              .map((s) => {
                const b = s.analysis.stats.balanceType;
                return `${s.label}: ${b.total - b.expected} de ${b.total} transição(ões) de ${config.balanceType.field} diferente(s) de ${transition}, classificada(s) como alteração efetiva`;
              })
              .join('; ') + '.',
    },
    {
      id: 'base-contiguity',
      label: 'Documentos contíguos na base',
      severity: 'error',
      passed: contiguity.length === 0,
      message:
        contiguity.length === 0
          ? 'As linhas de cada documento estão contíguas na base de linhas.'
          : `Documento com linhas não contíguas na base em: ${listScopes(contiguity)}.`,
    },
    {
      id: 'period-partition',
      label: 'Soma dos períodos',
      severity: 'error',
      passed: partition.length === 0,
      message:
        partition.length === 0
          ? 'A soma dos períodos diários é igual ao log completo, em todas as categorias.'
          : `A soma dos períodos difere do log completo em: ${listScopes(partition)}.`,
    },
    {
      id: 'zip-integrity',
      label: 'Integridade do arquivo',
      severity: 'error',
      passed: corrupted.length === 0,
      message:
        corrupted.length === 0
          ? 'CRC32 e tamanho de todas as entradas do ZIP conferem com o diretório central.'
          : `Entradas com CRC32 ou tamanho divergente em: ${listFiles(corrupted)}.`,
    },
    {
      id: 'data-quality',
      label: 'Valores legíveis',
      severity: 'error',
      passed: readable,
      message: readable
        ? 'Recno, Operacao e Data Hora válidos em todas as linhas de detalhe; CT2_VALOR legível em todos os registros identificados.'
        : [
            ...withInvalid.map((f) => `${f.name}: ${invalidDescription(f.invalid)}`),
            ...(consolidatedInvalid > 0 ? [`Consolidado: ${consolidatedInvalid} valor(es) ilegível(is) em CT2_VALOR`] : []),
          ].join('; ') + '.',
    },
    {
      id: 'parameters',
      label: 'Parâmetros do relatório',
      severity: 'warning',
      passed: paramAlerts.length === 0,
      message:
        paramAlerts.length === 0
          ? 'Parâmetros do relatório compatíveis com a configuração.'
          : `Parâmetros com alerta em: ${listFiles(paramAlerts)}.`,
    },
    {
      id: 'coverage',
      label: 'Cobertura entre extrações',
      severity: 'warning',
      passed: consolidated.alerts.length === 0,
      message:
        consolidated.alerts.length === 0
          ? files.length > 1
            ? 'Intervalos das extrações sem sobreposição nem dias úteis descobertos.'
            : 'Um único arquivo carregado.'
          : consolidated.alerts.map((a) => a.message).join(' '),
    },
  ];
}

export async function runIngestion(
  inputs: IngestInput[],
  config: AnalyzerConfig,
  post: (e: WorkerEvent) => void,
  options: IngestOptions = {},
): Promise<IngestionResult> {
  if (inputs.length === 0) throw new IngestError('fileCheck', 'Nenhum arquivo selecionado.');
  if (inputs.length > 255) throw new IngestError('fileCheck', 'No máximo 255 arquivos por análise.');
  const now = options.now ?? (() => performance.now());
  const started = now();
  const progress = new ProgressReporter(post, now, options.progressIntervalMs ?? 100);
  const dict = new Dictionary();
  const details = new DetailColumns(1024);

  const files: FileReconciliation[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const timingsBefore = progress.timings.length;
    const { recon } = await ingestFile(inputs[i]!, i, config, dict, details, progress, options.inflateMode ?? 'auto');
    recon.timings = progress.timings.slice(timingsBefore);
    files.push(recon);
  }

  progress.begin('reconciliation', undefined, files.length, 'steps', 'Reconciliando as linhas');
  details.trim();
  const detailRows = files.reduce((n, f) => n + f.rows.detailRows, 0);

  progress.begin('events', undefined, details.length, 'rows', 'Agrupando eventos');
  const order = sortByEventKey(details);
  const { perSource, consolidated: all } = countEvents(details, files.length, order);
  files.forEach((f, i) => {
    f.events = operationCounts(perSource[i]!, config);
    f.totalEvents = perSource[i]!.total;
  });
  const firsts = files.map((f) => f.firstEvent).filter((t): t is number => t !== null);
  const lasts = files.map((f) => f.lastEvent).filter((t): t is number => t !== null);
  const consolidated: Reconciliation['consolidated'] = {
    detailRows,
    events: operationCounts(all, config),
    totalEvents: all.total,
    firstEvent: firsts.length ? Math.min(...firsts) : null,
    lastEvent: lasts.length ? Math.max(...lasts) : null,
    alerts: coverageAlerts(files.map((f) => ({ name: f.name, first: f.firstEvent, last: f.lastEvent }))),
  };

  const scopeDefs = files.map((f, i) => ({ label: f.name, sources: [i], updateEvents: perSource[i]!.byOperation[OP_UPDATE]! }));
  if (files.length > 1) {
    scopeDefs.push({ label: 'Consolidado', sources: files.map((_, i) => i), updateEvents: all.byOperation[OP_UPDATE]! });
  }
  progress.begin('documents', undefined, scopeDefs.length, 'steps', 'Montando registros e documentos');
  const log = buildLogIndex(details, dict, config, files.length, order);
  const scopes: ScopeRun[] = scopeDefs.map((def, k) => {
    const analysis = analyzeScope(log, def.sources);
    progress.update(k + 1);
    return { label: def.label, analysis, checks: scopeChecks(analysis, def.updateEvents) };
  });
  files.forEach((f, i) => {
    f.invalid.value = scopes[i]!.analysis.stats.invalidValues;
  });

  progress.begin('checks', undefined, 1, 'steps', 'Verificando os invariantes');
  const checks = buildChecks(files, consolidated, perSource, all, scopes, config);
  progress.closeStage();

  return {
    reconciliation: { files, consolidated, checks, totalMs: Math.round(now() - started) },
    summary: { scopes: scopes.map((s) => ({ label: s.label, sources: s.analysis.sources, stats: s.analysis.stats })) },
    analyses: scopes.map((s) => s.analysis),
    dictionary: dict,
    details,
  };
}
