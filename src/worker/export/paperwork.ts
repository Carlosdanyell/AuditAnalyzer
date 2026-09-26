/**
 * The exported workpaper (docs/ARQUITETURA.md, section 5; docs/REGRAS_CFGR700.md). Data sheets hold the
 * engine's results as values; the Summary is live: every number is a COUNTIFS/SUMIFS over the data sheets for
 * the period chosen in the sheet (preset list or custom dates), following the same allocation rules as the
 * tool. Justification sheets are editable: statuses, coverage and pending notes follow what is typed in Excel.
 * Excel 2016 compatible (no dynamic arrays, no TEXTJOIN).
 */
import { SIGNAL_IDS, type AnalyzerConfig } from '../../config/schema';
import { INVALID_TIME, formatDay, weekday } from '../../shared/dates';
import { justificationKey, normalizeText } from '../../shared/justifications';
import type { CheckResult, Justification, JustificationKind, Period } from '../../shared/protocol';
import type { DocumentInfo } from '../engine/documents';
import { documentMovement, justificationStatus } from '../engine/justifications';
import { defaultCutoffDay, eventsPerDay, periodPresets, scopeBounds, type PanelContext } from '../engine/panel';
import { isBusinessDay } from '../engine/periods';
import type { RecordInfo } from '../engine/records';
import type { IngestionResult } from '../ingest/pipeline';
import { FIELD_LABELS_EN, LABELS, SIGNALS_EN, fill, type Language } from './labels';
import { XlsxWriter, colName, dateCell, dateTimeCell, type CellInput } from './xlsxWriter';

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
}

class Layout {
  readonly letters = new Map<string, string>();
  constructor(
    readonly sheet: string,
    readonly cols: Col[],
    readonly rows: number,
  ) {
    cols.forEach((c, i) => this.letters.set(c.id, colName(i)));
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
    return `${colName(this.cols.length - 1)}${this.rows + 1}`;
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
  const S = w.styles;
  const TOTAL_STEPS = 13;
  let step = 0;
  const progress = () => onProgress(++step, TOTAL_STEPS);

  // ── Styles ──
  const st = {
    title: S.style({ font: { name: 'Aptos Display', size: 18, bold: true, color: 'FF1F4E79' } }),
    subtitle: S.style({ font: { color: 'FF404040' } }),
    muted: S.style({ font: { size: 9, italic: true, color: 'FF595959' }, align: { wrap: true, v: 'top' } }),
    ok: S.style({ fill: 'FFE2EFDA', font: { bold: true, color: 'FF375623' }, align: { wrap: true, v: 'center' } }),
    fail: S.style({ fill: 'FFFCE4D6', font: { bold: true, color: 'FFC00000' }, align: { wrap: true, v: 'center' } }),
    section: S.style({ fill: 'FF1F4E79', font: { name: 'Aptos Display', size: 12, bold: true, color: 'FFFFFFFF' }, align: { v: 'center' } }),
    head: S.style({ fill: 'FFDDEBF7', font: { bold: true, size: 10 }, border: 'thinBottom', align: { wrap: true, h: 'center', v: 'center' } }),
    rowLabel: S.style({ font: { bold: true }, border: 'thinBottom' }),
    int: S.style({ numFmt: '#,##0', border: 'thinBottom' }),
    money: S.style({ numFmt: '#,##0.00', border: 'thinBottom' }),
    pct: S.style({ numFmt: '0%', border: 'thinBottom', align: { h: 'right' } }),
    text: S.style({ border: 'thinBottom', align: { wrap: true, v: 'top' } }),
    input: S.style({ fill: 'FFFFF2CC', border: 'box', borderColor: 'FFBF9000', font: { bold: true } }),
    inputDate: S.style({ fill: 'FFFFF2CC', border: 'box', borderColor: 'FFBF9000', numFmt: 'dd/mm/yyyy', align: { h: 'center' } }),
    applied: S.style({ numFmt: 'dd/mm/yyyy', font: { bold: true, color: 'FF1F4E79' }, align: { h: 'center' } }),
    appliedInt: S.style({ numFmt: '#,##0', font: { bold: true, color: 'FF1F4E79' }, align: { h: 'center' } }),
    date: S.style({ numFmt: 'dd/mm/yyyy', border: 'thinBottom', align: { h: 'center' } }),
    link: S.style({ font: { color: 'FF0563C1', underline: true } }),
    dataHead: S.style({ fill: 'FF1F4E79', font: { bold: true, color: 'FFFFFFFF', size: 10 }, align: { wrap: true, v: 'center' } }),
    helperHead: S.style({ fill: 'FFEDEDED', font: { bold: true, color: 'FF595959', size: 10 }, align: { wrap: true, v: 'center' } }),
    editHead: S.style({ fill: 'FFBF9000', font: { bold: true, color: 'FFFFFFFF', size: 10 }, align: { wrap: true, v: 'center' } }),
    dMoney: S.style({ numFmt: '#,##0.00' }),
    dInt: S.style({ numFmt: '#,##0' }),
    dDate: S.style({ numFmt: 'dd/mm/yyyy', align: { h: 'center' } }),
    dTime: S.style({ numFmt: 'dd/mm/yyyy hh:mm:ss', align: { h: 'center' } }),
    edit: S.style({ align: { wrap: true, v: 'top' } }),
    wrap: S.style({ align: { wrap: true, v: 'top' } }),
    h2: S.style({ font: { name: 'Aptos Display', size: 13, bold: true, color: 'FF1F4E79' } }),
  };

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

  // ── Layouts (known before writing, so the Summary can reference every range) ──
  const docCols: Col[] = [
    { id: 'key', header: L.cols.key, width: 30 },
    { id: 'date', header: fieldLabel(config.fields.date), width: 12 },
    ...otherKeyFields.map((f) => ({ id: `k_${f}`, header: fieldLabel(f), width: 11 })),
    { id: 'origin', header: L.cols.origin, width: 13 },
    { id: 'accLines', header: L.cols.accountingLines, width: 10 },
    { id: 'compLines', header: L.cols.complementLines, width: 11 },
    { id: 'delLines', header: L.cols.deletedLines, width: 10 },
    { id: 'chLines', header: L.cols.changedLines, width: 10 },
    { id: 'debitRec', header: L.cols.debitRecorded, width: 15 },
    { id: 'creditRec', header: L.cols.creditRecorded, width: 15 },
    { id: 'diffRec', header: L.cols.diffRecorded, width: 14 },
    { id: 'debitCur', header: L.cols.debitCurrent, width: 15 },
    { id: 'creditCur', header: L.cols.creditCurrent, width: 15 },
    { id: 'diffCur', header: L.cols.diffCurrent, width: 14 },
    { id: 'base', header: L.cols.base, width: 12 },
    { id: 'excluded', header: L.cols.excluded, width: 10 },
    { id: 'unbalanced', header: L.cols.unbalanced, width: 13 },
    { id: 'firstDel', header: L.cols.firstDeletion, width: 19 },
    { id: 'lastDel', header: L.cols.lastDeletion, width: 19 },
    ...sources.map((s) => ({ id: `ch_${s}`, header: lastChangeHeader(s), width: 21 })),
    { id: 'firstPost', header: L.cols.firstPosting, width: 19 },
    { id: 'delJust', header: L.cols.deletionJust, width: 40 },
    { id: 'delStatus', header: L.cols.deletionStatus, width: 18 },
    { id: 'chJust', header: L.cols.changeJust, width: 40 },
    { id: 'chStatus', header: L.cols.changeStatus, width: 18 },
    { id: 'delInP', header: L.cols.deletedInPeriod, width: 12 },
    { id: 'chInP', header: L.cols.changedInPeriod, width: 12 },
    { id: 'pendInP', header: L.cols.pendingInPeriod, width: 12 },
  ];
  const DOC = new Layout(L.sheets.documents, docCols, docs.length);

  const linCols: Col[] = [
    { id: 'key', header: L.cols.key, width: 30 },
    { id: 'recno', header: L.cols.recno, width: 10 },
    { id: 'date', header: fieldLabel(config.fields.date), width: 12 },
    ...otherKeyFields.map((f) => ({ id: `k_${f}`, header: fieldLabel(f), width: 11 })),
    { id: 'line', header: fieldLabel(config.fields.line), width: 7 },
    { id: 'origin', header: L.cols.origin, width: 14 },
    { id: 'nature', header: L.cols.nature, width: 16 },
    { id: 'lineType', header: L.cols.lineType, width: 12 },
    { id: 'value', header: L.cols.value, width: 14 },
    { id: 'debit', header: L.cols.debit, width: 14 },
    { id: 'credit', header: L.cols.credit, width: 14 },
    ...extraFields.map((f) => ({ id: `x_${f}`, header: fieldLabel(f), width: f === config.fields.value ? 14 : 22 })),
    { id: 'status', header: L.cols.status, width: 10 },
    { id: 'insUser', header: L.cols.insertUser, width: 16 },
    { id: 'insTime', header: L.cols.insertTime, width: 19 },
    { id: 'delUser', header: L.cols.deleteUser, width: 16 },
    { id: 'delTime', header: L.cols.deleteTime, width: 19 },
    { id: 'changes', header: L.cols.changes, width: 10 },
    ...sources.map((s) => ({ id: `ch_${s}`, header: lastChangeHeader(s), width: 21 })),
    { id: 'incons', header: L.cols.inconsistency, width: 13 },
    { id: 'docUnb', header: L.cols.docUnbalanced, width: 14 },
    { id: 'files', header: L.cols.files, width: 22 },
    { id: 'chInP', header: L.cols.changedInPeriod, width: 12 },
  ];
  const LIN = new Layout(L.sheets.lines, linCols, baseOrder.length);

  const justCols = (kind: JustificationKind): Col[] => [
    { id: 'key', header: L.cols.key, width: 30 },
    { id: 'status', header: L.cols.status, width: 22 },
    { id: 'text', header: kind === 'deletion' ? L.cols.deletionJust : L.cols.changeJust, width: 60 },
    { id: 'responsible', header: L.cols.responsible, width: 18 },
    { id: 'note', header: L.cols.note, width: 34 },
    { id: 'confirm', header: L.cols.confirmNew, width: 13 },
    { id: 'date', header: fieldLabel(config.fields.date), width: 12 },
    { id: 'origin', header: L.cols.origin, width: 13 },
    { id: 'lines', header: kind === 'deletion' ? L.cols.deletedLines : L.cols.changedLines, width: 10 },
    ...(kind === 'deletion'
      ? [
          { id: 'firstDel', header: L.cols.firstDeletion, width: 19 },
          { id: 'lastDel', header: L.cols.lastDeletion, width: 19 },
        ]
      : []),
    { id: 'moveFiles', header: L.cols.movementFiles, width: 24 },
    { id: 'lastEvent', header: L.cols.lastEvent, width: 19 },
    { id: 'covFiles', header: L.cols.coveredFiles, width: 24 },
    { id: 'lastCovered', header: L.cols.lastCovered, width: 19 },
    { id: 'moved', header: L.cols.movedAtExport, width: 16 },
  ];
  const JE = new Layout(L.sheets.deletionJust, justCols('deletion'), deletionDocs.length);
  const JA = new Layout(L.sheets.changeJust, justCols('change'), changeDocs.length);

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

  // ════════ Summary ════════
  const sum = w.addSheet(L.sheets.summary, {
    columns: [{ width: 46 }, ...Array.from({ length: 9 }, () => ({ width: 16 }))],
    freeze: { rows: 8, cols: 0 },
    showGridLines: false,
    tabColor: 'FF1F4E79',
  });
  const SUMQ = q(L.sheets.summary);
  const tableLabel = config.table;
  const firstEvent = bounds ? formatDay(bounds.startDay) : '—';
  const lastEvent = bounds ? formatDay(bounds.endDay) : '—';
  sum.row([{ v: fill(L.summary.title, { table: tableLabel }), s: st.title }], { height: 28 });
  sum.merge('A1:J1');
  sum.row([{ v: fill(L.summary.subtitle, { scope: scopeLabel, files: sources.map((s) => names[s]).join(', '), first: firstEvent, last: lastEvent }), s: st.subtitle }]);
  sum.merge('A2:J2');
  sum.row([{ v: fill(L.summary.generated, { when: input.generatedAt, version: input.appVersion }), s: st.muted }]);
  sum.merge('A3:J3');
  const failed = input.confirmedFailures;
  sum.row(
    [
      {
        v: failed.length ? fill(L.summary.failBanner, { n: failed.length, list: failed.map((c) => c.label).join('; ') }) : L.summary.okBanner,
        s: failed.length ? st.fail : st.ok,
      },
    ],
    { height: failed.length ? 34 : 20 },
  );
  sum.merge('A4:J4');
  sum.skip(1);
  sum.row([{ v: L.summary.filter, s: st.section }], { height: 20 });
  sum.merge('A6:J6');
  sum.row([L.summary.period, L.summary.customStart, L.summary.customEnd, L.summary.cutoff, L.summary.appliedStart, L.summary.appliedEnd, L.summary.days].map((v) => ({ v, s: st.head })), { height: 30 });
  sum.row([
    { v: V.fullLog, s: st.input },
    { v: null, s: st.inputDate },
    { v: null, s: st.inputDate },
    cutoff === INVALID_TIME ? { v: null, s: st.inputDate } : dateCell(cutoff, st.inputDate),
    { f: 'DT_INI', s: st.applied },
    { f: 'DT_FIM', s: st.applied },
    { f: 'DT_FIM-DT_INI+1', s: st.appliedInt },
  ]);
  sum.validation({ sqref: 'A8', type: 'list', formula1: `${H}!$A$${PRESET_ROW + 1}:$A$${presetLastRow + 1}` });
  sum.validation({ sqref: 'B8:D8', type: 'date', formula1: 'DATE(1990,1,1)', formula2: 'DATE(2100,12,31)' });
  sum.row([{ v: L.summary.help, s: st.muted }], { height: 30 });
  sum.merge('A9:J9');

  const catRows: { cat: Cat; label: string }[] = [
    { cat: 'deleted', label: L.categories.deleted },
    { cat: 'changed', label: L.categories.changed },
    { cat: 'unbalanced', label: L.categories.unbalanced },
    { cat: 'posted', label: L.categories.posted },
  ];
  const section = (title: string) => {
    sum.skip(1);
    const r = sum.row([{ v: title, s: st.section }], { height: 20 });
    sum.merge(`A${r}:J${r}`);
  };
  const header = (cols: string[]) => sum.row(cols.map((v) => ({ v, s: st.head })), { height: 42 });
  const note = (text: string) => {
    const r = sum.row([{ v: text, s: st.muted }], { height: 30 });
    sum.merge(`A${r}:J${r}`);
  };

  // 1. Categories by origin
  section(L.summary.s1);
  header(L.summary.s1cols);
  const s1Row: Record<Cat, number> = {} as Record<Cat, number>;
  for (const { cat, label } of catRows) {
    s1Row[cat] = sum.row([
      { v: label, s: st.rowLabel },
      { f: countLines(cat, lo(V.manual), 'period'), s: st.int },
      { f: countDocs(cat, doo(V.manual), 'period'), s: st.int },
      { f: sumDebit(cat, lo(V.manual), 'period'), s: st.money },
      { f: countLines(cat, lo(V.automatic), 'period'), s: st.int },
      { f: countDocs(cat, doo(V.automatic), 'period'), s: st.int },
      { f: sumDebit(cat, lo(V.automatic), 'period'), s: st.money },
      { f: countDocs(cat, doo(V.mixed), 'period'), s: st.int },
      { f: countDocs(cat, '', 'period'), s: st.int },
      { f: countLines(cat, lo(V.unidentified), 'period'), s: st.int },
    ]);
  }
  note(L.summary.s1note);

  // 2. Period × other days × full log
  section(L.summary.s2);
  header(L.summary.s2cols);
  for (const { cat, label } of catRows) {
    const r = sum.nextRow;
    sum.row([
      { v: label, s: st.rowLabel },
      { f: countLines(cat, '', 'period'), s: st.int },
      { f: countDocs(cat, '', 'period'), s: st.int },
      { f: sumDebit(cat, '', 'period'), s: st.money },
      { f: `H${r}-B${r}`, s: st.int },
      { f: `I${r}-C${r}`, s: st.int },
      { f: `ROUND(J${r}-D${r},2)`, s: st.money },
      { f: countLines(cat, '', 'full'), s: st.int },
      { f: countDocs(cat, '', 'full'), s: st.int },
      { f: sumDebit(cat, '', 'full'), s: st.money },
    ]);
  }

  // 3. Composition by accounting date
  section(L.summary.s3);
  header(L.summary.s3cols);
  const lineDate = (op: string) => `,${LIN.range('date')},${op === '' ? '""' : `"${op}"&CORTE`}`;
  const docDate = (op: string) => `,${DOC.range('date')},${op === '' ? '""' : `"${op}"&CORTE`}`;
  for (const { cat, label } of catRows) {
    sum.row([
      { v: label, s: st.rowLabel },
      { f: countLines(cat, identifiedLines, 'period', lineDate('<=')), s: st.int },
      { f: countDocs(cat, '', 'period', docDate('<=')), s: st.int },
      { f: sumDebit(cat, identifiedLines, 'period', lineDate('<=')), s: st.money },
      { f: countLines(cat, identifiedLines, 'period', lineDate('>')), s: st.int },
      { f: countDocs(cat, '', 'period', docDate('>')), s: st.int },
      { f: sumDebit(cat, identifiedLines, 'period', lineDate('>')), s: st.money },
      { f: countLines(cat, identifiedLines, 'period', lineDate('')), s: st.int },
      { f: countDocs(cat, '', 'period', docDate('')), s: st.int },
      { f: countLines(cat, lo(V.unidentified), 'period'), s: st.int },
    ]);
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
    unjustifiedDocuments: `SUM(${DOC.range('pendInP')})`,
    unidentifiedChanges: `COUNTIFS(${LIN.range('origin')},${str(V.unidentified)},${LIN.range('chInP')},1)`,
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
    sum.row([
      { v: texts.label, s: st.rowLabel },
      { f: signalCounts[id], s: st.int },
      { f: `IF(${n}=0,${str(texts.none)},${text})`, s: st.text },
      null,
      null,
      null,
      null,
      null,
      null,
      { f: action, s: st.text },
    ]);
    sum.merge(`C${r}:I${r}`);
    sum.conditional({ sqref: `J${r}`, formula: `$J${r}=${str(V.action)}`, style: { fill: 'FFFCE4D6', font: { bold: true, color: 'FFC00000' } } });
  }
  note(L.summary.s4note);

  // 5. Justification coverage
  section(L.summary.s5);
  header(L.summary.s5cols);
  const coverageRow = (label: string, inP: string, statusCol: string) => {
    const r = sum.nextRow;
    sum.row([
      { v: label, s: st.rowLabel },
      { f: `SUM(${DOC.range(inP)})`, s: st.int },
      { f: `COUNTIFS(${DOC.range(inP)},1,${DOC.range(statusCol)},${str(V.justified)})`, s: st.int },
      { f: `COUNTIFS(${DOC.range(inP)},1,${DOC.range(statusCol)},${str(V.moved)})`, s: st.int },
      { f: `B${r}-C${r}-D${r}`, s: st.int },
      { f: `IF(B${r}=0,"—",C${r}/B${r})`, s: st.pct },
    ]);
  };
  coverageRow(L.summary.s5rows[0]!, 'delInP', 'delStatus');
  coverageRow(L.summary.s5rows[1]!, 'chInP', 'chStatus');
  note(L.summary.s5note);

  // 6. Change cut-off criterion per extraction
  section(L.summary.s6);
  const fileScopes = sources.map((s) => ({ s, stats: result.summary.scopes[s]!.stats }));
  header([L.summary.s6cols[0]!, ...fileScopes.map(({ s }) => `${L.cols.events} — ${names[s]}`), `${L.cols.events} — ${V.total}`, L.summary.s6cols[1]!]);
  const kinds: { key: 'activation' | 'stamp' | 'effective'; label: string; treatment: string }[] = [
    { key: 'activation', label: V.activation, treatment: V.discarded },
    { key: 'stamp', label: V.stamp, treatment: V.discarded },
    { key: 'effective', label: V.effective, treatment: V.considered },
  ];
  const s6First = sum.nextRow;
  const totalCol = colName(fileScopes.length + 1);
  for (const k of kinds) {
    const r = sum.nextRow;
    sum.row([
      { v: k.label, s: st.rowLabel },
      ...fileScopes.map(({ stats }) => ({ v: stats.alterations[k.key], s: st.int })),
      { f: `SUM(B${r}:${colName(fileScopes.length)}${r})`, s: st.int },
      { v: k.treatment, s: st.text },
    ]);
  }
  sum.row([
    { v: L.summary.s6total, s: st.rowLabel },
    ...[...fileScopes, null].map((_, i) => ({ f: `SUM(${colName(i + 1)}${s6First}:${colName(i + 1)}${s6First + 2})`, s: st.int })),
  ]);
  void totalCol;

  // 7. Daily movement (from the helper sheet)
  section(L.summary.s7);
  header(L.summary.s7cols);
  const s7First = sum.nextRow;
  days.forEach((_, i) => {
    const hr = DAILY_FIRST + i;
    sum.row([
      { f: `${H}!A${hr}`, s: st.date },
      { f: `${H}!B${hr}`, s: st.text },
      { f: `${H}!F${hr}`, s: st.int },
      { f: `${H}!G${hr}`, s: st.int },
      { f: `${H}!H${hr}`, s: st.int },
      { f: `${H}!E${hr}`, s: st.int },
      { f: `${H}!I${hr}`, s: st.text },
      { f: `${H}!C${hr}`, s: st.text },
      { f: `${H}!D${hr}`, s: st.text },
    ]);
  });
  if (days.length) {
    const s7Last = s7First + days.length - 1;
    sum.conditional({ sqref: `A${s7First}:I${s7Last}`, formula: `$G${s7First}=${str(V.yes)}`, style: { fill: 'FFDDEBF7' } });
    sum.conditional({ sqref: `A${s7First}:I${s7Last}`, formula: `$H${s7First}=${str(V.no)}`, style: { font: { color: 'FF8C8C8C' } } });
  }

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
    const r = sum.row([{ v: sheet, s: st.link }, { v: L.summary.where[key], s: st.wrap }]);
    sum.merge(`B${r}:J${r}`);
    sum.link({ ref: `A${r}`, location: `${q(sheet)}!A1`, display: sheet });
  }
  sum.end();
  progress();

  // ════════ Justification sheets ════════
  const writeJustifications = (layout: Layout, kind: JustificationKind, list: DocumentInfo[]) => {
    const sheet = w.addSheet(layout.sheet, {
      columns: layout.cols.map((c) => ({ width: c.width })),
      freeze: { rows: 1, cols: 1 },
      autoFilter: `A1:${layout.lastRef}`,
      tabColor: 'FFBF9000',
    });
    sheet.row(
      layout.cols.map((c) => ({ v: c.header, s: ['text', 'responsible', 'confirm'].includes(c.id) ? st.editHead : c.id === 'moved' ? st.helperHead : st.dataHead })),
      { height: 36 },
    );
    const T = layout.letter('text');
    const M = layout.letter('moved');
    const C = layout.letter('confirm');
    for (const d of list) {
      const r = sheet.nextRow;
      const j = justOf(kind, d.key);
      const hasText = !!j && normalizeText(j.text) !== '';
      const status = hasText ? justificationStatus(scope, d, kind, names, j) : 'pending';
      const movement = documentMovement(scope, d, kind);
      const cells: Record<string, CellInput> = {
        key: d.key,
        // Moved after the justification until the user confirms that the text covers the new event.
        status: {
          f: `IF(LEN(TRIM(${T}${r}))=0,${str(V.pending)},IF(AND(${M}${r}=${str(V.yes)},${C}${r}<>${str(V.yes)}),${str(V.moved)},${str(V.justified)}))`,
        },
        text: { v: j?.text ?? '', s: st.edit },
        responsible: j?.responsible ?? '',
        note: { f: `IF(LEN(TRIM(${T}${r}))=0,${str(V.pendingNote)},IF(AND(${M}${r}=${str(V.yes)},${C}${r}<>${str(V.yes)}),${str(V.movedNote)},""))`, s: st.wrap },
        confirm: '',
        date: dateCell(d.entryDay, st.dDate),
        origin: origin(d.origin),
        lines: kind === 'deletion' ? d.deletedLines : d.changedLines,
        firstDel: dateTimeCell(d.firstDeletion, st.dTime),
        lastDel: dateTimeCell(d.lastDeletion, st.dTime),
        moveFiles: movement.files.map((s) => names[s] ?? '').join(FILE_SEPARATOR),
        lastEvent: dateTimeCell(movement.lastEvent, st.dTime),
        covFiles: hasText ? j!.coverage.files.join(FILE_SEPARATOR) : '',
        lastCovered: hasText && j!.coverage.lastEvent !== null ? dateTimeCell(j!.coverage.lastEvent, st.dTime) : null,
        moved: status === 'moved' ? V.yes : V.no,
      };
      sheet.row(layout.cols.map((c) => cells[c.id] ?? null));
    }
    const last = Math.max(2, list.length + 1);
    sheet.conditional({ sqref: `${T}2:${T}${last}`, formula: `LEN(TRIM(${T}2))=0`, style: { fill: 'FFFFF2CC' } });
    sheet.conditional({ sqref: `${C}2:${C}${last}`, formula: `AND(${M}2=${str(V.yes)},${C}2<>${str(V.yes)})`, style: { fill: 'FFFFF2CC' } });
    sheet.validation({ sqref: `${C}2:${C}${last}`, type: 'list', formula1: str(`${V.yes},${V.no}`) });
    const B = layout.letter('status');
    sheet.conditional({ sqref: `${B}2:${B}${last}`, formula: `$${B}2=${str(V.pending)}`, style: { font: { bold: true, color: 'FFC00000' } } });
    sheet.conditional({ sqref: `${B}2:${B}${last}`, formula: `$${B}2=${str(V.moved)}`, style: { font: { bold: true, color: 'FFC65911' } } });
    sheet.end();
  };
  writeJustifications(JE, 'deletion', deletionDocs);
  progress();
  writeJustifications(JA, 'change', changeDocs);
  progress();

  // ════════ Documents ════════
  {
    const sheet = w.addSheet(DOC.sheet, { columns: DOC.cols.map((c) => ({ width: c.width })), freeze: { rows: 1, cols: 1 }, autoFilter: `A1:${DOC.lastRef}` });
    const helperIds = new Set(['delInP', 'chInP', 'pendInP']);
    sheet.row(DOC.cols.map((c) => ({ v: c.header, s: helperIds.has(c.id) ? st.helperHead : st.dataHead })), { height: 42 });
    const X = (id: string) => DOC.letter(id);
    const jeKey = JE.range('key');
    const jaKey = JA.range('key');
    const inP = (col: string, r: number) => `AND(${col}${r}<>"",${col}${r}>=DT_INI,${col}${r}<DT_FIM+1)`;
    for (const d of docs) {
      const r = sheet.nextRow;
      const cells: Record<string, CellInput> = {
        key: d.key,
        date: dateCell(d.entryDay, st.dDate),
        origin: origin(d.origin),
        accLines: d.accountingLines,
        compLines: d.complementLines,
        delLines: d.deletedLines,
        chLines: d.changedLines,
        debitRec: { v: d.debitRecorded / 100, s: st.dMoney },
        creditRec: { v: d.creditRecorded / 100, s: st.dMoney },
        diffRec: { f: `ROUND(${X('debitRec')}${r}-${X('creditRec')}${r},2)`, s: st.dMoney },
        debitCur: { v: d.debitCurrent / 100, s: st.dMoney },
        creditCur: { v: d.creditCurrent / 100, s: st.dMoney },
        diffCur: { f: `ROUND(${X('debitCur')}${r}-${X('creditCur')}${r},2)`, s: st.dMoney },
        base: d.base === 'complete' ? V.complete : V.partial,
        excluded: { no: V.no, total: V.total, partial: V.partial }[d.excluded],
        unbalanced: unbalanced(d.unbalanced),
        firstDel: dateTimeCell(d.firstDeletion, st.dTime),
        lastDel: dateTimeCell(d.lastDeletion, st.dTime),
        firstPost: dateTimeCell(d.firstPosting, st.dTime),
        delJust: { f: `IF(${X('delLines')}${r}=0,"",IFERROR(INDEX(${JE.range('text')},MATCH($A${r},${jeKey},0))&"",""))`, s: st.wrap },
        delStatus: { f: `IF(${X('delLines')}${r}=0,${str(V.none)},IFERROR(INDEX(${JE.range('status')},MATCH($A${r},${jeKey},0))&"",${str(V.pending)}))` },
        chJust: { f: `IF(${X('chLines')}${r}=0,"",IFERROR(INDEX(${JA.range('text')},MATCH($A${r},${jaKey},0))&"",""))`, s: st.wrap },
        chStatus: { f: `IF(${X('chLines')}${r}=0,${str(V.none)},IFERROR(INDEX(${JA.range('status')},MATCH($A${r},${jaKey},0))&"",${str(V.pending)}))` },
        delInP: { f: `IF(${inP(X('firstDel'), r)},1,0)` },
        chInP: { f: `IF(${sources.length ? `OR(${sources.map((s) => inP(X(`ch_${s}`), r)).join(',')})` : 'FALSE'},1,0)` },
        pendInP: {
          f: `IF(OR(AND(${X('delInP')}${r}=1,${X('delStatus')}${r}<>${str(V.justified)}),AND(${X('chInP')}${r}=1,${X('chStatus')}${r}<>${str(V.justified)})),1,0)`,
        },
      };
      otherKeyFields.forEach((f) => (cells[`k_${f}`] = d.keyParts[keyFields.indexOf(f)] ?? ''));
      sources.forEach((s) => (cells[`ch_${s}`] = dateTimeCell(d.lastChangeBySource[s]!, st.dTime)));
      sheet.row(DOC.cols.map((c) => cells[c.id] ?? null));
    }
    sheet.end();
  }
  progress();

  // ════════ Lines (Base_Linhas) ════════
  const docOfRecord = (r: RecordInfo) => (r.documentIndex >= 0 ? docs[r.documentIndex]! : null);
  {
    const sheet = w.addSheet(LIN.sheet, { columns: LIN.cols.map((c) => ({ width: c.width })), freeze: { rows: 1, cols: 2 }, autoFilter: `A1:${LIN.lastRef}` });
    sheet.row(LIN.cols.map((c) => ({ v: c.header, s: c.id === 'chInP' ? st.helperHead : st.dataHead })), { height: 42 });
    const X = (id: string) => LIN.letter(id);
    const inP = (col: string, r: number) => `AND(${col}${r}<>"",${col}${r}>=DT_INI,${col}${r}<DT_FIM+1)`;
    for (const index of baseOrder) {
      const rec = records[index]!;
      const r = sheet.nextRow;
      const doc = docOfRecord(rec);
      const cells: Record<string, CellInput> = {
        key: rec.documentKey,
        recno: rec.recno,
        date: dateCell(rec.entryDay, st.dDate),
        line: val(rec, config.fields.line),
        origin: origin(rec.origin),
        nature: natureLabel(rec.nature),
        lineType: lineType(rec.lineType),
        value: { v: cents(rec.valueCents), s: st.dMoney },
        debit: { v: rec.valueCents === null ? null : rec.debitCents / 100, s: st.dMoney },
        credit: { v: rec.valueCents === null ? null : rec.creditCents / 100, s: st.dMoney },
        status: rec.deleted ? V.deleted : V.active,
        insUser: rec.included ? userName(rec.inclusionUser) : '',
        insTime: rec.included ? dateTimeCell(rec.inclusionTime, st.dTime) : null,
        delUser: rec.deleted ? userName(rec.deletionUser) : '',
        delTime: rec.deleted ? dateTimeCell(rec.deletionTime, st.dTime) : null,
        changes: rec.changeCount,
        incons: { no: V.no, pending: V.pending, corrected: V.corrected }[rec.inconsistency],
        docUnb: doc ? unbalanced(doc.unbalanced) : V.none,
        files: rec.sources.map((s) => names[s] ?? '').join(FILE_SEPARATOR),
        chInP: { f: `IF(${sources.length ? `OR(${sources.map((s) => inP(X(`ch_${s}`), r)).join(',')})` : 'FALSE'},1,0)` },
      };
      otherKeyFields.forEach((f) => (cells[`k_${f}`] = val(rec, f)));
      extraFields.forEach((f) => (cells[`x_${f}`] = val(rec, f)));
      sources.forEach((s) => (cells[`ch_${s}`] = dateTimeCell(rec.lastChangeBySource[s]!, st.dTime)));
      sheet.row(LIN.cols.map((c) => cells[c.id] ?? null));
    }
    sheet.end();
  }
  progress();

  // ════════ Deletions, changes, unbalanced, discarded ════════
  const simpleSheet = (name: string, cols: Col[], rows: Record<string, CellInput>[], freezeCols = 0) => {
    const sheet = w.addSheet(name, {
      columns: cols.map((c) => ({ width: c.width })),
      freeze: { rows: 1, cols: freezeCols },
      autoFilter: `A1:${colName(cols.length - 1)}${rows.length + 1}`,
    });
    sheet.row(cols.map((c) => ({ v: c.header, s: st.dataHead })), { height: 36 });
    let n = 0;
    for (const row of rows) {
      sheet.row(cols.map((c) => row[c.id] ?? null));
      n++;
    }
    return { sheet, n };
  };
  const keyCells = (rec: RecordInfo): Record<string, CellInput> => {
    const c: Record<string, CellInput> = { key: rec.documentKey, date: dateCell(rec.entryDay, st.dDate), line: val(rec, config.fields.line), recno: rec.recno, origin: origin(rec.origin) };
    otherKeyFields.forEach((f) => (c[`k_${f}`] = val(rec, f)));
    return c;
  };
  const keyCols: Col[] = [
    { id: 'key', header: L.cols.key, width: 30 },
    { id: 'date', header: fieldLabel(config.fields.date), width: 12 },
    ...otherKeyFields.map((f) => ({ id: `k_${f}`, header: fieldLabel(f), width: 11 })),
    { id: 'line', header: fieldLabel(config.fields.line), width: 7 },
    { id: 'recno', header: L.cols.recno, width: 10 },
    { id: 'origin', header: L.cols.origin, width: 14 },
  ];
  {
    const cols: Col[] = [
      { id: 'delTime', header: L.cols.deleteTime, width: 19 },
      { id: 'delUser', header: L.cols.deleteUser, width: 16 },
      ...keyCols,
      { id: 'nature', header: L.cols.nature, width: 16 },
      { id: 'value', header: L.cols.value, width: 14 },
      { id: 'debit', header: L.cols.debit, width: 14 },
      { id: 'credit', header: L.cols.credit, width: 14 },
      ...extraFields.map((f) => ({ id: `x_${f}`, header: fieldLabel(f), width: 22 })),
      { id: 'insUser', header: L.cols.insertUser, width: 16 },
      { id: 'insTime', header: L.cols.insertTime, width: 19 },
      { id: 'file', header: L.cols.file, width: 18 },
    ];
    const res = simpleSheet(
      L.sheets.deletions,
      cols,
      deletedRecords.map((rec) => {
        const c = keyCells(rec);
        extraFields.forEach((f) => (c[`x_${f}`] = val(rec, f)));
        return {
          ...c,
          delTime: dateTimeCell(rec.deletionTime, st.dTime),
          delUser: userName(rec.deletionUser),
          nature: natureLabel(rec.nature),
          value: { v: cents(rec.valueCents), s: st.dMoney },
          debit: { v: rec.valueCents === null ? null : rec.debitCents / 100, s: st.dMoney },
          credit: { v: rec.valueCents === null ? null : rec.creditCents / 100, s: st.dMoney },
          insUser: rec.included ? userName(rec.inclusionUser) : '',
          insTime: rec.included ? dateTimeCell(rec.inclusionTime, st.dTime) : null,
          file: names[rec.deletionSource] ?? '',
        };
      }),
    );
    res.sheet.end();
  }
  progress();
  {
    const d = scope.log.details;
    const recordByRecno = new Map(records.map((r) => [r.recno, r]));
    const cols: Col[] = [
      { id: 'time', header: L.cols.time, width: 19 },
      { id: 'user', header: L.cols.user, width: 16 },
      ...keyCols,
      { id: 'field', header: L.cols.field, width: 13 },
      { id: 'fieldLabel', header: L.cols.fieldLabel, width: 22 },
      { id: 'oldValue', header: L.cols.oldValue, width: 30 },
      { id: 'newValue', header: L.cols.newValue, width: 30 },
      { id: 'lineValue', header: L.cols.lineValue, width: 14 },
      { id: 'current', header: L.cols.currentStatus, width: 11 },
      { id: 'file', header: L.cols.file, width: 18 },
    ];
    const res = simpleSheet(
      L.sheets.changes,
      cols,
      scope.effectiveChangeRows.map((row) => {
        const rec = recordByRecno.get(d.recno[row]!)!;
        const field = dict.get(d.field[row]!);
        return {
          ...keyCells(rec),
          time: dateTimeCell(d.dateTime[row]!, st.dTime),
          user: userName(d.user[row]!),
          field,
          fieldLabel: fieldLabel(field),
          oldValue: dict.get(d.oldVal[row]!),
          newValue: dict.get(d.newVal[row]!),
          lineValue: { v: cents(rec.valueCents), s: st.dMoney },
          current: rec.deleted ? V.deleted : V.active,
          file: names[d.source[row]!] ?? '',
        };
      }),
    );
    res.sheet.end();
  }
  progress();
  {
    const cols: Col[] = [
      ...keyCols,
      { id: 'nature', header: L.cols.nature, width: 16 },
      { id: 'value', header: L.cols.value, width: 14 },
      { id: 'debit', header: L.cols.debit, width: 14 },
      { id: 'credit', header: L.cols.credit, width: 14 },
      { id: 'status', header: L.cols.status, width: 10 },
      { id: 'docDiffRec', header: L.cols.docDiffRecorded, width: 16 },
      { id: 'docDiffCur', header: L.cols.docDiffCurrent, width: 16 },
      { id: 'insUser', header: L.cols.insertUser, width: 16 },
      { id: 'insTime', header: L.cols.insertTime, width: 19 },
      ...extraFields.map((f) => ({ id: `x_${f}`, header: fieldLabel(f), width: 22 })),
    ];
    const res = simpleSheet(
      L.sheets.unbalanced,
      cols,
      unbalancedLines.map(({ d, r: rec }) => {
        const c = keyCells(rec);
        extraFields.forEach((f) => (c[`x_${f}`] = val(rec, f)));
        return {
          ...c,
          nature: natureLabel(rec.nature),
          value: { v: cents(rec.valueCents), s: st.dMoney },
          debit: { v: rec.valueCents === null ? null : rec.debitCents / 100, s: st.dMoney },
          credit: { v: rec.valueCents === null ? null : rec.creditCents / 100, s: st.dMoney },
          status: rec.deleted ? V.deleted : V.active,
          docDiffRec: { v: (d.debitRecorded - d.creditRecorded) / 100, s: st.dMoney },
          docDiffCur: { v: (d.debitCurrent - d.creditCurrent) / 100, s: st.dMoney },
          insUser: rec.included ? userName(rec.inclusionUser) : '',
          insTime: rec.included ? dateTimeCell(rec.inclusionTime, st.dTime) : null,
        };
      }),
    );
    res.sheet.end();
  }
  progress();
  {
    const d = scope.log.details;
    const cols: Col[] = [
      { id: 'key', header: L.cols.key, width: 30 },
      { id: 'recno', header: L.cols.recno, width: 10 },
      { id: 'origin', header: L.cols.origin, width: 14 },
      { id: 'kind', header: L.cols.kind, width: 24 },
      { id: 'field', header: L.cols.field, width: 13 },
      { id: 'oldValue', header: L.cols.oldValue, width: 24 },
      { id: 'newValue', header: L.cols.newValue, width: 24 },
      { id: 'user', header: L.cols.user, width: 16 },
      { id: 'time', header: L.cols.time, width: 19 },
      { id: 'file', header: L.cols.file, width: 18 },
    ];
    const res = simpleSheet(
      L.sheets.discardedDetail,
      cols,
      discardedRows.map(({ e, row }) => {
        const rec = records[e.recordIndex]!;
        return {
          key: rec.documentKey,
          recno: e.recno,
          origin: origin(rec.origin),
          kind: e.kind === 'activation' ? V.activation : V.stamp,
          field: dict.get(d.field[row]!),
          oldValue: dict.get(d.oldVal[row]!),
          newValue: dict.get(d.newVal[row]!),
          user: userName(e.user),
          time: dateTimeCell(e.time, st.dTime),
          file: names[d.source[row]!] ?? '',
        };
      }),
    );
    res.sheet.end();
  }
  progress();
  {
    // Discarded (and effective) events by kind, file and user.
    const d = scope.log.details;
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
    const cols: Col[] = [
      { id: 'kind', header: L.cols.kind, width: 28 },
      { id: 'file', header: L.cols.file, width: 20 },
      { id: 'user', header: L.cols.user, width: 20 },
      { id: 'events', header: L.cols.events, width: 12 },
      { id: 'records', header: L.cols.records, width: 12 },
    ];
    const sheet = w.addSheet(L.sheets.discardedSummary, { columns: cols.map((c) => ({ width: c.width })), freeze: { rows: 1, cols: 0 } });
    sheet.row(cols.map((c) => ({ v: c.header, s: st.dataHead })), { height: 30 });
    for (const g of list) sheet.row([g.kind, g.file, g.user, { v: g.events, s: st.dInt }, { v: g.records.size, s: st.dInt }]);
    const last = list.length + 1;
    sheet.skip(1);
    for (const kind of order) {
      for (const s of sources) {
        const file = names[s] ?? '';
        sheet.row([
          { v: `${V.total} — ${kind}`, s: st.rowLabel },
          { v: file, s: st.rowLabel },
          null,
          { f: `SUMIFS($D$2:$D$${Math.max(2, last)},$A$2:$A$${Math.max(2, last)},${str(kind)},$B$2:$B$${Math.max(2, last)},${str(file)})`, s: st.int },
        ]);
      }
    }
    sheet.end();
  }
  progress();

  // ════════ Criteria ════════
  {
    const sheet = w.addSheet(L.sheets.criteria, { columns: [{ width: 120 }], showGridLines: false });
    sheet.row([{ v: L.criteria.title, s: st.title }], { height: 28 });
    const stats = scope.stats;
    const u = stats.unidentified;
    const tol = (config.balanceToleranceCents / 100).toFixed(2);
    const paragraphs =
      language === 'pt'
        ? [
            ['Fonte', `Relatório CFGR700 do TOTVS Protheus, tabela ${config.table}. Arquivos: ${sources.map((s) => names[s]).join(', ')}. Eventos de ${firstEvent} a ${lastEvent}. Escopo: ${scopeLabel}.`],
            ['Linhas do relatório', 'Cabeçalhos repetidos e linhas em branco (inclusive linhas ausentes no XML) são separados das linhas de detalhe; a reconciliação de cada arquivo está na Rastreabilidade.'],
            ['Evento e registro', 'Evento = linhas com o mesmo Recno, Operação, Usuário e Data/hora. Registro = estado final de cada Recno: o último valor de cada campo pela data/hora e pela ordem de leitura; na exclusão vale o valor antigo.'],
            ['Documento e origem', `Chave ${keyFields.join('|')}. Origem Manual (${config.origin.field} = ${config.origin.manual.join('/')}), Automático (${config.origin.automatic.join('/')}), Misto quando o documento tem as duas. "${V.unidentified}" quando a origem não aparece no log.`],
            ['Alterações', `Eventos só com ${config.balanceType.field} ${config.balanceType.expectedFrom} → ${config.balanceType.expectedTo} (efetivação) ou só com carimbo de usuário são descartados. Qualquer outra alteração — inclusive outra transição de ${config.balanceType.field} — é efetiva.`],
            ['Desbalanceado', `|débito − crédito| ≥ R$ ${tol} no registrado (todas as linhas) ou no vigente (linhas não excluídas). "Não avaliável" quando alguma linha do documento não tem inclusão no log (base parcial).`],
            ['Período', 'Pela data do evento. Exclusões e postagens contam o documento no período do primeiro evento; alterações usam a data de cada arquivo (um registro alterado em dois arquivos aparece nos dois períodos).'],
            ['Competência', 'A data contábil (CT2_DATA) de cada linha e de cada documento é comparada com a data de corte informada no Resumo.'],
            ['Justificativas', 'Uma por documento e por tipo (exclusão, alteração). A cobertura (arquivos e último evento) fica nas abas de justificativa; "movimentado após a justificativa" indica movimento posterior num arquivo não coberto.'],
            ['Limitações', `O log contém apenas o que foi movimentado no intervalo extraído — não é a população da razão. Com "Exclui campos não alterados = Sim", alterações trazem só o campo modificado: há documentos de base parcial (${stats.partialBaseDocuments}) e registros não identificados (${stats.unidentifiedRecords}: ${u.contentChange} com alteração de conteúdo, ${u.onlyActivation} só efetivação, ${u.onlyStamp} só carimbo). Estes podem ser associados a documentos consultando a CT2 pelo Recno.`],
            ['Planilha', 'Valores em reais. Datas gravadas como datas do Excel. As fórmulas recalculam ao abrir; campos em amarelo são editáveis.'],
          ]
        : [
            ['Source', `CFGR700 report of TOTVS Protheus, table ${config.table}. Files: ${sources.map((s) => names[s]).join(', ')}. Events from ${firstEvent} to ${lastEvent}. Scope: ${scopeLabel}.`],
            ['Report rows', 'Repeated headers and blank rows (including rows missing from the XML) are separated from detail rows; the reconciliation of each file is in Traceability.'],
            ['Event and record', 'Event = rows with the same Recno, Operation, User and Time. Record = final state of each Recno: the last value of each field by time and reading order; for deletions, the old value.'],
            ['Document and origin', `Key ${keyFields.join('|')}. Manual origin (${config.origin.field} = ${config.origin.manual.join('/')}), Automatic (${config.origin.automatic.join('/')}), Mixed when the document has both. "${V.unidentified}" when the origin does not appear in the log.`],
            ['Changes', `Events with only ${config.balanceType.field} ${config.balanceType.expectedFrom} → ${config.balanceType.expectedTo} (activation) or only the user stamp are discarded. Any other change — including another ${config.balanceType.field} transition — is effective.`],
            ['Unbalanced', `|debit − credit| ≥ ${tol} in the recorded amounts (all lines) or current amounts (lines not deleted). "Not evaluable" when a line of the document has no insert in the log (partial basis).`],
            ['Period', 'By event date. Deletions and postings count the document in the period of its first event; changes use the date of each file (a record changed in two files appears in both periods).'],
            ['Accrual', 'The accounting date (CT2_DATA) of each line and document is compared with the cutoff date typed in the Summary.'],
            ['Justifications', 'One per document and kind (deletion, change). The coverage (files and last event) is in the justification sheets; "moved after the justification" means a later movement in a file not covered.'],
            ['Limitations', `The log holds only what moved in the extracted interval — it is not the ledger population. With "Exclude unchanged fields = Yes", changes bring only the modified field: there are partial-basis documents (${stats.partialBaseDocuments}) and unidentified records (${stats.unidentifiedRecords}: ${u.contentChange} with content changes, ${u.onlyActivation} activation only, ${u.onlyStamp} stamp only). They can be matched to documents by querying CT2 by Recno.`],
            ['Workbook', 'Dates stored as Excel dates. Formulas recalculate on open; yellow cells are editable.'],
          ];
    for (const [title, text] of paragraphs as [string, string][]) {
      sheet.skip(1);
      sheet.row([{ v: title, s: st.h2 }]);
      sheet.row([{ v: text, s: st.wrap }], { height: Math.min(120, 18 * Math.ceil(text.length / 130)) });
    }
    sheet.skip(1);
    sheet.row([{ v: language === 'pt' ? 'Dicionário de campos' : 'Field dictionary', s: st.h2 }]);
    for (const f of config.fields.keep) sheet.row([`${f} — ${fieldLabel(f)}`]);
    sheet.end();
  }
  progress();

  // ════════ Traceability ════════
  {
    const T = L.trace;
    const sheet = w.addSheet(L.sheets.trace, { columns: [{ width: 34 }, { width: 18 }, { width: 66 }, ...Array.from({ length: 14 }, () => ({ width: 14 }))], showGridLines: false });
    sheet.row([{ v: T.title, s: st.title }], { height: 28 });
    const kv = (k: string, v: CellInput) => sheet.row([{ v: k, s: st.rowLabel }, v]);
    sheet.skip(1);
    kv(T.tool, 'AuditAnalyzer');
    kv(T.version, input.appVersion);
    kv(T.generated, input.generatedAt);
    kv(T.language, language === 'pt' ? 'Português' : 'English');
    kv(T.scope, scopeLabel);
    kv(T.configHash, input.configHash);
    kv(T.cutoff, cutoff === INVALID_TIME ? '—' : formatDay(cutoff));
    kv(T.holidays, holidays.map(formatDay).join(', ') || '—');
    kv(T.presets, context.userPresets.map((p) => `${p.label} (${formatDay(p.period.startDay)} a ${formatDay(p.period.endDay)})`).join('; ') || '—');
    if (failed.length) {
      sheet.skip(1);
      const r = sheet.row([{ v: fill(T.confirmed, { when: input.generatedAt }), s: st.fail }]);
      sheet.merge(`A${r}:F${r}`);
    }
    sheet.skip(1);
    sheet.row([{ v: T.files, s: st.h2 }]);
    sheet.row(T.fileCols.map((v) => ({ v, s: st.head })), { height: 30 });
    for (const s of sources) {
      const f = files[s]!;
      const ev = Object.fromEntries(f.events.map((e) => [e.operation, e.count]));
      sheet.row([
        f.name,
        { v: f.size, s: st.dInt },
        f.sha256,
        f.firstEvent === null ? null : dateTimeCell(f.firstEvent, st.dTime),
        f.lastEvent === null ? null : dateTimeCell(f.lastEvent, st.dTime),
        f.rows.totalRows,
        f.rows.rowsAfterHeader,
        f.rows.repeatedHeaders,
        f.rows.blankRows,
        f.rows.detailRows,
        f.rows.balanced ? T.passed : T.failed,
        ev[config.operations.insert] ?? 0,
        ev[config.operations.update] ?? 0,
        ev[config.operations.delete] ?? 0,
        ev[config.operations.restore] ?? 0,
        f.totalEvents,
        `${f.entries.filter((e) => e.ok).length}/${f.entries.length}`,
      ]);
    }
    sheet.skip(1);
    sheet.row([{ v: T.params, s: st.h2 }]);
    sheet.row(T.paramCols.map((v) => ({ v, s: st.head })));
    for (const s of sources) {
      for (const p of files[s]!.parameters) sheet.row([files[s]!.name, p.question ?? '', p.label, p.value]);
    }
    sheet.skip(1);
    sheet.row([{ v: T.checks, s: st.h2 }]);
    sheet.row(T.checkCols.map((v) => ({ v, s: st.head })));
    for (const c of result.reconciliation.checks) {
      sheet.row([c.label, c.severity === 'error' ? T.blocking : T.warning, c.passed ? T.passed : T.failed, { v: c.message, s: st.wrap }]);
    }
    sheet.skip(1);
    sheet.row([{ v: T.justifications, s: st.h2 }]);
    sheet.row(T.justCols.map((v) => ({ v, s: st.head })));
    for (const [kind, list] of [['deletion', deletionDocs], ['change', changeDocs]] as const) {
      const counts = { justified: 0, moved: 0, pending: 0 };
      for (const d of list) counts[justificationStatus(scope, d, kind, names, justOf(kind, d.key))]++;
      sheet.row([L.kinds[kind], list.length, counts.justified, counts.moved, counts.pending]);
    }
    sheet.row([{ v: T.coverageNote, s: st.muted }]);
    sheet.end();
  }
  progress();

  // ════════ Helper ════════
  {
    const sheet = w.addSheet(L.sheets.helper, {
      columns: [{ width: 34 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 11 }],
      tabColor: 'FF8C8C8C',
    });
    const HL = L.helper;
    sheet.row([{ v: HL.title, s: st.title }], { height: 28 });
    sheet.skip(1);
    sheet.row([{ v: HL.param, s: st.head }, { v: HL.value, s: st.head }]);
    const presetStart = `$B$${PRESET_ROW + 1}:$B$${presetLastRow + 1}`;
    const presetEnd = `$C$${PRESET_ROW + 1}:$C$${presetLastRow + 1}`;
    const presetNames = `$A$${PRESET_ROW + 1}:$A$${presetLastRow + 1}`;
    sheet.row([HL.appliedStart, { f: `IF(${SUMQ}!$A$8=${str(V.custom)},${SUMQ}!$B$8,IFERROR(INDEX(${presetStart},MATCH(${SUMQ}!$A$8,${presetNames},0)),$B$7))`, s: st.dDate }]); // row 4
    sheet.row([HL.appliedEnd, { f: `IF(${SUMQ}!$A$8=${str(V.custom)},${SUMQ}!$C$8,IFERROR(INDEX(${presetEnd},MATCH(${SUMQ}!$A$8,${presetNames},0)),$B$8))`, s: st.dDate }]); // row 5
    sheet.row([HL.cutoff, { f: `IF(ISNUMBER(${SUMQ}!$D$8),${SUMQ}!$D$8,${cutoff === INVALID_TIME ? 0 : cutoff + EXCEL_SERIAL_2000})`, s: st.dDate }]); // row 6
    sheet.row([HL.logFirst, bounds ? dateCell(bounds.startDay, st.dDate) : null]); // row 7
    sheet.row([HL.logLast, bounds ? dateCell(bounds.endDay, st.dDate) : null]); // row 8
    w.defineName('DT_INI', `${H}!$B$4`);
    w.defineName('DT_FIM', `${H}!$B$5`);
    w.defineName('CORTE', `${H}!$B$6`);
    sheet.skip(1);
    // Presets (row 11 = title, 12 = header).
    sheet.row([{ v: HL.presets, s: st.h2 }, null, null, { v: HL.holidays, s: st.h2 }]);
    sheet.row([...HL.presetCols.map((v) => ({ v, s: st.head })), { v: HL.holidays, s: st.head }]);
    const presetRows = presets.map((p) => [p.label, dateCell(p.period.startDay, st.dDate), dateCell(p.period.endDay, st.dDate)] as CellInput[]);
    presetRows.push([V.custom, { f: `${SUMQ}!$B$8`, s: st.dDate }, { f: `${SUMQ}!$C$8`, s: st.dDate }]);
    const helperRows = Math.max(presetRows.length, holidays.length);
    for (let i = 0; i < helperRows; i++) {
      const pr = presetRows[i] ?? [null, null, null];
      sheet.row([...pr, holidays[i] !== undefined ? dateCell(holidays[i]!, st.dDate) : null]);
    }
    // Daily table.
    while (sheet.nextRow < DAILY_HEAD - 1) sheet.skip(1);
    sheet.row([{ v: HL.daily, s: st.h2 }]);
    sheet.row(
      [L.summary.s7cols[0]!, L.summary.s7cols[1]!, L.summary.s7cols[7]!, L.summary.s7cols[8]!, L.summary.s7cols[5]!, L.summary.s7cols[2]!, L.summary.s7cols[3]!, L.summary.s7cols[4]!, L.summary.s7cols[6]!].map(
        (v) => ({ v, s: st.head }),
      ),
      { height: 30 },
    );
    const holidaySet = new Set(holidays);
    days.forEach((day) => {
      const r = sheet.nextRow;
      const covered = requested.some((p) => day >= p.startDay && day <= p.endDay);
      const crit = (range: string) => `${range},">="&$A${r},${range},"<"&($A${r}+1)`;
      sheet.row([
        dateCell(day, st.dDate),
        V.weekdays[weekday(day)]!,
        isBusinessDay(day, holidaySet) ? V.yes : V.no,
        covered ? V.yes : V.no,
        { v: events.get(day) ?? 0, s: st.dInt },
        { f: `COUNTIFS(${crit(LIN.range('insTime'))})`, s: st.dInt },
        { f: `COUNTIFS(${crit(LIN.range('delTime'))})`, s: st.dInt },
        { f: sumOf(sources.map((s) => `COUNTIFS(${crit(LIN.range(`ch_${s}`))})`)) || '0', s: st.dInt },
        { f: `IF(AND($A${r}>=DT_INI,$A${r}<=DT_FIM),${str(V.yes)},${str(V.no)})` },
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

