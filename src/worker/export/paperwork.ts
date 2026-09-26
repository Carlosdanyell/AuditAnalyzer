/**
 * The exported workpaper (docs/ARQUITETURA.md, section 5; docs/REGRAS_CFGR700.md, section 12). Data sheets hold the
 * engine's results as values; the Summary is live: every number is a COUNTIFS/SUMIFS over the data sheets for
 * the period chosen in the sheet (preset list or custom dates), following the same allocation rules as the
 * tool. Justification sheets are editable: statuses, coverage and pending notes follow what is typed in Excel.
 * Excel 2016 compatible (no dynamic arrays, no TEXTJOIN). Visual standard in theme.ts.
 */
import { SIGNAL_IDS, type AnalyzerConfig } from '../../config/schema';
import { INVALID_TIME, formatDay, weekday } from '../../shared/dates';
import { justificationKey, normalizeText } from '../../shared/justifications';
import type { CheckResult, Justification, JustificationKind, Period } from '../../shared/protocol';
import type { DocumentInfo } from '../engine/documents';
import { documentIdentification, documentMovement, justificationStatus } from '../engine/justifications';
import { defaultCutoffDay, eventsPerDay, periodPresets, scopeBounds, type PanelContext } from '../engine/panel';
import { isBusinessDay } from '../engine/periods';
import type { RecordInfo } from '../engine/records';
import { displayValue } from '../engine/values';
import type { IngestionResult } from '../ingest/pipeline';
import { CODE_LABELS_EN, FIELD_LABELS_EN, LABELS, SIGNALS_EN, fill, type Language } from './labels';
import { COLORS, createTheme, fitWidth, headerHeight, textHeight, type ColGroup, type ColKind } from './theme';
import { XlsxWriter, colName, dateCell, dateTimeCell, type Cell, type CellInput, type SheetWriter } from './xlsxWriter';

export interface PaperworkInput {
  result: IngestionResult;
  config: AnalyzerConfig;
  scopeIndex: number;
  context: PanelContext;
  cutoffDay: number | null;
  language: Language;
  /** Display text (local time of the user). */
  generatedAt: string;
  appVersion: string;
  configHash: string;
  /** Blocking checks that failed and were confirmed by the user. */
  confirmedFailures: CheckResult[];
}

export interface PaperworkOutput {
  blob: Blob;
  fileName: string;
  /** Invariant 9: smallest date serial written (null when none). */
  minDateSerial: number | null;
}

const EXCEL_SERIAL_2000 = 36526;
/** Between file names in one cell (read back by the justification import). */
export const FILE_SEPARATOR = '; ';
const q = (name: string) => (/^[A-Za-z_][\w.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
const str = (s: string) => `"${s.replace(/"/g, '""')}"`;
const cents = (c: number | null) => (c === null ? null : c / 100);

interface Col {
  id: string;
  header: string;
  width: number;
  kind?: ColKind;
  group?: ColGroup;
}

/** Columns of a data sheet, known before writing so the Summary can reference every range. */
class Layout {
  readonly cols: Col[];
  private readonly letters = new Map<string, string>();
  constructor(
    readonly sheet: string,
    cols: Col[],
    readonly rows: number,
  ) {
    this.cols = cols.map((c) => ({ ...c, width: fitWidth(c.header, c.width) }));
    this.cols.forEach((c, i) => this.letters.set(c.id, colName(i)));
  }
  letter(id: string): string {
    const l = this.letters.get(id);
    if (!l) throw new Error(`Coluna ${id} ausente em ${this.sheet}`);
    return l;
  }
  /** Absolute data range of a column (row 2 to the last row). */
  range(id: string): string {
    const l = this.letter(id);
    return `${q(this.sheet)}!$${l}$2:$${l}$${Math.max(2, this.rows + 1)}`;
  }
  get lastRef(): string {
    return `${colName(this.cols.length - 1)}${Math.max(2, this.rows + 1)}`;
  }
}

export async function buildPaperwork(input: PaperworkInput, onProgress: (step: number, total: number) => void): Promise<PaperworkOutput> {
  const { result, config, context, language } = input;
  const L = LABELS[language];
  const V = L.values;
  const scope = result.analyses[input.scopeIndex]!;
  const consolidated = result.analyses.length > 1 && input.scopeIndex === result.analyses.length - 1;
  const scopeLabel = consolidated ? L.consolidated : result.summary.scopes[input.scopeIndex]!.label;
  const files = result.reconciliation.files;
  const sources = scope.sources;
  const names = context.sourceNames;
  const { dict } = scope.log;
  const w = new XlsxWriter();
  const T = createTheme(w.styles);
  const TOTAL_STEPS = 13;
  let step = 0;
  const progress = () => onProgress(++step, TOTAL_STEPS);

  // ── Data ──
  const docs = scope.documents;
  const records = scope.records;
  const baseOrder = Array.from(scope.baseOrder);
  const keyFields = config.documentKey.fields;
  const otherKeyFields = keyFields.filter((f) => f !== config.fields.date);
  const fieldLabel = (f: string) => (language === 'en' ? (FIELD_LABELS_EN[f] ?? f) : (config.fieldLabels[f] ?? f));
  const extraFields = config.tables.baseRowsExtraFields;
  const val = (r: RecordInfo, field: string): string => {
    const id = dict.find(field);
    const keep = id >= 0 ? scope.log.fields.keepIndex.get(id) : undefined;
    return keep === undefined || r.values[keep]! < 0 ? '' : dict.get(r.values[keep]!);
  };
  const shown = (field: string, raw: string) =>
    displayValue(config, field, raw, (f, code, label) => (language === 'pt' ? label : f === config.nature.field ? (L.nature[code] ?? label) : (CODE_LABELS_EN[label] ?? label)));
  const origin = (o: RecordInfo['origin'] | DocumentInfo['origin']) =>
    ({ manual: V.manual, automatic: V.automatic, mixed: V.mixed, unidentified: V.unidentified })[o];
  const userName = (id: number) => (id < 0 ? '' : id === 0 ? V.emptyUser : dict.get(id));
  const natureLabel = (dc: string) => (dc ? (L.nature[dc] ?? dc) : '');
  const lineType = (t: RecordInfo['lineType']) => ({ accounting: V.accounting, complement: V.complement, undefined: V.undefined })[t];
  const unbalanced = (u: DocumentInfo['unbalanced']) => ({ yes: V.yes, no: V.no, 'not-evaluable': V.notEvaluable })[u];
  const justOf = (kind: JustificationKind, key: string): Justification | undefined => context.justifications.get(justificationKey(kind, key));
  const lastChangeHeader = (s: number) => fill(L.cols.lastChange, { file: names[s] ?? String(s + 1) });
  const bounds = scopeBounds(scope);
  const cutoff = input.cutoffDay ?? defaultCutoffDay(bounds);

  const deletionDocs = docs.filter((d) => d.deletedLines > 0);
  const changeDocs = docs.filter((d) => d.changedLines > 0);
  const deletedRecords = baseOrder.map((i) => records[i]!).filter((r) => r.deleted);
  const unbalancedLines = docs.filter((d) => d.unbalanced === 'yes').flatMap((d) => d.records.map((i) => ({ d, r: records[i]! })));
  const discardedRows = scope.alterationEvents
    .filter((e) => e.kind !== 'effective')
    .flatMap((e) => e.rows.map((row) => ({ e, row })));

  // ── Data sheets: layouts ──
  const keyPartCols: Col[] = otherKeyFields.map((f) => ({ id: `k_${f}`, header: fieldLabel(f), width: 9, kind: 'center' }));
  const docCols: Col[] = [
    { id: 'key', header: L.cols.key, width: 30 },
    { id: 'date', header: fieldLabel(config.fields.date), width: 12, kind: 'date' },
    ...keyPartCols,
    { id: 'origin', header: L.cols.origin, width: 12, kind: 'center' },
    { id: 'history', header: L.cols.history, width: 34 },
    { id: 'accLines', header: L.cols.accountingLines, width: 10, kind: 'int' },
    { id: 'compLines', header: L.cols.complementLines, width: 12, kind: 'int' },
    { id: 'delLines', header: L.cols.deletedLines, width: 10, kind: 'int' },
    { id: 'chLines', header: L.cols.changedLines, width: 10, kind: 'int' },
    { id: 'debitRec', header: L.cols.debitRecorded, width: 15, kind: 'money' },
    { id: 'creditRec', header: L.cols.creditRecorded, width: 15, kind: 'money' },
    { id: 'diffRec', header: L.cols.diffRecorded, width: 14, kind: 'money' },
    { id: 'debitCur', header: L.cols.debitCurrent, width: 15, kind: 'money' },
    { id: 'creditCur', header: L.cols.creditCurrent, width: 15, kind: 'money' },
    { id: 'diffCur', header: L.cols.diffCurrent, width: 14, kind: 'money' },
    { id: 'base', header: L.cols.base, width: 12, kind: 'center' },
    { id: 'excluded', header: L.cols.excluded, width: 10, kind: 'center' },
    { id: 'unbalanced', header: L.cols.unbalanced, width: 13, kind: 'center' },
    { id: 'firstDel', header: L.cols.firstDeletion, width: 18, kind: 'datetime' },
    { id: 'lastDel', header: L.cols.lastDeletion, width: 18, kind: 'datetime' },
    ...sources.map((s): Col => ({ id: `ch_${s}`, header: lastChangeHeader(s), width: 20, kind: 'datetime' })),
    { id: 'firstPost', header: L.cols.firstPosting, width: 18, kind: 'datetime' },
    { id: 'delJust', header: L.cols.deletionJust, width: 45 },
    { id: 'delStatus', header: L.cols.deletionStatus, width: 20, kind: 'center' },
    { id: 'chJust', header: L.cols.changeJust, width: 45 },
    { id: 'chStatus', header: L.cols.changeStatus, width: 20, kind: 'center' },
    { id: 'delInP', header: L.cols.deletedInPeriod, width: 14, kind: 'center', group: 'helper' },
    { id: 'chInP', header: L.cols.changedInPeriod, width: 14, kind: 'center', group: 'helper' },
    { id: 'pendInP', header: L.cols.pendingInPeriod, width: 16, kind: 'center', group: 'helper' },
  ];
  const DOC = new Layout(L.sheets.documents, docCols, docs.length);

  const linCols: Col[] = [
    { id: 'key', header: L.cols.key, width: 30 },
    { id: 'recno', header: L.cols.recno, width: 10, kind: 'id' },
    { id: 'date', header: fieldLabel(config.fields.date), width: 12, kind: 'date' },
    ...keyPartCols,
    { id: 'line', header: fieldLabel(config.fields.line), width: 7, kind: 'center' },
    { id: 'origin', header: L.cols.origin, width: 13, kind: 'center' },
    { id: 'nature', header: L.cols.nature, width: 22, kind: 'center' },
    { id: 'lineType', header: L.cols.lineType, width: 12, kind: 'center' },
    { id: 'value', header: L.cols.value, width: 14, kind: 'money' },
    { id: 'debit', header: L.cols.debit, width: 14, kind: 'money' },
    { id: 'credit', header: L.cols.credit, width: 14, kind: 'money' },
    ...extraFields.map((f): Col => ({ id: `x_${f}`, header: fieldLabel(f), width: f === config.fields.history ? 40 : 16 })),
    { id: 'status', header: L.cols.status, width: 10, kind: 'center' },
    { id: 'insUser', header: L.cols.insertUser, width: 16 },
    { id: 'insTime', header: L.cols.insertTime, width: 18, kind: 'datetime' },
    { id: 'delUser', header: L.cols.deleteUser, width: 16 },
    { id: 'delTime', header: L.cols.deleteTime, width: 18, kind: 'datetime' },
    { id: 'changes', header: L.cols.changes, width: 11, kind: 'int' },
    ...sources.map((s): Col => ({ id: `ch_${s}`, header: lastChangeHeader(s), width: 20, kind: 'datetime' })),
    { id: 'incons', header: L.cols.inconsistency, width: 14, kind: 'center' },
    { id: 'docUnb', header: L.cols.docUnbalanced, width: 14, kind: 'center' },
    { id: 'files', header: L.cols.files, width: 24 },
    { id: 'chInP', header: L.cols.changedInPeriod, width: 14, kind: 'center', group: 'helper' },
  ];
  const LIN = new Layout(L.sheets.lines, linCols, baseOrder.length);

  const justCols = (kind: JustificationKind): Col[] => [
    { id: 'key', header: L.cols.key, width: 30 },
    { id: 'docValue', header: L.cols.documentValue, width: 15, kind: 'money' },
    ...(kind === 'deletion' ? [{ id: 'delValue', header: L.cols.deletedValue, width: 14, kind: 'money' } satisfies Col] : []),
    { id: 'history', header: L.cols.history, width: 34 },
    { id: 'status', header: L.cols.status, width: 24, kind: 'center' },
    { id: 'text', header: kind === 'deletion' ? L.cols.deletionJust : L.cols.changeJust, width: 60, kind: 'wrap', group: 'edit' },
    { id: 'responsible', header: L.cols.responsible, width: 16, group: 'edit' },
    { id: 'note', header: L.cols.note, width: 34, kind: 'wrap' },
    { id: 'confirm', header: L.cols.confirmNew, width: 13, kind: 'center', group: 'edit' },
    { id: 'date', header: fieldLabel(config.fields.date), width: 12, kind: 'date' },
    { id: 'origin', header: L.cols.origin, width: 12, kind: 'center' },
    { id: 'lines', header: kind === 'deletion' ? L.cols.deletedLines : L.cols.changedLines, width: 10, kind: 'int' },
    ...(kind === 'deletion'
      ? [
          { id: 'firstDel', header: L.cols.firstDeletion, width: 18, kind: 'datetime' } satisfies Col,
          { id: 'lastDel', header: L.cols.lastDeletion, width: 18, kind: 'datetime' } satisfies Col,
        ]
      : []),
    { id: 'moveFiles', header: L.cols.movementFiles, width: 24 },
    { id: 'lastEvent', header: L.cols.lastEvent, width: 18, kind: 'datetime' },
    { id: 'covFiles', header: L.cols.coveredFiles, width: 24 },
    { id: 'lastCovered', header: L.cols.lastCovered, width: 18, kind: 'datetime' },
    { id: 'moved', header: L.cols.movedAtExport, width: 17, kind: 'center', group: 'helper' },
  ];
  const JE = new Layout(L.sheets.deletionJust, justCols('deletion'), deletionDocs.length);
  const JA = new Layout(L.sheets.changeJust, justCols('change'), changeDocs.length);

  // ── Data sheets: writing (each cell takes the style of its column kind) ──
  const openTable = (layout: Layout, options: { freezeCols?: number; tabColor?: string } = {}): SheetWriter => {
    const sheet = w.addSheet(layout.sheet, {
      columns: layout.cols.map((c) => ({ width: c.width })),
      freeze: { rows: 1, cols: options.freezeCols ?? 0 },
      autoFilter: `A1:${layout.lastRef}`,
      ...(options.tabColor && { tabColor: options.tabColor }),
    });
    sheet.row(layout.cols.map((c) => ({ v: c.header, s: T.head[c.group ?? 'data'] })), { height: headerHeight(layout.cols) });
    return sheet;
  };
  const columnStyles = new WeakMap<Layout, number[]>();
  const writeRow = (sheet: SheetWriter, layout: Layout, cells: Record<string, CellInput>) => {
    let styles = columnStyles.get(layout);
    if (!styles) columnStyles.set(layout, (styles = layout.cols.map((c) => T.kind[c.kind ?? 'text'])));
    return sheet.row(layout.cols.map((c) => cells[c.id]), { styles });
  };

  // Helper sheet layout: parameters, presets, holidays, daily table.
  const presets = periodPresets(scope, bounds, context).map((p) => ({ ...p, label: helperPresetLabel(p.id, p.label) }));
  function helperPresetLabel(id: string, label: string): string {
    if (id === 'full') return V.fullLog;
    const m = /^file-(\d+)$/.exec(id);
    if (m) return `${V.file} ${Number(m[1]) + 1} — ${names[Number(m[1])] ?? ''}`;
    return label;
  }
  const PRESET_ROW = 12;
  const presetLastRow = PRESET_ROW + presets.length; // + the custom row
  const holidays = [...context.holidays].sort((a, b) => a - b);
  const requested = sources.map((s) => context.requestedIntervals[s]).filter((p): p is Period => !!p);
  const known = [...requested, ...(bounds ? [bounds] : [])];
  const dayFrom = known.length ? Math.min(...known.map((p) => p.startDay)) : 0;
  const dayTo = known.length ? Math.max(...known.map((p) => p.endDay)) : -1;
  const days = Array.from({ length: Math.max(0, dayTo - dayFrom + 1) }, (_, i) => dayFrom + i);
  const DAILY_HEAD = Math.max(presetLastRow, PRESET_ROW + holidays.length) + 3;
  const DAILY_FIRST = DAILY_HEAD + 1;
  const DAILY_LAST = DAILY_FIRST + Math.max(days.length, 1) - 1;
  const H = q(L.sheets.helper);
  const auxRange = (col: string) => `${H}!$${col}$${DAILY_FIRST}:$${col}$${DAILY_LAST}`;
  const events = eventsPerDay(scope);

  // ── Formula builders ──
  const inPeriod = (range: string) => `${range},">="&DT_INI,${range},"<"&(DT_FIM+1)`;
  const any = (range: string) => `${range},">0"`;
  type Mode = 'period' | 'full';
  const dateCrit = (range: string, mode: Mode) => (mode === 'period' ? inPeriod(range) : any(range));
  type Cat = 'deleted' | 'changed' | 'unbalanced' | 'posted';
  const lineDateCols = (cat: Cat): string[] =>
    cat === 'deleted' ? ['delTime'] : cat === 'changed' ? sources.map((s) => `ch_${s}`) : ['insTime'];
  const docDateCols = (cat: Cat): string[] =>
    cat === 'deleted' ? ['firstDel'] : cat === 'changed' ? sources.map((s) => `ch_${s}`) : ['firstPost'];
  const lineExtra = (cat: Cat) => (cat === 'unbalanced' ? `,${LIN.range('docUnb')},${str(V.yes)}` : '');
  const docExtra = (cat: Cat) => (cat === 'unbalanced' ? `,${DOC.range('unbalanced')},${str(V.yes)}` : '');
  const sumOf = (parts: string[]) => (parts.length === 1 ? parts[0]! : parts.join('+'));
  /** Lines of a category; originCrit is an extra COUNTIFS pair (or ''). */
  const countLines = (cat: Cat, originCrit: string, mode: Mode, extra = '') =>
    sumOf(lineDateCols(cat).map((c) => `COUNTIFS(${dateCrit(LIN.range(c), mode)}${lineExtra(cat)}${originCrit}${extra})`));
  const sumDebit = (cat: Cat, originCrit: string, mode: Mode, extra = '') =>
    `ROUND(${sumOf(lineDateCols(cat).map((c) => `SUMIFS(${LIN.range('debit')},${dateCrit(LIN.range(c), mode)}${lineExtra(cat)}${originCrit}${extra})`))},2)`;
  const countDocs = (cat: Cat, originCrit: string, mode: Mode, extra = '') =>
    sumOf(docDateCols(cat).map((c) => `COUNTIFS(${dateCrit(DOC.range(c), mode)}${docExtra(cat)}${originCrit}${extra})`));
  const lo = (value: string) => `,${LIN.range('origin')},${str(value)}`;
  const doo = (value: string) => `,${DOC.range('origin')},${str(value)}`;
  const identifiedLines = `,${LIN.range('origin')},${str('<>' + V.unidentified)}`;
  const yesNo = (condition: string) => `IF(${condition},${str(V.yes)},${str(V.no)})`;
  const inPeriodCell = (col: string, r: number) => `AND(${col}${r}<>"",${col}${r}>=DT_INI,${col}${r}<DT_FIM+1)`;

  // ════════ Summary ════════
  const SW = [46, 15, 15, 18, 15, 15, 18, 15, 15, 18];
  const spanWidth = (cols: number) => SW.slice(0, cols).reduce((a, b) => a + b, 0);
  const sum = w.addSheet(L.sheets.summary, {
    columns: SW.map((width) => ({ width })),
    freeze: { rows: 8, cols: 0 },
    showGridLines: false,
    tabColor: COLORS.navy,
  });
  const SUMQ = q(L.sheets.summary);
  const lastCol = (cols: number) => colName(cols - 1);
  /** A row whose first cell spans `cols` columns (the other cells keep the style, so borders and fills show). */
  const spanRow = (value: Cell & { s: number }, cols: number, height?: number) => {
    const r = sum.row([value, ...Array.from({ length: cols - 1 }, () => ({ v: null, s: value.s }))], height ? { height } : {});
    if (cols > 1) sum.merge(`A${r}:${lastCol(cols)}${r}`);
    return r;
  };
  const section = (title: string, cols = 10) => {
    sum.skip(1);
    spanRow({ v: title, s: T.section }, cols, 22);
  };
  const header = (titles: string[]) =>
    sum.row(titles.map((v) => ({ v, s: T.headSummary })), { height: headerHeight(titles.map((h, i) => ({ header: h, width: SW[i]! }))) });
  const note = (text: string, cols = 10) => spanRow({ v: text, s: T.note }, cols, textHeight(text, spanWidth(cols), 9));

  const firstEvent = bounds ? formatDay(bounds.startDay) : '—';
  const lastEvent = bounds ? formatDay(bounds.endDay) : '—';
  spanRow({ v: fill(L.summary.title, { table: config.table }), s: T.title }, 10, 30);
  spanRow({ v: fill(L.summary.subtitle, { scope: scopeLabel, files: sources.map((s) => names[s]).join(', '), first: firstEvent, last: lastEvent }), s: T.subtitle }, 10);
  spanRow({ v: fill(L.summary.generated, { when: input.generatedAt, version: input.appVersion }), s: T.meta }, 10);
  const failed = input.confirmedFailures;
  const banner = failed.length ? fill(L.summary.failBanner, { n: failed.length, list: failed.map((c) => c.label).join('; ') }) : L.summary.okBanner;
  spanRow({ v: banner, s: failed.length ? T.fail : T.ok }, 10, Math.max(22, textHeight(banner, spanWidth(10), 10)));
  sum.skip(1);
  spanRow({ v: L.summary.filter, s: T.section }, 7, 22); // row 6
  header([L.summary.period, L.summary.customStart, L.summary.customEnd, L.summary.cutoff, L.summary.appliedStart, L.summary.appliedEnd, L.summary.days]); // row 7
  sum.row(
    [
      { v: V.fullLog, s: T.input },
      { v: null, s: T.inputDate },
      { v: null, s: T.inputDate },
      cutoff === INVALID_TIME ? { v: null, s: T.inputDate } : dateCell(cutoff, T.inputDate),
      { f: 'DT_INI', s: T.applied },
      { f: 'DT_FIM', s: T.applied },
      { f: 'DT_FIM-DT_INI+1', s: T.appliedInt },
    ],
    { height: 26 },
  ); // row 8
  sum.validation({ sqref: 'A8', type: 'list', formula1: `${H}!$A$${PRESET_ROW + 1}:$A$${presetLastRow + 1}` });
  sum.validation({ sqref: 'B8:D8', type: 'date', formula1: 'DATE(1990,1,1)', formula2: 'DATE(2100,12,31)' });
  note(L.summary.help, 7);

  const catRows: { cat: Cat; label: string }[] = [
    { cat: 'deleted', label: L.categories.deleted },
    { cat: 'changed', label: L.categories.changed },
    { cat: 'unbalanced', label: L.categories.unbalanced },
    { cat: 'posted', label: L.categories.posted },
  ];
  const DATA_ROW = 20;

  // 1. Categories by origin
  section(L.summary.s1);
  header(L.summary.s1cols);
  const s1Row: Record<Cat, number> = {} as Record<Cat, number>;
  for (const { cat, label } of catRows) {
    s1Row[cat] = sum.row(
      [
        { v: label, s: T.label },
        { f: countLines(cat, lo(V.manual), 'period'), s: T.int },
        { f: countDocs(cat, doo(V.manual), 'period'), s: T.int },
        { f: sumDebit(cat, lo(V.manual), 'period'), s: T.money },
        { f: countLines(cat, lo(V.automatic), 'period'), s: T.int },
        { f: countDocs(cat, doo(V.automatic), 'period'), s: T.int },
        { f: sumDebit(cat, lo(V.automatic), 'period'), s: T.money },
        { f: countDocs(cat, doo(V.mixed), 'period'), s: T.int },
        { f: countDocs(cat, '', 'period'), s: T.int },
        { f: countLines(cat, lo(V.unidentified), 'period'), s: T.int },
      ],
      { height: DATA_ROW },
    );
  }
  note(L.summary.s1note);

  // 2. Period × other days × full log
  section(L.summary.s2);
  header(L.summary.s2cols);
  for (const { cat, label } of catRows) {
    const r = sum.nextRow;
    sum.row(
      [
        { v: label, s: T.label },
        { f: countLines(cat, '', 'period'), s: T.int },
        { f: countDocs(cat, '', 'period'), s: T.int },
        { f: sumDebit(cat, '', 'period'), s: T.money },
        { f: `H${r}-B${r}`, s: T.int },
        { f: `I${r}-C${r}`, s: T.int },
        { f: `ROUND(J${r}-D${r},2)`, s: T.money },
        { f: countLines(cat, '', 'full'), s: T.int },
        { f: countDocs(cat, '', 'full'), s: T.int },
        { f: sumDebit(cat, '', 'full'), s: T.money },
      ],
      { height: DATA_ROW },
    );
  }

  // 3. Composition by accounting date
  section(L.summary.s3);
  header(L.summary.s3cols);
  const lineDate = (op: string) => `,${LIN.range('date')},${op === '' ? '""' : `"${op}"&CORTE`}`;
  const docDate = (op: string) => `,${DOC.range('date')},${op === '' ? '""' : `"${op}"&CORTE`}`;
  for (const { cat, label } of catRows) {
    sum.row(
      [
        { v: label, s: T.label },
        { f: countLines(cat, identifiedLines, 'period', lineDate('<=')), s: T.int },
        { f: countDocs(cat, '', 'period', docDate('<=')), s: T.int },
        { f: sumDebit(cat, identifiedLines, 'period', lineDate('<=')), s: T.money },
        { f: countLines(cat, identifiedLines, 'period', lineDate('>')), s: T.int },
        { f: countDocs(cat, '', 'period', docDate('>')), s: T.int },
        { f: sumDebit(cat, identifiedLines, 'period', lineDate('>')), s: T.money },
        { f: countLines(cat, identifiedLines, 'period', lineDate('')), s: T.int },
        { f: countDocs(cat, '', 'period', docDate('')), s: T.int },
        { f: countLines(cat, lo(V.unidentified), 'period'), s: T.int },
      ],
      { height: DATA_ROW },
    );
  }
  note(L.summary.s3note);

  // 4. Signals
  section(L.summary.s4);
  const s4Head = header([L.summary.s4cols[0]!, L.summary.s4cols[1]!, L.summary.s4cols[2]!, '', '', '', '', '', '', L.summary.s4cols[3]!]);
  sum.merge(`C${s4Head}:I${s4Head}`);
  const inPeriodLines = (col: string) => inPeriod(LIN.range(col));
  const pendingExpr = `COUNTIFS(${inPeriodLines('insTime')},${LIN.range('incons')},${str(V.pending)})`;
  const correctedExpr = `COUNTIFS(${inPeriodLines('insTime')},${LIN.range('incons')},${str(V.corrected)})`;
  const auxInPeriod = `(${auxRange('A')}>=DT_INI)*(${auxRange('A')}<=DT_FIM)`;
  const signalCounts: Record<(typeof SIGNAL_IDS)[number], string> = {
    unbalancedDocuments: `I${s1Row.unbalanced}`,
    unjustifiedDocuments: `COUNTIFS(${DOC.range('pendInP')},${str(V.yes)})`,
    unidentifiedChanges: `COUNTIFS(${LIN.range('origin')},${str(V.unidentified)},${LIN.range('chInP')},${str(V.yes)})`,
    inconsistentEntries: `${pendingExpr}+${correctedExpr}`,
    noUserInclusions: `COUNTIFS(${inPeriodLines('insTime')},${LIN.range('insUser')},${str(V.emptyUser)})`,
    // Every covered day is in the helper table; the rest of the period is uncovered.
    uncoveredDays: `DT_FIM-DT_INI+1-SUMPRODUCT(${auxInPeriod}*(${auxRange('D')}=${str(V.yes)}))`,
    daysWithoutEvents: `SUMPRODUCT(${auxInPeriod}*(${auxRange('D')}=${str(V.yes)})*(${auxRange('C')}=${str(V.yes)})*(${auxRange('E')}=0))`,
  };
  const templateFormula = (template: string, values: Record<string, string>) =>
    template
      .split(/(\{\w+\})/)
      .filter((part) => part !== '')
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        return m ? (values[m[1]!] ?? str(part)) : str(part);
      })
      .join('&');
  const s4First = sum.nextRow;
  for (const id of SIGNAL_IDS) {
    const def = config.panel.signals[id];
    const texts = language === 'en' ? SIGNALS_EN[id] : def;
    const r = sum.nextRow;
    const n = `B${r}`;
    const text = templateFormula(texts.text, { n, pendentes: pendingExpr, corrigidos: correctedExpr, dias: str(L.daysListNote) });
    const action =
      def.requiresAction === 'always'
        ? `IF(${n}>0,${str(V.action)},${str(V.ok)})`
        : def.requiresAction === 'never'
          ? `IF(${n}>0,${str(V.info)},${str(V.ok)})`
          : id === 'inconsistentEntries'
            ? `IF(${pendingExpr}>0,${str(V.action)},IF(${n}>0,${str(V.info)},${str(V.ok)}))`
            : `IF(${n}>0,${str(V.action)},${str(V.ok)})`;
    sum.row(
      [
        { v: texts.label, s: T.label },
        { f: signalCounts[id], s: T.count },
        { f: `IF(${n}=0,${str(texts.none)},${text})`, s: T.text },
        ...Array.from({ length: 6 }, () => ({ v: null, s: T.text })),
        { f: action, s: T.center },
      ],
      { height: 24 },
    );
    sum.merge(`C${r}:I${r}`);
  }
  const s4Last = sum.nextRow - 1;
  const J4 = `J${s4First}:J${s4Last}`;
  sum.conditional({ sqref: J4, formula: `$J${s4First}=${str(V.action)}`, style: { fill: COLORS.badFill, font: { bold: true, color: COLORS.badFont } } });
  sum.conditional({ sqref: J4, formula: `$J${s4First}=${str(V.ok)}`, style: { fill: COLORS.okFill, font: { bold: true, color: COLORS.okFont } } });
  sum.conditional({ sqref: J4, formula: `$J${s4First}=${str(V.info)}`, style: { fill: COLORS.warnFill, font: { color: COLORS.warnFont } } });
  note(L.summary.s4note);

  // 5. Justification coverage
  section(L.summary.s5, 6);
  header(L.summary.s5cols);
  const s5First = sum.nextRow;
  const coverageRow = (label: string, inP: string, statusCol: string) => {
    const r = sum.nextRow;
    sum.row(
      [
        { v: label, s: T.label },
        { f: `COUNTIFS(${DOC.range(inP)},${str(V.yes)})`, s: T.int },
        { f: `COUNTIFS(${DOC.range(inP)},${str(V.yes)},${DOC.range(statusCol)},${str(V.justified)})`, s: T.int },
        { f: `COUNTIFS(${DOC.range(inP)},${str(V.yes)},${DOC.range(statusCol)},${str(V.moved)})`, s: T.int },
        { f: `B${r}-C${r}-D${r}`, s: T.int },
        { f: `IF(B${r}=0,"—",C${r}/B${r})`, s: T.pct },
      ],
      { height: DATA_ROW },
    );
  };
  coverageRow(L.summary.s5rows[0]!, 'delInP', 'delStatus');
  coverageRow(L.summary.s5rows[1]!, 'chInP', 'chStatus');
  {
    const r = sum.nextRow;
    const col = (c: string) => ({ f: `SUM(${c}${s5First}:${c}${s5First + 1})`, s: T.totalInt });
    sum.row([{ v: V.total, s: T.totalLabel }, col('B'), col('C'), col('D'), col('E'), { f: `IF(B${r}=0,"—",C${r}/B${r})`, s: T.totalPct }], { height: DATA_ROW });
  }
  note(L.summary.s5note, 6);

  // 6. Change cut-off criterion per extraction
  const fileScopes = sources.map((s) => ({ s, stats: result.summary.scopes[s]!.stats }));
  const s6Cols = fileScopes.length + 3;
  section(L.summary.s6, s6Cols);
  header([L.summary.s6cols[0]!, ...fileScopes.map(({ s }) => `${L.cols.events} — ${names[s]}`), `${L.cols.events} — ${V.total}`, L.summary.s6cols[1]!]);
  const kinds: { key: 'activation' | 'stamp' | 'effective'; label: string; treatment: string }[] = [
    { key: 'activation', label: V.activation, treatment: V.discarded },
    { key: 'stamp', label: V.stamp, treatment: V.discarded },
    { key: 'effective', label: V.effective, treatment: V.considered },
  ];
  const s6First = sum.nextRow;
  for (const k of kinds) {
    const r = sum.nextRow;
    sum.row(
      [
        { v: k.label, s: T.label },
        ...fileScopes.map(({ stats }) => ({ v: stats.alterations[k.key], s: T.int })),
        { f: `SUM(B${r}:${colName(fileScopes.length)}${r})`, s: T.int },
        { v: k.treatment, s: T.center },
      ],
      { height: DATA_ROW },
    );
  }
  sum.row(
    [
      { v: L.summary.s6total, s: T.totalLabel },
      ...[...fileScopes, null].map((_, i) => ({ f: `SUM(${colName(i + 1)}${s6First}:${colName(i + 1)}${s6First + 2})`, s: T.totalInt })),
      { v: null, s: T.totalBlank },
    ],
    { height: DATA_ROW },
  );

  // 7. Daily movement (from the helper sheet)
  section(L.summary.s7, 9);
  header(L.summary.s7cols);
  const s7First = sum.nextRow;
  days.forEach((_, i) => {
    const hr = DAILY_FIRST + i;
    sum.row([
      { f: `${H}!A${hr}`, s: T.date },
      { f: `${H}!B${hr}`, s: T.center },
      { f: `${H}!F${hr}`, s: T.int },
      { f: `${H}!G${hr}`, s: T.int },
      { f: `${H}!H${hr}`, s: T.int },
      { f: `${H}!E${hr}`, s: T.int },
      { f: `${H}!I${hr}`, s: T.center },
      { f: `${H}!C${hr}`, s: T.center },
      { f: `${H}!D${hr}`, s: T.center },
    ]);
  });
  if (days.length) {
    const s7Last = s7First + days.length - 1;
    const area = `A${s7First}:I${s7Last}`;
    sum.conditional({ sqref: area, formula: `$I${s7First}=${str(V.no)}`, style: { fill: COLORS.badFill } });
    sum.conditional({ sqref: area, formula: `$H${s7First}=${str(V.no)}`, style: { fill: COLORS.weekend } });
    sum.conditional({ sqref: area, formula: `$G${s7First}=${str(V.no)}`, style: { font: { color: COLORS.faint } } });
  }
  note(L.summary.s7note, 9);

  // 8. Where to check
  section(L.summary.s8);
  const where: [keyof typeof L.summary.where, string][] = [
    ['deletionJust', L.sheets.deletionJust],
    ['changeJust', L.sheets.changeJust],
    ['documents', L.sheets.documents],
    ['lines', L.sheets.lines],
    ['deletions', L.sheets.deletions],
    ['changes', L.sheets.changes],
    ['unbalanced', L.sheets.unbalanced],
    ['discardedDetail', L.sheets.discardedDetail],
    ['discardedSummary', L.sheets.discardedSummary],
    ['criteria', L.sheets.criteria],
    ['trace', L.sheets.trace],
    ['helper', L.sheets.helper],
  ];
  for (const [key, sheet] of where) {
    const r = sum.row([{ v: sheet, s: T.link }, { v: L.summary.where[key], s: T.desc }], { height: 18 });
    sum.merge(`B${r}:J${r}`);
    sum.link({ ref: `A${r}`, location: `${q(sheet)}!A1`, display: sheet });
  }
  sum.end();
  progress();

  // ════════ Justification sheets ════════
  const writeJustifications = (layout: Layout, kind: JustificationKind, list: DocumentInfo[]) => {
    const sheet = openTable(layout, { freezeCols: 1, tabColor: COLORS.edit });
    const Tx = layout.letter('text');
    const M = layout.letter('moved');
    const C = layout.letter('confirm');
    for (const d of list) {
      const r = sheet.nextRow;
      const j = justOf(kind, d.key);
      const hasText = !!j && normalizeText(j.text) !== '';
      const status = hasText ? justificationStatus(scope, d, kind, names, j) : 'pending';
      const movement = documentMovement(scope, d, kind);
      const id = documentIdentification(scope, d, config.fields.history);
      const movedAndUnconfirmed = `AND(${M}${r}=${str(V.yes)},${C}${r}<>${str(V.yes)})`;
      writeRow(sheet, layout, {
        key: d.key,
        docValue: id.documentDebitCents / 100,
        delValue: id.deletedDebitCents / 100,
        history: id.history,
        // Moved after the justification until the user confirms that the text covers the new event.
        status: { f: `IF(LEN(TRIM(${Tx}${r}))=0,${str(V.pending)},IF(${movedAndUnconfirmed},${str(V.moved)},${str(V.justified)}))` },
        text: j?.text ?? '',
        responsible: j?.responsible ?? '',
        note: { f: `IF(LEN(TRIM(${Tx}${r}))=0,${str(V.pendingNote)},IF(${movedAndUnconfirmed},${str(V.movedNote)},""))` },
        confirm: '',
        date: dateCell(d.entryDay),
        origin: origin(d.origin),
        lines: kind === 'deletion' ? d.deletedLines : d.changedLines,
        firstDel: dateTimeCell(d.firstDeletion),
        lastDel: dateTimeCell(d.lastDeletion),
        moveFiles: movement.files.map((s) => names[s] ?? '').join(FILE_SEPARATOR),
        lastEvent: dateTimeCell(movement.lastEvent),
        covFiles: hasText ? j!.coverage.files.join(FILE_SEPARATOR) : '',
        lastCovered: hasText && j!.coverage.lastEvent !== null ? dateTimeCell(j!.coverage.lastEvent) : null,
        moved: status === 'moved' ? V.yes : V.no,
      });
    }
    const last = Math.max(2, list.length + 1);
    sheet.conditional({ sqref: `${Tx}2:${Tx}${last}`, formula: `LEN(TRIM(${Tx}2))=0`, style: { fill: COLORS.warnFill } });
    sheet.conditional({ sqref: `${C}2:${C}${last}`, formula: `AND(${M}2=${str(V.yes)},${C}2<>${str(V.yes)})`, style: { fill: COLORS.warnFill } });
    sheet.validation({ sqref: `${C}2:${C}${last}`, type: 'list', formula1: str(`${V.yes},${V.no}`) });
    const B = layout.letter('status');
    sheet.conditional({ sqref: `${B}2:${B}${last}`, formula: `$${B}2=${str(V.pending)}`, style: { font: { bold: true, color: COLORS.badFont } } });
    sheet.conditional({ sqref: `${B}2:${B}${last}`, formula: `$${B}2=${str(V.moved)}`, style: { font: { bold: true, color: COLORS.orange } } });
    sheet.conditional({ sqref: `${B}2:${B}${last}`, formula: `$${B}2=${str(V.justified)}`, style: { font: { color: COLORS.okFont } } });
    sheet.end();
  };
  writeJustifications(JE, 'deletion', deletionDocs);
  progress();
  writeJustifications(JA, 'change', changeDocs);
  progress();

  // ════════ Documents ════════
  {
    const sheet = openTable(DOC, { freezeCols: 1 });
    const X = (id: string) => DOC.letter(id);
    const jeKey = JE.range('key');
    const jaKey = JA.range('key');
    for (const d of docs) {
      const r = sheet.nextRow;
      const cells: Record<string, CellInput> = {
        key: d.key,
        date: dateCell(d.entryDay),
        origin: origin(d.origin),
        history: documentIdentification(scope, d, config.fields.history).history,
        accLines: d.accountingLines,
        compLines: d.complementLines,
        delLines: d.deletedLines,
        chLines: d.changedLines,
        debitRec: d.debitRecorded / 100,
        creditRec: d.creditRecorded / 100,
        diffRec: { f: `ROUND(${X('debitRec')}${r}-${X('creditRec')}${r},2)` },
        debitCur: d.debitCurrent / 100,
        creditCur: d.creditCurrent / 100,
        diffCur: { f: `ROUND(${X('debitCur')}${r}-${X('creditCur')}${r},2)` },
        base: d.base === 'complete' ? V.complete : V.partial,
        excluded: { no: V.no, total: V.total, partial: V.partial }[d.excluded],
        unbalanced: unbalanced(d.unbalanced),
        firstDel: dateTimeCell(d.firstDeletion),
        lastDel: dateTimeCell(d.lastDeletion),
        firstPost: dateTimeCell(d.firstPosting),
        delJust: { f: `IF(${X('delLines')}${r}=0,"",IFERROR(INDEX(${JE.range('text')},MATCH($A${r},${jeKey},0))&"",""))` },
        delStatus: { f: `IF(${X('delLines')}${r}=0,${str(V.none)},IFERROR(INDEX(${JE.range('status')},MATCH($A${r},${jeKey},0))&"",${str(V.pending)}))` },
        chJust: { f: `IF(${X('chLines')}${r}=0,"",IFERROR(INDEX(${JA.range('text')},MATCH($A${r},${jaKey},0))&"",""))` },
        chStatus: { f: `IF(${X('chLines')}${r}=0,${str(V.none)},IFERROR(INDEX(${JA.range('status')},MATCH($A${r},${jaKey},0))&"",${str(V.pending)}))` },
        delInP: { f: yesNo(inPeriodCell(X('firstDel'), r)) },
        chInP: { f: yesNo(sources.length ? `OR(${sources.map((s) => inPeriodCell(X(`ch_${s}`), r)).join(',')})` : 'FALSE') },
        pendInP: {
          f: yesNo(
            `OR(AND(${X('delInP')}${r}=${str(V.yes)},${X('delStatus')}${r}<>${str(V.justified)}),AND(${X('chInP')}${r}=${str(V.yes)},${X('chStatus')}${r}<>${str(V.justified)}))`,
          ),
        },
      };
      otherKeyFields.forEach((f) => (cells[`k_${f}`] = d.keyParts[keyFields.indexOf(f)] ?? ''));
      sources.forEach((s) => (cells[`ch_${s}`] = dateTimeCell(d.lastChangeBySource[s]!)));
      writeRow(sheet, DOC, cells);
    }
    sheet.end();
  }
  progress();

  // ════════ Lines (Base_Linhas) ════════
  const docOfRecord = (r: RecordInfo) => (r.documentIndex >= 0 ? docs[r.documentIndex]! : null);
  {
    const sheet = openTable(LIN, { freezeCols: 1 });
    const X = (id: string) => LIN.letter(id);
    for (const index of baseOrder) {
      const rec = records[index]!;
      const r = sheet.nextRow;
      const doc = docOfRecord(rec);
      const cells: Record<string, CellInput> = {
        key: rec.documentKey,
        recno: rec.recno,
        date: dateCell(rec.entryDay),
        line: val(rec, config.fields.line),
        origin: origin(rec.origin),
        nature: natureLabel(rec.nature),
        lineType: lineType(rec.lineType),
        value: cents(rec.valueCents),
        debit: rec.valueCents === null ? null : rec.debitCents / 100,
        credit: rec.valueCents === null ? null : rec.creditCents / 100,
        status: rec.deleted ? V.deleted : V.active,
        insUser: rec.included ? userName(rec.inclusionUser) : '',
        insTime: rec.included ? dateTimeCell(rec.inclusionTime) : null,
        delUser: rec.deleted ? userName(rec.deletionUser) : '',
        delTime: rec.deleted ? dateTimeCell(rec.deletionTime) : null,
        changes: rec.changeCount,
        incons: { no: V.no, pending: V.pending, corrected: V.corrected }[rec.inconsistency],
        docUnb: doc ? unbalanced(doc.unbalanced) : V.none,
        files: rec.sources.map((s) => names[s] ?? '').join(FILE_SEPARATOR),
        chInP: { f: yesNo(sources.length ? `OR(${sources.map((s) => inPeriodCell(X(`ch_${s}`), r)).join(',')})` : 'FALSE') },
      };
      otherKeyFields.forEach((f) => (cells[`k_${f}`] = val(rec, f)));
      extraFields.forEach((f) => (cells[`x_${f}`] = val(rec, f)));
      sources.forEach((s) => (cells[`ch_${s}`] = dateTimeCell(rec.lastChangeBySource[s]!)));
      writeRow(sheet, LIN, cells);
    }
    sheet.end();
  }
  progress();

  // ════════ Deletions, changes, unbalanced, discarded ════════
  const simpleSheet = (name: string, cols: Col[], rows: Record<string, CellInput>[], freezeCols = 0) => {
    const layout = new Layout(name, cols, rows.length);
    const sheet = openTable(layout, { freezeCols });
    for (const row of rows) writeRow(sheet, layout, row);
    sheet.end();
  };
  const keyCells = (rec: RecordInfo): Record<string, CellInput> => {
    const c: Record<string, CellInput> = { key: rec.documentKey, date: dateCell(rec.entryDay), line: val(rec, config.fields.line), recno: rec.recno, origin: origin(rec.origin) };
    otherKeyFields.forEach((f) => (c[`k_${f}`] = val(rec, f)));
    return c;
  };
  const keyCols: Col[] = [
    { id: 'key', header: L.cols.key, width: 30 },
    { id: 'date', header: fieldLabel(config.fields.date), width: 12, kind: 'date' },
    ...keyPartCols,
    { id: 'line', header: fieldLabel(config.fields.line), width: 7, kind: 'center' },
    { id: 'recno', header: L.cols.recno, width: 10, kind: 'id' },
    { id: 'origin', header: L.cols.origin, width: 13, kind: 'center' },
  ];
  const extraCols = (): Col[] => extraFields.map((f) => ({ id: `x_${f}`, header: fieldLabel(f), width: f === config.fields.history ? 40 : 16 }));
  const amounts = (rec: RecordInfo): Record<string, CellInput> => ({
    nature: natureLabel(rec.nature),
    value: cents(rec.valueCents),
    debit: rec.valueCents === null ? null : rec.debitCents / 100,
    credit: rec.valueCents === null ? null : rec.creditCents / 100,
  });
  const amountCols: Col[] = [
    { id: 'nature', header: L.cols.nature, width: 22, kind: 'center' },
    { id: 'value', header: L.cols.value, width: 14, kind: 'money' },
    { id: 'debit', header: L.cols.debit, width: 14, kind: 'money' },
    { id: 'credit', header: L.cols.credit, width: 14, kind: 'money' },
  ];
  simpleSheet(
    L.sheets.deletions,
    [
      { id: 'delTime', header: L.cols.deleteTime, width: 18, kind: 'datetime' },
      { id: 'delUser', header: L.cols.deleteUser, width: 16 },
      ...keyCols,
      ...amountCols,
      ...extraCols(),
      { id: 'insUser', header: L.cols.insertUser, width: 16 },
      { id: 'insTime', header: L.cols.insertTime, width: 18, kind: 'datetime' },
      { id: 'file', header: L.cols.file, width: 18 },
    ],
    deletedRecords.map((rec) => {
      const c = { ...keyCells(rec), ...amounts(rec) };
      extraFields.forEach((f) => (c[`x_${f}`] = val(rec, f)));
      return {
        ...c,
        delTime: dateTimeCell(rec.deletionTime),
        delUser: userName(rec.deletionUser),
        insUser: rec.included ? userName(rec.inclusionUser) : '',
        insTime: rec.included ? dateTimeCell(rec.inclusionTime) : null,
        file: names[rec.deletionSource] ?? '',
      };
    }),
  );
  progress();
  const d = scope.log.details;
  {
    const recordByRecno = new Map(records.map((r) => [r.recno, r]));
    simpleSheet(
      L.sheets.changes,
      [
        { id: 'time', header: L.cols.time, width: 18, kind: 'datetime' },
        { id: 'user', header: L.cols.user, width: 16 },
        ...keyCols,
        { id: 'field', header: L.cols.field, width: 13, kind: 'center' },
        { id: 'fieldLabel', header: L.cols.fieldLabel, width: 22 },
        { id: 'oldValue', header: L.cols.oldValue, width: 30 },
        { id: 'newValue', header: L.cols.newValue, width: 30 },
        { id: 'lineValue', header: L.cols.lineValue, width: 14, kind: 'money' },
        { id: 'current', header: L.cols.currentStatus, width: 11, kind: 'center' },
        { id: 'file', header: L.cols.file, width: 18 },
      ],
      scope.effectiveChangeRows.map((row) => {
        const rec = recordByRecno.get(d.recno[row]!)!;
        const field = dict.get(d.field[row]!);
        return {
          ...keyCells(rec),
          time: dateTimeCell(d.dateTime[row]!),
          user: userName(d.user[row]!),
          field,
          fieldLabel: fieldLabel(field),
          oldValue: shown(field, dict.get(d.oldVal[row]!)),
          newValue: shown(field, dict.get(d.newVal[row]!)),
          lineValue: cents(rec.valueCents),
          current: rec.deleted ? V.deleted : V.active,
          file: names[d.source[row]!] ?? '',
        };
      }),
    );
  }
  progress();
  simpleSheet(
    L.sheets.unbalanced,
    [
      ...keyCols,
      ...amountCols,
      { id: 'status', header: L.cols.status, width: 10, kind: 'center' },
      { id: 'docDiffRec', header: L.cols.docDiffRecorded, width: 16, kind: 'money' },
      { id: 'docDiffCur', header: L.cols.docDiffCurrent, width: 16, kind: 'money' },
      { id: 'insUser', header: L.cols.insertUser, width: 16 },
      { id: 'insTime', header: L.cols.insertTime, width: 18, kind: 'datetime' },
      ...extraCols(),
    ],
    unbalancedLines.map(({ d: doc, r: rec }) => {
      const c = { ...keyCells(rec), ...amounts(rec) };
      extraFields.forEach((f) => (c[`x_${f}`] = val(rec, f)));
      return {
        ...c,
        status: rec.deleted ? V.deleted : V.active,
        docDiffRec: (doc.debitRecorded - doc.creditRecorded) / 100,
        docDiffCur: (doc.debitCurrent - doc.creditCurrent) / 100,
        insUser: rec.included ? userName(rec.inclusionUser) : '',
        insTime: rec.included ? dateTimeCell(rec.inclusionTime) : null,
      };
    }),
  );
  progress();
  simpleSheet(
    L.sheets.discardedDetail,
    [
      ...keyCols,
      ...amountCols,
      { id: 'kind', header: L.cols.kind, width: 26 },
      { id: 'field', header: L.cols.field, width: 13, kind: 'center' },
      { id: 'oldValue', header: L.cols.oldValue, width: 22, kind: 'center' },
      { id: 'newValue', header: L.cols.newValue, width: 22, kind: 'center' },
      { id: 'user', header: L.cols.user, width: 16 },
      { id: 'time', header: L.cols.time, width: 18, kind: 'datetime' },
      { id: 'current', header: L.cols.currentStatus, width: 11, kind: 'center' },
      { id: 'file', header: L.cols.file, width: 18 },
    ],
    discardedRows.map(({ e, row }) => {
      const rec = records[e.recordIndex]!;
      const field = dict.get(d.field[row]!);
      return {
        ...keyCells(rec),
        ...amounts(rec),
        kind: e.kind === 'activation' ? V.activation : V.stamp,
        field,
        oldValue: shown(field, dict.get(d.oldVal[row]!)),
        newValue: shown(field, dict.get(d.newVal[row]!)),
        user: userName(e.user),
        time: dateTimeCell(e.time),
        current: rec.included || rec.deleted ? (rec.deleted ? V.deleted : V.active) : '',
        file: names[d.source[row]!] ?? '',
      };
    }),
  );
  progress();
  {
    // Change events by kind, file and user, with totals per kind and file.
    const groups = new Map<string, { kind: string; file: string; user: string; events: number; records: Set<number> }>();
    for (const e of scope.alterationEvents) {
      const kind = { activation: V.activation, stamp: V.stamp, effective: V.effective }[e.kind];
      const file = names[d.source[e.rows[0]!]!] ?? '';
      const user = userName(e.user);
      const key = `${kind}|${file}|${user}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { kind, file, user, events: 0, records: new Set() }));
      g.events++;
      g.records.add(e.recno);
    }
    const order = [V.activation, V.stamp, V.effective];
    const list = [...groups.values()].sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || (a.user < b.user ? -1 : a.user > b.user ? 1 : 0),
    );
    const layout = new Layout(
      L.sheets.discardedSummary,
      [
        { id: 'kind', header: L.cols.kind, width: 30 },
        { id: 'file', header: L.cols.file, width: 22 },
        { id: 'user', header: L.cols.user, width: 22 },
        { id: 'events', header: L.cols.events, width: 12, kind: 'int' },
        { id: 'records', header: L.cols.records, width: 12, kind: 'int' },
      ],
      list.length,
    );
    const sheet = openTable(layout);
    for (const g of list) writeRow(sheet, layout, { kind: g.kind, file: g.file, user: g.user, events: g.events, records: g.records.size });
    const last = Math.max(2, list.length + 1);
    sheet.skip(1);
    for (const kind of order) {
      for (const s of sources) {
        const file = names[s] ?? '';
        sheet.row(
          [
            { v: `${V.total} — ${kind}`, s: T.totalLabel },
            { v: file, s: T.totalLabel },
            { v: null, s: T.totalBlank },
            { f: `SUMIFS($D$2:$D$${last},$A$2:$A$${last},${str(kind)},$B$2:$B$${last},${str(file)})`, s: T.totalInt },
            { v: null, s: T.totalBlank },
          ],
          { height: 18 },
        );
      }
    }
    sheet.end();
  }
  progress();

  // ════════ Criteria ════════
  {
    const width = 115;
    const sheet = w.addSheet(L.sheets.criteria, { columns: [{ width }], showGridLines: false });
    sheet.row([{ v: L.criteria.title, s: T.title }], { height: 30 });
    const stats = scope.stats;
    const u = stats.unidentified;
    const tol = (config.balanceToleranceCents / 100).toFixed(2).replace('.', language === 'pt' ? ',' : '.');
    const encoded = config.valueDisplay.encoded.join(', ');
    const paragraphs: [string, string][] =
      language === 'pt'
        ? [
            ['Fonte', `Relatório CFGR700 do TOTVS Protheus, tabela ${config.table}. Arquivos: ${sources.map((s) => names[s]).join(', ')}. Eventos de ${firstEvent} a ${lastEvent}. Escopo: ${scopeLabel}.`],
            ['Linhas do relatório', 'Cabeçalhos repetidos e linhas em branco (inclusive linhas ausentes no XML) são separados das linhas de detalhe; a reconciliação de cada arquivo está na Rastreabilidade.'],
            ['Evento e registro', 'Evento = linhas com o mesmo Recno, Operação, Usuário e Data/hora. Registro = estado final de cada Recno: o último valor de cada campo pela data/hora e pela ordem de leitura; na exclusão vale o valor antigo.'],
            ['Documento e origem', `Chave ${keyFields.join('|')}. Origem Manual (${config.origin.field} = ${config.origin.manual.join('/')}), Automático (${config.origin.automatic.join('/')}), Misto quando o documento tem as duas. "${V.unidentified}" quando a origem não aparece no log.`],
            ['Alterações', `Eventos só com ${config.balanceType.field} ${config.balanceType.expectedFrom} → ${config.balanceType.expectedTo} (efetivação) ou só com carimbo de usuário são descartados. Qualquer outra alteração — inclusive outra transição de ${config.balanceType.field} — é efetiva.`],
            ['Valores exibidos nas alterações', `Códigos aparecem com a descrição (ex.: "9 — Pré-lançamento"). O campo ${encoded}, que o Protheus grava de forma codificada (usuário e data da gravação), aparece como "—": o usuário e a data/hora do evento estão nas colunas próprias.`],
            ['Desbalanceado', `|débito − crédito| ≥ R$ ${tol} no registrado (todas as linhas) ou no vigente (linhas não excluídas). "Não avaliável" quando alguma linha do documento não tem inclusão no log (base parcial).`],
            ['Período', 'Pela data do evento. Exclusões e postagens contam o documento no período do primeiro evento; alterações usam a data de cada arquivo (um registro alterado em dois arquivos aparece nos dois períodos).'],
            ['Colunas "No período do Resumo"', 'Em Documentos e Base_Linhas, as colunas de cabeçalho cinza (Sim/Não) indicam se a linha entra no período escolhido no Resumo; são recalculadas pelo Excel e alimentam os quadros.'],
            ['Competência', 'A data contábil (CT2_DATA) de cada linha e de cada documento é comparada com a data de corte informada no Resumo.'],
            ['Justificativas', 'Uma por documento e por tipo (exclusão, alteração), identificada pela chave, pelo valor do documento e pelo histórico da 1ª linha. A cobertura (arquivos e último evento) fica nas abas de justificativa; "movimentado após a justificativa" indica movimento posterior num arquivo não coberto.'],
            ['Limitações', `O log contém apenas o que foi movimentado no intervalo extraído — não é a população da razão. Com "Exclui campos não alterados = Sim", alterações trazem só o campo modificado: há documentos de base parcial (${stats.partialBaseDocuments}) e registros não identificados (${stats.unidentifiedRecords}: ${u.contentChange} com alteração de conteúdo, ${u.onlyActivation} só efetivação, ${u.onlyStamp} só carimbo). Estes podem ser associados a documentos consultando a CT2 pelo Recno.`],
            ['Planilha', 'Valores em reais; negativos entre parênteses e zero como traço. Datas gravadas como datas do Excel. As fórmulas recalculam ao abrir; campos em amarelo são editáveis.'],
          ]
        : [
            ['Source', `CFGR700 report of TOTVS Protheus, table ${config.table}. Files: ${sources.map((s) => names[s]).join(', ')}. Events from ${firstEvent} to ${lastEvent}. Scope: ${scopeLabel}.`],
            ['Report rows', 'Repeated headers and blank rows (including rows missing from the XML) are separated from detail rows; the reconciliation of each file is in Traceability.'],
            ['Event and record', 'Event = rows with the same Recno, Operation, User and Time. Record = final state of each Recno: the last value of each field by time and reading order; for deletions, the old value.'],
            ['Document and origin', `Key ${keyFields.join('|')}. Manual origin (${config.origin.field} = ${config.origin.manual.join('/')}), Automatic (${config.origin.automatic.join('/')}), Mixed when the document has both. "${V.unidentified}" when the origin does not appear in the log.`],
            ['Changes', `Events with only ${config.balanceType.field} ${config.balanceType.expectedFrom} → ${config.balanceType.expectedTo} (activation) or only the user stamp are discarded. Any other change — including another ${config.balanceType.field} transition — is effective.`],
            ['Values shown in the changes', `Codes are shown with their description (e.g. "9 — Pre-posting"). The field ${encoded}, which Protheus stores encoded (user and date of the recording), is shown as "—": the user and time of the event are in their own columns.`],
            ['Unbalanced', `|debit − credit| ≥ ${tol} in the recorded amounts (all lines) or current amounts (lines not deleted). "Not evaluable" when a line of the document has no insert in the log (partial basis).`],
            ['Period', 'By event date. Deletions and postings count the document in the period of its first event; changes use the date of each file (a record changed in two files appears in both periods).'],
            ['"In the Summary period" columns', 'In Documents and Lines, the columns with a grey header (Yes/No) tell whether the row is in the period chosen in the Summary; Excel recalculates them and they feed the tables.'],
            ['Accrual', 'The accounting date (CT2_DATA) of each line and document is compared with the cutoff date typed in the Summary.'],
            ['Justifications', 'One per document and kind (deletion, change), identified by the key, the document amount and the history of the first line. The coverage (files and last event) is in the justification sheets; "moved after the justification" means a later movement in a file not covered.'],
            ['Limitations', `The log holds only what moved in the extracted interval — it is not the ledger population. With "Exclude unchanged fields = Yes", changes bring only the modified field: there are partial-basis documents (${stats.partialBaseDocuments}) and unidentified records (${stats.unidentifiedRecords}: ${u.contentChange} with content changes, ${u.onlyActivation} activation only, ${u.onlyStamp} stamp only). They can be matched to documents by querying CT2 by Recno.`],
            ['Workbook', 'Negative amounts in parentheses and zero as a dash. Dates stored as Excel dates. Formulas recalculate on open; yellow cells are editable.'],
          ];
    for (const [title, text] of paragraphs) {
      sheet.skip(1);
      sheet.row([{ v: title, s: T.h2 }], { height: 20 });
      sheet.row([{ v: text, s: T.paragraph }], { height: textHeight(text, width, 10) });
    }
    sheet.skip(1);
    sheet.row([{ v: language === 'pt' ? 'Dicionário de campos' : 'Field dictionary', s: T.h2 }], { height: 20 });
    for (const f of config.fields.keep) sheet.row([{ v: `${f} — ${fieldLabel(f)}`, s: T.plain10 }]);
    sheet.end();
  }
  progress();

  // ════════ Traceability ════════
  {
    const TR = L.trace;
    const TW = [34, 14, 19, 19, ...Array.from({ length: 12 }, () => 13), 68];
    const sheet = w.addSheet(L.sheets.trace, { columns: TW.map((width) => ({ width })), showGridLines: false });
    const cellsSpan = (parts: { cell: Cell & { s: number }; span?: number }[], height?: number) => {
      const row: CellInput[] = [];
      const merges: string[] = [];
      for (const { cell, span = 1 } of parts) {
        const start = row.length;
        row.push(cell, ...Array.from({ length: span - 1 }, () => ({ v: null, s: cell.s })));
        if (span > 1) merges.push(`${colName(start)}:${colName(start + span - 1)}`);
      }
      const r = sheet.row(row, height ? { height } : {});
      for (const m of merges) {
        const [a, b] = m.split(':');
        sheet.merge(`${a}${r}:${b}${r}`);
      }
      return r;
    };
    const headRow = (titles: string[]) =>
      sheet.row(titles.map((v) => ({ v, s: T.headSummary })), { height: headerHeight(titles.map((h, i) => ({ header: h, width: TW[i]! }))) });
    const heading = (text: string) => {
      sheet.skip(1);
      sheet.row([{ v: text, s: T.h2 }], { height: 22 });
    };
    sheet.row([{ v: TR.title, s: T.title }], { height: 30 });
    heading(TR.kv);
    const kv = (k: string, v: string) => cellsSpan([{ cell: { v: k, s: T.kvLabel } }, { cell: { v, s: T.kvValue }, span: 7 }], 18);
    kv(TR.tool, 'AuditAnalyzer');
    kv(TR.version, input.appVersion);
    kv(TR.generated, input.generatedAt);
    kv(TR.language, language === 'pt' ? 'Português' : 'English');
    kv(TR.scope, scopeLabel);
    kv(TR.configHash, input.configHash);
    kv(TR.cutoff, cutoff === INVALID_TIME ? '—' : formatDay(cutoff));
    kv(TR.holidays, holidays.map(formatDay).join(', ') || '—');
    kv(TR.presets, context.userPresets.map((p) => `${p.label} (${formatDay(p.period.startDay)} a ${formatDay(p.period.endDay)})`).join('; ') || '—');
    if (failed.length) {
      sheet.skip(1);
      cellsSpan([{ cell: { v: fill(TR.confirmed, { when: input.generatedAt }), s: T.fail }, span: 8 }], 22);
    }
    heading(TR.files);
    const fileOrder = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 2];
    headRow(fileOrder.map((i) => TR.fileCols[i]!));
    for (const s of sources) {
      const f = files[s]!;
      const ev = Object.fromEntries(f.events.map((e) => [e.operation, e.count]));
      const n = (v: number) => ({ v, s: T.int });
      sheet.row(
        [
          { v: f.name, s: T.text },
          n(f.size),
          f.firstEvent === null ? { v: null, s: T.datetime } : dateTimeCell(f.firstEvent, T.datetime),
          f.lastEvent === null ? { v: null, s: T.datetime } : dateTimeCell(f.lastEvent, T.datetime),
          n(f.rows.totalRows),
          n(f.rows.rowsAfterHeader),
          n(f.rows.repeatedHeaders),
          n(f.rows.blankRows),
          n(f.rows.detailRows),
          { v: f.rows.balanced ? TR.passed : TR.failed, s: T.center },
          n(ev[config.operations.insert] ?? 0),
          n(ev[config.operations.update] ?? 0),
          n(ev[config.operations.delete] ?? 0),
          n(ev[config.operations.restore] ?? 0),
          n(f.totalEvents),
          { v: `${f.entries.filter((e) => e.ok).length}/${f.entries.length}`, s: T.center },
          { v: f.sha256, s: T.text },
        ],
        { height: 18 },
      );
    }
    heading(TR.params);
    cellsSpan(
      [
        { cell: { v: TR.paramCols[0]!, s: T.headSummary } },
        { cell: { v: TR.paramCols[1]!, s: T.headSummary } },
        { cell: { v: TR.paramCols[2]!, s: T.headSummary }, span: 4 },
        { cell: { v: TR.paramCols[3]!, s: T.headSummary }, span: 3 },
      ],
      20,
    );
    for (const s of sources) {
      for (const p of files[s]!.parameters) {
        cellsSpan(
          [
            { cell: { v: files[s]!.name, s: T.text } },
            { cell: { v: p.question ?? '', s: T.center } },
            { cell: { v: p.label, s: T.text }, span: 4 },
            { cell: { v: p.value, s: T.text }, span: 3 },
          ],
          18,
        );
      }
    }
    heading(TR.checks);
    const detailWidth = TW.slice(3, 16).reduce((a, b) => a + b, 0);
    cellsSpan(
      [
        { cell: { v: TR.checkCols[0]!, s: T.headSummary } },
        { cell: { v: TR.checkCols[1]!, s: T.headSummary } },
        { cell: { v: TR.checkCols[2]!, s: T.headSummary } },
        { cell: { v: TR.checkCols[3]!, s: T.headSummary }, span: 13 },
      ],
      20,
    );
    const checksFirst = sheet.nextRow;
    for (const c of result.reconciliation.checks) {
      cellsSpan(
        [
          { cell: { v: c.label, s: T.label } },
          { cell: { v: c.severity === 'error' ? TR.blocking : TR.warning, s: T.center } },
          { cell: { v: c.passed ? TR.passed : TR.failed, s: T.center } },
          { cell: { v: c.message, s: T.text }, span: 13 },
        ],
        Math.max(20, textHeight(c.message, detailWidth, 10), textHeight(c.label, TW[0]!, 10)),
      );
    }
    const checksLast = sheet.nextRow - 1;
    if (checksLast >= checksFirst) {
      sheet.conditional({ sqref: `C${checksFirst}:C${checksLast}`, formula: `C${checksFirst}=${str(TR.failed)}`, style: { fill: COLORS.badFill, font: { bold: true, color: COLORS.badFont } } });
      sheet.conditional({ sqref: `C${checksFirst}:C${checksLast}`, formula: `C${checksFirst}=${str(TR.passed)}`, style: { font: { color: COLORS.okFont } } });
    }
    heading(TR.justifications);
    headRow(TR.justCols);
    for (const [kind, list] of [
      ['deletion', deletionDocs],
      ['change', changeDocs],
    ] as const) {
      const counts = { justified: 0, moved: 0, pending: 0 };
      for (const doc of list) counts[justificationStatus(scope, doc, kind, names, justOf(kind, doc.key))]++;
      sheet.row(
        [
          { v: L.kinds[kind], s: T.label },
          { v: list.length, s: T.int },
          { v: counts.justified, s: T.int },
          { v: counts.moved, s: T.int },
          { v: counts.pending, s: T.int },
        ],
        { height: 18 },
      );
    }
    cellsSpan([{ cell: { v: TR.coverageNote, s: T.note }, span: 8 }], textHeight(TR.coverageNote, TW.slice(0, 8).reduce((a, b) => a + b, 0), 9));
    sheet.end();
  }
  progress();

  // ════════ Helper ════════
  {
    const sheet = w.addSheet(L.sheets.helper, {
      columns: [{ width: 34 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 12 }],
      showGridLines: false,
      tabColor: COLORS.helper,
    });
    const HL = L.helper;
    sheet.row([{ v: HL.title, s: T.h2 }], { height: 24 }); // row 1
    sheet.skip(1);
    sheet.row([{ v: HL.param, s: T.headSummary }, { v: HL.value, s: T.headSummary }], { height: 20 }); // row 3
    const presetStart = `$B$${PRESET_ROW + 1}:$B$${presetLastRow + 1}`;
    const presetEnd = `$C$${PRESET_ROW + 1}:$C$${presetLastRow + 1}`;
    const presetNames = `$A$${PRESET_ROW + 1}:$A$${presetLastRow + 1}`;
    const param = (label: string, value: CellInput) => sheet.row([{ v: label, s: T.kvLabel }, value], { height: 18 });
    param(HL.appliedStart, { f: `IF(${SUMQ}!$A$8=${str(V.custom)},${SUMQ}!$B$8,IFERROR(INDEX(${presetStart},MATCH(${SUMQ}!$A$8,${presetNames},0)),$B$7))`, s: T.date }); // row 4
    param(HL.appliedEnd, { f: `IF(${SUMQ}!$A$8=${str(V.custom)},${SUMQ}!$C$8,IFERROR(INDEX(${presetEnd},MATCH(${SUMQ}!$A$8,${presetNames},0)),$B$8))`, s: T.date }); // row 5
    param(HL.cutoff, { f: `IF(ISNUMBER(${SUMQ}!$D$8),${SUMQ}!$D$8,${cutoff === INVALID_TIME ? 0 : cutoff + EXCEL_SERIAL_2000})`, s: T.date }); // row 6
    param(HL.logFirst, bounds ? dateCell(bounds.startDay, T.date) : { v: null, s: T.date }); // row 7
    param(HL.logLast, bounds ? dateCell(bounds.endDay, T.date) : { v: null, s: T.date }); // row 8
    w.defineName('DT_INI', `${H}!$B$4`);
    w.defineName('DT_FIM', `${H}!$B$5`);
    w.defineName('CORTE', `${H}!$B$6`);
    sheet.skip(1);
    // Presets (row 11 = title, 12 = header).
    sheet.row([{ v: HL.presets, s: T.h2 }, null, null, null, { v: HL.holidays, s: T.h2 }], { height: 22 });
    sheet.row([...HL.presetCols.map((v) => ({ v, s: T.headSummary })), null, { v: HL.holidays, s: T.headSummary }], { height: 20 });
    const presetRows = presets.map((p) => [{ v: p.label, s: T.text }, dateCell(p.period.startDay, T.date), dateCell(p.period.endDay, T.date)] as CellInput[]);
    presetRows.push([
      { v: V.custom, s: T.text },
      // Empty custom dates stay empty (never 00/01/1900).
      { f: `IF(${SUMQ}!$B$8="","",${SUMQ}!$B$8)`, s: T.date },
      { f: `IF(${SUMQ}!$C$8="","",${SUMQ}!$C$8)`, s: T.date },
    ]);
    const helperRows = Math.max(presetRows.length, holidays.length);
    for (let i = 0; i < helperRows; i++) {
      const pr = presetRows[i] ?? [null, null, null];
      sheet.row([...pr, null, holidays[i] !== undefined ? dateCell(holidays[i]!, T.date) : null]);
    }
    // Daily table.
    while (sheet.nextRow < DAILY_HEAD - 1) sheet.skip(1);
    sheet.row([{ v: HL.daily, s: T.h2 }], { height: 22 });
    const dailyTitles = [0, 1, 7, 8, 5, 2, 3, 4, 6].map((i) => L.summary.s7cols[i]!);
    sheet.row(
      dailyTitles.map((v) => ({ v, s: T.headSummary })),
      { height: headerHeight(dailyTitles.map((h, i) => ({ header: h, width: [34, 13, 13, 13, 11, 11, 11, 11, 12][i]! }))) },
    );
    const holidaySet = new Set(holidays);
    days.forEach((day) => {
      const r = sheet.nextRow;
      const covered = requested.some((p) => day >= p.startDay && day <= p.endDay);
      const crit = (range: string) => `${range},">="&$A${r},${range},"<"&($A${r}+1)`;
      sheet.row([
        dateCell(day, T.date),
        { v: V.weekdays[weekday(day)]!, s: T.center },
        { v: isBusinessDay(day, holidaySet) ? V.yes : V.no, s: T.center },
        { v: covered ? V.yes : V.no, s: T.center },
        { v: events.get(day) ?? 0, s: T.int },
        { f: `COUNTIFS(${crit(LIN.range('insTime'))})`, s: T.int },
        { f: `COUNTIFS(${crit(LIN.range('delTime'))})`, s: T.int },
        { f: sumOf(sources.map((s) => `COUNTIFS(${crit(LIN.range(`ch_${s}`))})`)) || '0', s: T.int },
        { f: yesNo(`AND($A${r}>=DT_INI,$A${r}<=DT_FIM)`), s: T.center },
      ]);
    });
    sheet.end();
  }
  progress();

  const blob = await w.finish();
  const date = input.generatedAt.slice(0, 10).split('/').reverse().join('-');
  const fileName = fill(L.file, { scope: scopeLabel.replace(/\.xlsx$/i, ''), date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : input.generatedAt.slice(0, 10) });
  return { blob, fileName: fileName.replace(/[\\/:*?"<>|]/g, '-'), minDateSerial: w.minDateSerial };
}
