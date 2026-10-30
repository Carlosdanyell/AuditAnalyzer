/**
 * Reading of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-4 and 8): each file streamed through
 * readSheet, its header found by title, its detail rows converted and stored in reading order; then the Base order,
 * the reading invariants CI-1, CI-2 and CI-4 and the totals of each segment. Nothing here is analysis yet (Phase 10).
 */
import { CODE_FIELDS, CT2_FIELDS, type Ct2Field, type Ct2IntegrityConfig } from '../../../config/ct2IntegritySchema';
import { columnLabel, findHeaderRow, type HeaderMatch } from '../../../modules/ct2Integrity/header';
import { INVALID_TIME, dayFromExcelSerial, parseDate } from '../../../shared/dates';
import { centsFromBrText, centsFromNumberText } from '../../../shared/money';
import type {
  Ct2FileReconciliation,
  Ct2Reconciliation,
  Ct2Segment,
  Ct2Summary,
  Ct2Unreadable,
} from '../../../shared/modules/ct2Integrity';
import type { Alert, CheckResult, WorkerEvent } from '../../../shared/protocol';
import { normalizeTitle } from '../../../shared/titles';
import { IngestError } from '../../ingest/errors';
import type { IngestInput, IngestOptions } from '../../ingest/pipeline';
import { ProgressReporter } from '../../ingest/progress';
import { readSheet, type CellText, type HeadRow } from '../../ingest/readSheet';
import { CellKind, type ParsedRow } from '../../ingest/sheetStream';
import type { PackedColumn } from '../../store/packedColumn';
import { analyzeCt2, type Ct2Analysis } from './analysis';
import { checkOrder, firstDifference, keyLevels, sortBase, sortKeys, type KeyPart } from './order';
import { Ct2Store, RowFlag, TEXT_FIELDS, type Ct2StoreRow, type RowProblem, type TextField } from './store';
import { rowSides } from './aggregate';
import { ENTRY_TYPE_CODES, codeFromCell, entryTypeLookup, otherValue } from './values';

/** Columns read per row; values beyond them are counted as outside the columns (CI-1). */
const SHEET_WIDTH = 256;
/** Rows listed as examples of unreadable values, per file. */
const EXAMPLES = 5;

const PROBLEMS = Object.keys(RowFlag) as RowProblem[];
/** Text fields that are not codes: kept as read, without spaces at the ends. */
const PLAIN_FIELDS = TEXT_FIELDS.filter((f) => !(CODE_FIELDS as readonly string[]).includes(f));
const PROBLEM_LABELS: Record<RowProblem, string> = {
  incompleteKey: 'chave do documento incompleta',
  line: 'linha vazia',
  segment: 'tipo de saldo ou moeda vazio',
  date: 'data inválida',
  amount: 'valor ilegível ou vazio',
  code: 'código numérico não inteiro',
  sharedString: 'referência inválida às strings compartilhadas',
};

export interface Ct2Ingested {
  reconciliation: Ct2Reconciliation;
  summary: Ct2Summary;
  store: Ct2Store;
  /** Row indexes in the order of the Base. */
  order: Uint32Array;
  /** Parts of the sort key of each row (order.ts), for the analysis; the session does not keep them. */
  keys: KeyPart[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Empty or only spaces; the usual text starts with a visible character and needs no trim. */
const isBlank = (t: string) => t === '' || (t.charCodeAt(0) <= 32 && t.trim() === '') || (t.charCodeAt(0) > 127 && t.trim() === '');

/**
 * Unmapped titles of one file, made unique so a repeated title never shares a column of the Base: the n-th
 * occurrence becomes "Filial [n]" (a mark the extraction does not use, so the n-th occurrence joins across files),
 * or the next free number in the unlikely case the file already has a column with that title.
 */
function unmappedColumns(match: HeaderMatch): { index: number; title: string }[] {
  const used = new Set(match.unmapped.map((u) => u.title));
  const seen = new Map<string, number>();
  return match.unmapped.map(({ index, title }) => {
    const occurrence = (seen.get(title) ?? 0) + 1;
    seen.set(title, occurrence);
    if (occurrence === 1) return { index, title };
    let n = occurrence;
    while (used.has(`${title} [${n}]`)) n++;
    const unique = `${title} [${n}]`;
    used.add(unique);
    return { index, title: unique };
  });
}

function notFoundDetail(missing: string[], found: string[]): string {
  return `Colunas obrigatórias não encontradas: ${missing.join(', ')}. Títulos encontrados: ${found.length > 0 ? found.join(', ') : 'nenhum'}.`;
}

/** Reads one file into the store; returns its reading reconciliation. */
async function readFile(
  input: IngestInput,
  fileIndex: number,
  config: Ct2IntegrityConfig,
  store: Ct2Store,
  progress: ProgressReporter,
  options: IngestOptions,
): Promise<{ file: Ct2FileReconciliation; unmapped: string[] }> {
  const { name } = input;
  const searchRows = config.reading.headerSearchRows;
  const lookupType = entryTypeLookup(config);
  let match: HeaderMatch | null = null;
  let date1904 = false;
  const timingsStart = progress.timings.length;

  // Per row: the text of each cell (reused), the mapped columns and the unmapped ones with their column in the store.
  const texts = new Array<string>(SHEET_WIDTH).fill('');
  let titled = new Uint8Array(SHEET_WIDTH);
  let columns: Partial<Record<Ct2Field, number>> = {};
  let plain: { field: TextField; column: number }[] = [];
  let codes: { field: (typeof CODE_FIELDS)[number]; column: number; width: number }[] = [];
  let dateColumn = 0;
  let amountColumn = 0;
  let amountCurrency1Column = -1;
  let others: { index: number; column: PackedColumn }[] = [];
  let unmapped: string[] = [];
  let headerTitles: string[] = [];
  const text: Partial<Record<TextField, string>> = {};
  const stored: Ct2StoreRow = { source: fileIndex, sourceRow: 0, day: 0, amount: 0, amountCurrency1: NaN, entryType: 0, flags: 0, text };
  // Every field of the key is a mandatory column (schema), so it is always read.
  const keyFields = config.documentKey.filter((f): f is TextField => f !== 'date');

  let previous = 0;
  let presentBlank = 0;
  let missingRows = 0;
  let detailRows = 0;
  let outsideCells = 0;
  let amountCurrency1Unreadable = 0;
  const unreadable: Ct2Unreadable & { rows: number; examples: number[] } = {
    incompleteKey: 0,
    line: 0,
    segment: 0,
    date: 0,
    amount: 0,
    code: 0,
    sharedString: 0,
    rows: 0,
    examples: [],
  };

  const cents = (kind: number, t: string): number | null => {
    if (isBlank(t)) return null;
    return kind === CellKind.Number ? centsFromNumberText(t) : centsFromBrText(t);
  };

  const onRow = (r: number, row: ParsedRow, cell: CellText, invalidShared: () => number): void => {
    const header = match!.row;
    if (r < header) return;
    // Cells beyond the columns read: lost, so any value there fails CI-1 (only spaces or a style is no value).
    const sharedBefore = invalidShared();
    let outside = 0;
    for (let e = 0; e < row.extras; e++) if (!isBlank(cell(row, SHEET_WIDTH + e))) outside++;
    outsideCells += outside;
    if (r === header) {
      previous = r;
      return;
    }
    missingRows += r - previous - 1;
    previous = r;

    let content = outside > 0;
    for (let c = 0; c < SHEET_WIDTH; c++) {
      if (row.kind[c] === CellKind.Empty) {
        texts[c] = '';
        continue;
      }
      const t = cell(row, c);
      texts[c] = t;
      if (!isBlank(t)) {
        content = true;
        if (!titled[c]) outsideCells++;
      }
    }
    const badShared = invalidShared() > sharedBefore;
    if (!content && !badShared) {
      presentBlank++;
      return;
    }
    detailRows++;

    let flags = badShared ? RowFlag.sharedString : 0;

    // Codes: zeros kept, numeric cells padded; a numeric code that is not whole is kept as read and flagged.
    for (const { field, column, width } of codes) {
      const code = codeFromCell(row.kind[column] as CellKind, texts[column]!, width);
      if (code === null) flags |= RowFlag.code;
      text[field] = code ?? texts[column]!.trim();
    }
    for (const { field, column } of plain) text[field] = texts[column]!.trim();
    if (text.line === '') flags |= RowFlag.line;
    if (text.balanceType === '' || text.currency === '') flags |= RowFlag.segment;
    for (const f of keyFields) if (text[f] === '') flags |= RowFlag.incompleteKey;

    // Date: a whole Excel serial or dd/mm/aaaa.
    let day = INVALID_TIME;
    const dateText = texts[dateColumn]!;
    if (isBlank(dateText)) flags |= RowFlag.incompleteKey;
    else {
      day = row.kind[dateColumn] === CellKind.Number ? dayFromExcelSerial(Number(dateText), date1904) : parseDate(dateText.trim());
      if (day === INVALID_TIME) flags |= RowFlag.date;
    }

    // Entry type and amount: empty is zero only on a history continuation line.
    const type = lookupType(text.entryType ?? '');
    let amount = cents(row.kind[amountColumn]!, texts[amountColumn]!);
    if (amount === null) amount = type === 'historyContinuation' ? 0 : NaN;
    if (Number.isNaN(amount)) flags |= RowFlag.amount;
    let amountCurrency1 = NaN;
    if (amountCurrency1Column >= 0) {
      const v = cents(row.kind[amountCurrency1Column]!, texts[amountCurrency1Column]!);
      if (v !== null) {
        amountCurrency1 = v;
        if (Number.isNaN(v)) amountCurrency1Unreadable++;
      }
    }

    if (flags !== 0) {
      unreadable.rows++;
      if (unreadable.examples.length < EXAMPLES) unreadable.examples.push(r);
      for (const p of PROBLEMS) if (flags & RowFlag[p]) unreadable[p]++;
    }
    stored.sourceRow = r;
    stored.day = day;
    stored.amount = amount;
    stored.amountCurrency1 = amountCurrency1;
    stored.entryType = type === null ? 0 : ENTRY_TYPE_CODES.indexOf(type) + 1;
    stored.flags = flags;
    store.pushRow(stored);
    for (const { index, column } of others) column.push(otherValue(row.kind[index] as CellKind, texts[index]!));
  };

  const read = await readSheet(input, {
    fileIndex,
    progress,
    inflateMode: options.inflateMode ?? 'auto',
    width: SHEET_WIDTH,
    async chooseSheet(sheets, head, workbook) {
      date1904 = workbook.date1904;
      const results: { sheet: (typeof sheets)[number]; rows: HeadRow[]; search: ReturnType<typeof findHeaderRow> }[] = [];
      for (const sheet of sheets) {
        const rows = await head(sheet, searchRows);
        results.push({ sheet, rows, search: findHeaderRow(rows, config) });
      }
      const candidates = results.filter((x) => x.search.ok || x.search.reason === 'duplicate');
      if (candidates.length > 1) {
        throw new IngestError('rows', `Mais de uma aba de ${name} tem o cabeçalho da extração CT2: ${candidates.map((x) => x.sheet.name).join(', ')}.`);
      }
      const chosen = candidates[0];
      if (!chosen) {
        const misses = results.flatMap(({ sheet, search }) => (search.ok || search.reason !== 'notFound' ? [] : [{ sheet, search }]));
        if (sheets.length === 1) {
          const only = misses[0]!.search;
          throw new IngestError(
            'rows',
            `Cabeçalho da extração CT2 não encontrado nas primeiras ${searchRows} linhas da aba "${sheets[0]!.name}" de ${name}.`,
            notFoundDetail(only.missing, only.found),
          );
        }
        throw new IngestError(
          'rows',
          `Nenhuma aba de ${name} tem o cabeçalho da extração CT2 nas primeiras ${searchRows} linhas.`,
          misses.map(({ sheet, search }) => `Aba "${sheet.name}": ${notFoundDetail(search.missing, search.found)}`).join('\n'),
        );
      }
      const { search } = chosen;
      if (!search.ok) {
        throw new IngestError('rows', `Coluna repetida no cabeçalho da aba "${chosen.sheet.name}" de ${name}.`, search.reason === 'duplicate' ? search.duplicates.join('; ') : undefined);
      }
      match = search.match;
      columns = match.columns;
      headerTitles = chosen.rows.find((h) => h.r === search.match.row)!.titles;
      plain = PLAIN_FIELDS.flatMap((field) => (columns[field] === undefined ? [] : [{ field, column: columns[field] }]));
      codes = CODE_FIELDS.map((field) => ({ field, column: columns[field]!, width: config.codeWidths[field] }));
      dateColumn = columns.date!;
      amountColumn = columns.amount!;
      amountCurrency1Column = columns.amountCurrency1 ?? -1;
      titled = new Uint8Array(SHEET_WIDTH);
      for (const c of Object.values(columns)) titled[c] = 1;
      const unique = unmappedColumns(match);
      for (const { index } of unique) titled[index] = 1;
      unmapped = unique.map((u) => u.title);
      others = unique.map(({ index, title }) => ({ index, column: store.otherColumn(title) }));
      return sheets.indexOf(chosen.sheet);
    },
    onRow,
  });

  const header = match!;
  const totalRows = Math.max(read.lastRow, read.dimensionRows ?? 0, header.row);
  missingRows += totalRows - Math.max(read.lastRow, header.row);
  const rowsAfterHeader = totalRows - header.row;
  const blankRows = presentBlank + missingRows;
  const alerts: Alert[] = read.alerts.map((a) => ({ ...a, message: `${name}: ${a.message}` }));
  if (read.dimensionRows !== null && read.dimensionRows < read.lastRow) {
    alerts.push({ level: 'warning', message: `${name}: a dimensão da aba declara ${read.dimensionRows} linhas, mas a última linha é a ${read.lastRow}.` });
  }
  if (header.missingOptional.length > 0) {
    alerts.push({ level: 'warning', message: `${name}: colunas opcionais ausentes: ${header.missingOptional.map((f) => columnLabel(config, f)).join(', ')}.` });
  }
  if (amountCurrency1Unreadable > 0) {
    alerts.push({
      level: 'warning',
      message: `${name}: ${plural(amountCurrency1Unreadable, 'linha tem', 'linhas têm')} "${config.columns.amountCurrency1.title}" ilegível.`,
    });
  }

  // In the order of the specification, with the title as written in the file.
  const mapped = CT2_FIELDS.flatMap((field) => {
    const column = header.columns[field];
    return column === undefined ? [] : [{ field, title: normalizeTitle(headerTitles[column]!), column: column + 1 }];
  });
  return {
    unmapped,
    file: {
      fileIndex,
      name,
      size: read.size,
      sha256: read.sha256,
      entries: read.entries,
      sheetName: read.sheetName,
      sheetNames: read.sheetNames,
      header: {
        row: header.row,
        mapped,
        missingOptional: header.missingOptional.map((f) => config.columns[f].title),
        unmapped,
      },
      rows: {
        dimensionRows: read.dimensionRows,
        totalRows,
        headerRow: header.row,
        rowsAfterHeader,
        blankRows,
        missingRows,
        detailRows,
        balanced: rowsAfterHeader - blankRows === detailRows,
        outsideCells,
      },
      unreadable,
      amountCurrency1Unreadable,
      alerts,
      timings: progress.timings.slice(timingsStart),
    },
  };
}

/** One alert when the files do not have the same unmapped columns (they are joined by title). */
function columnAlerts(files: Ct2FileReconciliation[], unmapped: string[][]): Alert[] {
  if (files.length < 2) return [];
  const sets = unmapped.map((u) => new Set(u));
  const groups = new Map<string, { holders: string[]; lacking: string[]; titles: string[] }>();
  for (const title of new Set(unmapped.flat())) {
    const holders = files.filter((_, i) => sets[i]!.has(title)).map((f) => f.name);
    if (holders.length === files.length) continue;
    const lacking = files.filter((_, i) => !sets[i]!.has(title)).map((f) => f.name);
    const key = JSON.stringify([holders, lacking]);
    const group = groups.get(key) ?? { holders, lacking, titles: [] };
    group.titles.push(title);
    groups.set(key, group);
  }
  if (groups.size === 0) return [];
  const parts = [...groups.values()].map(
    (g) =>
      `${g.holders.join(', ')} ${g.holders.length > 1 ? 'têm' : 'tem'} ${g.titles.join(', ')}, que ${g.titles.length > 1 ? 'faltam' : 'falta'} em ${g.lacking.join(', ')}`,
  );
  return [{ level: 'warning', message: `As extrações não têm as mesmas colunas: ${parts.join('; ')}. As colunas foram unidas pelo título.` }];
}

/** Totals of the Base walked in its order: segments, documents, batches and days are blocks of the order (CI-2). */
function summarize(store: Ct2Store, keys: ReturnType<typeof sortKeys>, order: Uint32Array, config: Ct2IntegrityConfig): Ct2Summary {
  const levels = keyLevels(config);
  const segments: Ct2Segment[] = [];
  let segment: Ct2Segment | null = null;
  let batches = 0;
  let days = 0;
  let firstDay: number | null = null;
  let lastDay: number | null = null;
  for (let p = 0; p < order.length; p++) {
    const i = order[p]!;
    const first = p === 0 ? 0 : firstDifference(keys, order[p - 1]!, i);
    if (first < levels.segment || segment === null) {
      const code = (column: PackedColumn) => String(column.get(i) ?? '');
      segment = { balanceType: code(store.text.balanceType), currency: code(store.text.currency), lines: 0, documents: 0, debitCents: 0, creditCents: 0 };
      segments.push(segment);
    }
    segment.lines++;
    if (first < levels.document) segment.documents++;
    if (first < levels.batch) batches++;
    if (first < levels.day) days++;
    const sides = rowSides(store, i);
    segment.debitCents += sides.debit;
    segment.creditCents += sides.credit;
    const day = store.day.get(i);
    if (day !== INVALID_TIME) {
      if (firstDay === null || day < firstDay) firstDay = day;
      if (lastDay === null || day > lastDay) lastDay = day;
    }
  }
  if (segments.some((s) => !Number.isSafeInteger(s.debitCents) || !Number.isSafeInteger(s.creditCents))) {
    throw new IngestError('checks', 'A soma dos valores passa do limite de precisão dos centavos.');
  }
  const documents = segments.reduce((n, s) => n + s.documents, 0);
  return { module: 'ct2Integrity', lines: store.rows, segments, documents, batches, days, firstDay, lastDay };
}

function readingCheck(files: Ct2FileReconciliation[]): CheckResult {
  const problems = files.flatMap((f) => [
    ...(f.rows.balanced
      ? []
      : [`${f.name}: ${f.rows.rowsAfterHeader} linhas após o cabeçalho − ${f.rows.blankRows} em branco ≠ ${f.rows.detailRows} linhas de detalhe`]),
    ...(f.rows.outsideCells === 0
      ? []
      : [`${f.name}: ${plural(f.rows.outsideCells, 'valor', 'valores')} em colunas sem título ou além da coluna ${SHEET_WIDTH}, fora da base`]),
  ]);
  return {
    id: 'ct2-reading',
    label: 'Linhas da extração conferidas',
    severity: 'error',
    passed: problems.length === 0,
    message:
      problems.length === 0
        ? 'Todas as linhas foram contadas: linhas após o cabeçalho − linhas em branco = linhas de detalhe, em cada arquivo, e todo valor está numa coluna com título. CRC32 e tamanho de cada parte dos arquivos conferem.'
        : `A leitura não fecha: ${problems.join('; ')}.`,
  };
}

function orderCheckResult(problem: string | null): CheckResult {
  return {
    id: 'ct2-order',
    label: 'Base em blocos contíguos',
    severity: 'error',
    passed: problem === null,
    message:
      problem ??
      'A base está na ordem de segmento (tipo de saldo e moeda), chave do documento e linha: cada documento, lote e dia forma um único bloco de linhas.',
  };
}

function valuesCheck(files: Ct2FileReconciliation[]): CheckResult {
  const rows = files.reduce((n, f) => n + f.unreadable.rows, 0);
  let message = 'Toda linha de detalhe tem a chave do documento completa, linha, tipo de saldo, moeda, data válida e valor legível.';
  if (rows > 0) {
    const kinds = PROBLEMS.flatMap((p) => {
      const n = files.reduce((sum, f) => sum + f.unreadable[p], 0);
      return n === 0 ? [] : [`${PROBLEM_LABELS[p]}: ${n}`];
    });
    const where = files
      .filter((f) => f.unreadable.rows > 0)
      .map(({ name, unreadable: u }) => `${name}: ${u.examples.length === 1 ? 'linha' : 'linhas'} ${u.examples.join(', ')}${u.rows > u.examples.length ? ' e outras' : ''}`);
    message = `${plural(rows, 'linha de detalhe tem', 'linhas de detalhe têm')} valores que não podem ser usados (${kinds.join('; ')}). ${where.join('; ')}.`;
  }
  return { id: 'ct2-values', label: 'Valores legíveis', severity: 'error', passed: rows === 0, message };
}

/**
 * Reads the files into one Base, sorts it and checks the reading (CI-1, CI-2, CI-4). With `analysis`, also analyzes
 * the Base (section 6) and adds the invariants of the analysis to the checks.
 */
export async function ingestCt2(
  inputs: IngestInput[],
  config: Ct2IntegrityConfig,
  post: (event: WorkerEvent) => void,
  options: IngestOptions = {},
  analysis?: { holidays: ReadonlySet<number> },
): Promise<Ct2Ingested & { analysis?: Ct2Analysis }> {
  if (inputs.length === 0) throw new IngestError('fileCheck', 'Nenhum arquivo selecionado.');
  if (inputs.length > 255) throw new IngestError('fileCheck', 'No máximo 255 arquivos por análise.');
  const now = options.now ?? (() => performance.now());
  const started = now();
  const progress = new ProgressReporter(post, now, options.progressIntervalMs ?? 100);
  const store = new Ct2Store();
  const files: Ct2FileReconciliation[] = [];
  const unmapped: string[][] = [];
  for (const [i, input] of inputs.entries()) {
    const read = await readFile(input, i, config, store, progress, options);
    files.push(read.file);
    unmapped.push(read.unmapped);
  }

  progress.begin('reconciliation', undefined, files.length, 'steps', 'Conferindo a leitura dos arquivos');
  store.padOther();
  const alerts = columnAlerts(files, unmapped);
  progress.update(files.length);

  progress.begin('sort', undefined, store.rows, 'rows', 'Ordenando a base por segmento e chave');
  const keys = sortKeys(store, config);
  const order = sortBase(keys, store.rows);
  progress.update(store.rows);
  const ordered = checkOrder(keys, order, config);
  const summary = summarize(store, keys, order, config);
  const reconciliation: Ct2Reconciliation = {
    module: 'ct2Integrity',
    files,
    consolidated: { detailRows: store.rows, alerts },
    checks: [readingCheck(files), orderCheckResult(ordered.problem), valuesCheck(files)],
    totalMs: 0,
  };
  const base: Ct2Ingested = { reconciliation, summary, store, order, keys };

  let analyzed: Ct2Analysis | undefined;
  if (analysis) {
    progress.begin('documents', undefined, store.rows, 'rows', 'Aglutinando por documento, lote e dia e aplicando os testes');
    analyzed = analyzeCt2(base, config, analysis.holidays);
    progress.update(store.rows);
    summary.analysis = {
      parameters: analyzed.parameters,
      tests: analyzed.tests,
      exceptions: analyzed.exceptions.count,
    };
  }

  progress.begin('checks', undefined, 1, 'steps', 'Conferindo os invariantes');
  if (analyzed) reconciliation.checks.push(...analyzed.checks);
  progress.update(1);
  progress.closeStage();
  reconciliation.totalMs = Math.round(now() - started);
  return { ...base, ...(analyzed && { analysis: analyzed }) };
}
