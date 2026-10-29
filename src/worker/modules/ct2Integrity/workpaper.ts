/**
 * The CT2 integrity workpaper (docs/REGRAS_CT2_INTEGRIDADE.md, section 7): the Base as values, everything derived as
 * formulas in a chain (Base → Documentos → Lotes → Dias → Resumo), over the contiguous blocks of the Base order
 * (SUM/ROWS of a block, never SUMIFS per aggregation row). Formulas of a Base row read only that row, the previous one
 * (E1) and the defined names of the Criterios tab. Streamed by the XLSX writer; the same input gives the same bytes.
 */
import { CT2_FIELDS, CT2_TESTS, type Ct2Field, type Ct2IntegrityConfig, type Ct2TestCode } from '../../../config/ct2IntegritySchema';
import { INVALID_TIME, dateParts, formatDay } from '../../../shared/dates';
import { CT2_TEST_INFO, type Ct2Level } from '../../../shared/modules/ct2Integrity';
import type { ConfigDifference } from '../../../shared/configTools';
import type { CheckResult } from '../../../shared/protocol';
import { TraceSheet } from '../../export/common/traceability';
import type { Language } from '../../export/labels';
import { COLORS, FORMATS, createTheme, fitWidth, headerHeight, textHeight, type ColGroup, type ColKind } from '../../export/theme';
import { XlsxWriter, colName, dateCell, type CellInput, type SheetWriter } from '../../export/xlsxWriter';
import { BIT } from './marks';
import type { Ct2Analysis } from './analysis';
import type { Ct2Ingested } from './ingest';
import { MANUAL_ORIGINS, textOf, type Ct2Group } from './profile';
import { CT2_LABELS, CT2_RULES, criteriaParagraphs, type Ct2WorkpaperLabels } from './workpaperLabels';
import { lineOrdinal } from './values';

export interface Ct2WorkpaperInput {
  base: Omit<Ct2Ingested, 'keys'>;
  analysis: Ct2Analysis;
  config: Ct2IntegrityConfig;
  /** Platform holidays (day numbers), for P_FERIADOS. */
  holidays: readonly number[];
  language: Language;
  /** Display text (local time of the user), "dd/mm/aaaa hh:mm:ss". */
  generatedAt: string;
  appVersion: string;
  configHash: string;
  configDifferences: ConfigDifference[];
  /** Blocking checks that failed and were confirmed by the user. */
  confirmedFailures: CheckResult[];
  /** Rows per sheet (Excel: 1.048.576); smaller only in tests. */
  sheetRows?: number;
}

export interface Ct2WorkpaperOutput {
  blob: Blob;
  fileName: string;
  /** CI-7: smallest date serial written (null when none). */
  minDateSerial: number | null;
}

/** Rows per worksheet in Excel. */
export const EXCEL_ROWS = 1048576;
/** Unbalanced documents listed on the Resumo. */
const SUMMARY_UNBALANCED = 50;

const q = (name: string) => (/^[A-Za-z_][\w.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
const str = (s: string) => `"${s.replace(/"/g, '""')}"`;
const reais = (cents: number) => cents / 100;
/** Criterion of COUNTIFS/SUMIFS that matches exactly this text (empty: the empty cells). */
const critEq = (v: string) => (v === '' ? '""' : str(`=${v.replace(/[~*?]/g, '~$&')}`));

/** A column of a sheet; its letter is known before writing, so every formula can reference it. */
interface Col {
  id: string;
  header: string;
  width: number;
  kind: ColKind;
  /** helper = computed by formula (grey header). */
  group: ColGroup;
}

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
  has(id: string): boolean {
    return this.letters.has(id);
  }
  letter(id: string): string {
    const l = this.letters.get(id);
    if (!l) throw new Error(`Coluna ${id} ausente em ${this.sheet}`);
    return l;
  }
  /** Absolute range of a column, rows a to b, with the sheet. */
  block(id: string, a: number, b: number): string {
    const l = this.letter(id);
    return `${q(this.sheet)}!$${l}$${a}:$${l}$${b}`;
  }
  /** Data range of a column (row 2 to the last row). */
  range(id: string): string {
    return this.block(id, 2, Math.max(2, this.rows + 1));
  }
  /** Whole column from the header (row 1), for INDEX by row number. */
  column(id: string): string {
    return this.block(id, 1, Math.max(2, this.rows + 1));
  }
  get lastRef(): string {
    return `${colName(this.cols.length - 1)}${Math.max(2, this.rows + 1)}`;
  }
}

const col = (id: string, header: string, width: number, kind: ColKind, group: ColGroup = 'data'): Col => ({ id, header, width, kind, group });

export async function buildCt2Workpaper(input: Ct2WorkpaperInput, onProgress: (step: number, total: number) => void): Promise<Ct2WorkpaperOutput> {
  const { base, analysis: a, config, language } = input;
  const L: Ct2WorkpaperLabels = CT2_LABELS[language];
  const C = L.cols;
  const { store, order, reconciliation, summary } = base;
  const b = a.blocks;
  const p = a.parameters;
  const sheetRows = input.sheetRows ?? EXCEL_ROWS;
  const rows = order.length;
  if (rows + 1 > sheetRows) {
    throw new Error(
      `CI-8: a base tem ${rows} linhas e não cabe numa aba do Excel (${sheetRows - 1} linhas de dados). Divida a extração (por exemplo, por mês) e analise cada parte.`,
    );
  }
  const w = new XlsxWriter();
  const T = createTheme(w.styles);
  const inputMoney = w.styles.style({ fill: COLORS.inputFill, font: { bold: true, size: 11, color: COLORS.inputFont }, border: 'box', borderColor: COLORS.inputBorder, numFmt: FORMATS.money, align: { h: 'center', v: 'center' } });
  const TOTAL_STEPS = 9;
  let step = 0;
  const progress = () => onProgress(++step, TOTAL_STEPS);
  const yesNo = (cond: string) => `IF(${cond},${str(L.yes)},${str(L.no)})`;
  const YES = str(L.yes);

  // What runs (section 6): a test turned off, or without its column, has no column and leaves the board.
  const on = Object.fromEntries(a.tests.map((t) => [t.code, t.state === 'on'])) as Record<Ct2TestCode, boolean>;
  const isException = (code: Ct2TestCode) => on[code] && config.tests[code].severity !== 'info';
  const present = new Set(reconciliation.files.flatMap((f) => f.header.mapped.map((m) => m.field as Ct2Field)));
  const titleOf = (field: Ct2Field) => {
    for (const f of reconciliation.files) {
      const m = f.header.mapped.find((x) => x.field === field);
      if (m) return m.title;
    }
    return config.columns[field].title;
  };
  const segmentOfDay = (k: number) => {
    const i = order[b.documentStart[b.batchStart[b.dayStart[k]!]!]!]!;
    return L.segment(textOf(store.text.balanceType, i), textOf(store.text.currency, i));
  };
  const segmentOfRow = (i: number) => L.segment(textOf(store.text.balanceType, i), textOf(store.text.currency, i));
  const files = reconciliation.files;

  // ── Layouts ──
  const SHEET = L.sheets;
  const fields = CT2_FIELDS.filter((f) => present.has(f));
  const others = [...store.other.keys()];
  const LINE_TESTS = (['I1', 'I2', 'I3', 'I4', 'I5', 'E1', 'E3', 'E4', 'E5'] as const).filter((t) => on[t]);
  const baseCols: Col[] = [
    col('file', C.file, 18, 'text'),
    col('sourceRow', C.sourceRow, 9, 'int'),
    col('segment', C.segment, 20, 'text'),
    ...fields.map((f) => col(`f:${f}`, titleOf(f), f === 'history' ? 36 : 12, f === 'date' ? 'date' : f === 'amount' || f === 'amountCurrency1' ? 'money' : 'text')),
    ...others.map((t, i) => col(`o:${i}`, t, 12, 'text')),
    col('debit', C.debit, 13, 'money', 'helper'),
    col('credit', C.credit, 13, 'money', 'helper'),
    ...LINE_TESTS.map((t) => col(`t:${t}`, L.testCol(t), 9, 'center', 'helper')),
    col('exceptions', C.exceptionsInLine, 10, 'int', 'helper'),
  ];
  const BASE = new Layout(SHEET.base, baseCols, rows);
  const keyFields = config.documentKey;
  const DOC_TESTS = (['B1', 'B4', 'B5', 'E2', 'P3', 'P4'] as const).filter((t) => on[t]);
  const DOCS = new Layout(
    SHEET.documents,
    [
      col('segment', C.segment, 20, 'text'),
      col('balanceType', C.balanceType, 8, 'center'),
      col('currency', C.currency, 8, 'center'),
      ...keyFields.map((f) => col(`k:${f}`, f === 'date' ? C.date : titleOf(f), 11, f === 'date' ? 'date' : 'center')),
      col('batchRow', C.batchRow, 10, 'int'),
      col('first', C.firstBase, 10, 'int'),
      col('last', C.lastBase, 10, 'int'),
      col('lastOrdinal', C.lastOrdinal, 10, 'int'),
      ...(on.P3 ? [col('sequences', C.sequences, 10, 'int'), col('shared', C.sharedSequence, 10, 'center')] : []),
      col('lines', C.lines, 9, 'int', 'helper'),
      col('debit', C.debit, 14, 'money', 'helper'),
      col('credit', C.credit, 14, 'money', 'helper'),
      col('difference', C.difference, 13, 'money', 'helper'),
      ...DOC_TESTS.map((t) => col(`t:${t}`, L.testCol(t), t === 'B4' ? 22 : 11, t === 'B4' ? 'text' : 'center', 'helper')),
      col('linesWithException', C.linesWithException, 10, 'int', 'helper'),
      ...(present.has('routine') ? [col('routine', C.firstRoutine, 12, 'text', 'helper')] : []),
      ...(present.has('standardEntry') ? [col('standardEntry', C.firstStandardEntry, 10, 'text', 'helper')] : []),
      ...(present.has('ctkSequence') ? [col('ctkSequence', C.firstSequence, 12, 'text', 'helper')] : []),
      col('history', C.firstHistory, 36, 'text', 'helper'),
    ],
    b.documents,
  );
  const BATCHES = new Layout(
    SHEET.batches,
    [
      col('segment', C.segment, 20, 'text'),
      col('balanceType', C.balanceType, 8, 'center'),
      col('currency', C.currency, 8, 'center'),
      col('date', C.date, 11, 'date'),
      col('batch', C.batch, 9, 'center'),
      col('subBatch', C.subBatch, 8, 'center'),
      col('first', C.firstDocument, 11, 'int'),
      col('last', C.lastDocument, 11, 'int'),
      col('documents', C.documents, 10, 'int', 'helper'),
      col('lines', C.lines, 9, 'int', 'helper'),
      col('debit', C.debit, 14, 'money', 'helper'),
      col('credit', C.credit, 14, 'money', 'helper'),
      col('difference', C.difference, 13, 'money', 'helper'),
      ...(on.B2 ? [col('t:B2', L.testCol('B2'), 11, 'center', 'helper')] : []),
      ...(on.B1 ? [col('unbalanced', C.unbalancedDocuments, 12, 'int', 'helper')] : []),
    ],
    b.batches,
  );
  const DAYS = new Layout(
    SHEET.days,
    [
      col('segment', C.segment, 20, 'text'),
      col('balanceType', C.balanceType, 8, 'center'),
      col('currency', C.currency, 8, 'center'),
      col('date', C.date, 11, 'date'),
      col('first', C.firstBatch, 10, 'int'),
      col('last', C.lastBatch, 10, 'int'),
      col('batches', C.batches, 9, 'int', 'helper'),
      col('documents', C.documents, 10, 'int', 'helper'),
      col('lines', C.lines, 9, 'int', 'helper'),
      col('debit', C.debit, 14, 'money', 'helper'),
      col('credit', C.credit, 14, 'money', 'helper'),
      col('difference', C.difference, 13, 'money', 'helper'),
      ...(on.B3 ? [col('t:B3', L.testCol('B3'), 11, 'center', 'helper')] : []),
      ...(on.E6 ? [col('t:E6', L.testCol('E6'), 11, 'center', 'helper')] : []),
    ],
    b.days,
  );
  const LEVEL_LAYOUT: Record<Exclude<Ct2Level, 'profile'>, Layout> = { line: BASE, document: DOCS, batch: BATCHES, day: DAYS };

  // Exceptions: Erro first, then Alerta; inside, the order of the tests and of the level. Split over sheets.
  const exceptionOrder: number[] = [];
  for (const severity of ['error', 'warning'] as const) {
    for (let k = 0; k < a.exceptions.count; k++) {
      const code = CT2_TESTS[a.exceptions.test.get(k)]!;
      if (config.tests[code].severity === severity) exceptionOrder.push(k);
    }
  }
  const perSheet = sheetRows - 1;
  const exceptionSheets = Math.max(1, Math.ceil(exceptionOrder.length / perSheet));
  const excCols: Col[] = [
    col('code', C.code, 7, 'center'),
    col('test', C.test, 34, 'text'),
    col('level', C.level, 10, 'center'),
    col('severity', C.severity, 9, 'center'),
    col('sheet', C.originSheet, 11, 'center'),
    col('row', C.originRow, 10, 'int'),
    col('balanceType', C.balanceType, 8, 'center'),
    col('currency', C.currency, 8, 'center'),
    col('date', C.date, 11, 'date'),
    col('batch', C.batch, 9, 'center'),
    col('subBatch', C.subBatch, 8, 'center'),
    col('document', C.document, 10, 'center'),
    col('line', C.line, 7, 'center'),
    col('file', C.file, 16, 'text'),
    col('sourceRow', C.sourceRow, 9, 'int'),
    col('value', C.value, 14, 'money'),
    col('confirmed', C.confirmed, 11, 'center', 'helper'),
  ];
  const EXC = Array.from(
    { length: exceptionSheets },
    (_, s) =>
      new Layout(s === 0 ? SHEET.exceptions : `${SHEET.exceptions} (${s + 1})`, excCols, Math.min(perSheet, exceptionOrder.length - s * perSheet)),
  );

  // Profile blocks (rows known now, so the Resumo can count the groups).
  const profile = a.profile;
  const PROFILE_START = 4;
  const profileBlocks: { id: 'routines' | 'standardEntries' | 'manual'; title: string; what: string; groups: number; first: number }[] = [];
  {
    let r = PROFILE_START;
    const add = (id: 'routines' | 'standardEntries' | 'manual', title: string, what: string, groups: number) => {
      if (groups === 0) return;
      // Title, header, then the groups; one blank row after.
      profileBlocks.push({ id, title, what, groups, first: r + 2 });
      r += groups + 3;
    };
    add('routines', L.profile.routines, L.profile.routine, profile.routines.length);
    add('standardEntries', L.profile.standardEntries, L.profile.standardEntry, profile.standardEntries.length);
    add('manual', L.profile.manual, L.profile.origin, profile.manual.length);
  }
  const blockOf = (id: string) => profileBlocks.find((x) => x.id === id);

  // ── Criterios: parameters as defined names ──
  const CRIT = q(SHEET.criteria);
  const PARAM_ROW = 5;
  const TYPE_ROW = 15;
  const typeLists = [config.entryTypes.debitCredit, config.entryTypes.debit, config.entryTypes.credit, config.entryTypes.historyContinuation];
  const holidays = [...input.holidays].sort((x, y) => x - y);
  w.defineName('P_DATA_INI', `${CRIT}!$B$${PARAM_ROW}`);
  w.defineName('P_DATA_FIM', `${CRIT}!$B$${PARAM_ROW + 1}`);
  w.defineName('P_SALDO', `${CRIT}!$B$${PARAM_ROW + 2}`);
  w.defineName('P_MOEDA', `${CRIT}!$B$${PARAM_ROW + 3}`);
  w.defineName('P_MOEDA_LOCAL', `${CRIT}!$B$${PARAM_ROW + 4}`);
  w.defineName('P_TOL', `${CRIT}!$B$${PARAM_ROW + 5}`);
  w.defineName('P_LIMITE_LINHAS', `${CRIT}!$B$${PARAM_ROW + 6}`);
  ['P_TIPO_PD', 'P_TIPO_DEB', 'P_TIPO_CRED', 'P_TIPO_HIST'].forEach((name, i) => {
    const l = colName(i);
    w.defineName(name, `${CRIT}!$${l}$${TYPE_ROW}:$${l}$${TYPE_ROW + typeLists[i]!.length - 1}`);
  });
  w.defineName('P_FERIADOS', `${CRIT}!$E$${TYPE_ROW}:$E$${TYPE_ROW + Math.max(1, holidays.length) - 1}`);
  const typeIs = (t: string, list: 'PD' | 'DEB' | 'CRED' | 'HIST') => `COUNTIF(P_TIPO_${list},${t})>0`;

  // ── Period and texts shared by the sheets ──
  const periodText =
    p.periodStart === null || p.periodEnd === null ? L.dash : `${formatDay(p.periodStart)} ${language === 'pt' ? 'a' : 'to'} ${formatDay(p.periodEnd)}`;
  const fileNames = files.map((f) => f.name).join('; ');
  const failed = input.confirmedFailures;

  /** Writes the header row of a data sheet. */
  const header = (sheet: SheetWriter, layout: Layout) =>
    sheet.row(
      layout.cols.map((c) => ({ v: c.header, s: T.head[c.group] })),
      { height: headerHeight(layout.cols) },
    );
  const styles = (layout: Layout) => layout.cols.map((c) => T.kind[c.kind]);
  const sheetOf = (layout: Layout) =>
    w.addSheet(layout.sheet, {
      columns: layout.cols.map((c) => ({ width: c.width })),
      freeze: { rows: 1, cols: 0 },
      autoFilter: `A1:${layout.lastRef}`,
      zoom: 90,
    });

  // ════════ Resumo ════════
  {
    const sheet = w.addSheet(SHEET.summary, {
      columns: [{ width: 22 }, { width: 40 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 15 }, { width: 13 }, { width: 13 }],
      showGridLines: false,
      tabColor: COLORS.navy,
    });
    const S = L.summary;
    sheet.row([{ v: S.title, s: T.title }], { height: 30 });
    sheet.row([{ v: S.subtitle(fileNames, periodText, input.generatedAt), s: T.subtitle }]);
    sheet.row([{ v: failed.length ? S.failBanner(input.generatedAt) : S.okBanner, s: failed.length ? T.fail : T.ok }], { height: 24 });
    sheet.merge(`A3:J3`);
    const section = (text: string) => {
      sheet.skip(1);
      const r = sheet.row([{ v: text, s: T.section }, ...Array.from({ length: 9 }, () => ({ v: null, s: T.section }))], { height: 22 });
      sheet.merge(`A${r}:J${r}`);
    };
    const headRow = (titles: readonly string[]) =>
      sheet.row(titles.map((v) => ({ v, s: T.headSummary })), { height: headerHeight(titles.map((h) => ({ header: h, width: 13 }))) });

    // 1. Indicators by segment (formulas over Dias and Documentos), then the counts of the whole extraction.
    section(S.indicators);
    headRow([C.segment, C.days, C.batches, C.documents, C.lines, C.debit, C.credit, C.difference, C.unbalancedDocuments]);
    const segments = Array.from({ length: b.segments }, (_, s) => segmentOfDay(b.segmentStart[s]!));
    const segFirst = sheet.nextRow;
    for (const seg of segments) {
      const r = sheet.nextRow;
      const crit = `${DAYS.range('segment')},$A${r}`;
      sheet.row([
        { v: seg, s: T.label },
        { f: `COUNTIFS(${crit})`, s: T.int },
        { f: `SUMIFS(${DAYS.range('batches')},${crit})`, s: T.int },
        { f: `SUMIFS(${DAYS.range('documents')},${crit})`, s: T.int },
        { f: `SUMIFS(${DAYS.range('lines')},${crit})`, s: T.int },
        { f: `SUMIFS(${DAYS.range('debit')},${crit})`, s: T.money },
        { f: `SUMIFS(${DAYS.range('credit')},${crit})`, s: T.money },
        { f: `ROUND(F${r}-G${r},2)`, s: T.money },
        on.B1 ? { f: `COUNTIFS(${DOCS.range('segment')},$A${r},${DOCS.range('t:B1')},${YES})`, s: T.int } : { v: L.dash, s: T.center },
      ]);
    }
    const segLast = sheet.nextRow - 1;
    const sumCol = (l: string) => `SUM(${l}${segFirst}:${l}${segLast})`;
    sheet.row(
      [
        { v: S.total, s: T.totalLabel },
        { f: sumCol('B'), s: T.totalInt },
        { f: sumCol('C'), s: T.totalInt },
        { f: sumCol('D'), s: T.totalInt },
        { f: sumCol('E'), s: T.totalInt },
        { v: L.dash, s: T.totalBlank },
        { v: L.dash, s: T.totalBlank },
        { v: L.dash, s: T.totalBlank },
        on.B1 ? { f: sumCol('I'), s: T.totalInt } : { v: L.dash, s: T.totalBlank },
      ],
      { height: 18 },
    );
    const excCount = (crit: string) => EXC.map((e) => `COUNTIF(${e.range('severity')},${crit})`).join('+');
    sheet.skip(1);
    sheet.row([{ v: S.errors, s: T.kvLabel }, { f: excCount(str(L.severities.error)), s: T.int }]);
    sheet.row([{ v: S.warnings, s: T.kvLabel }, { f: excCount(str(L.severities.warning)), s: T.int }]);

    // 2. Tie-out matrix: each level recalculated from the Base; the Tool row holds the engine values.
    section(S.matrix);
    headRow(S.matrixCols);
    const mBase = sheet.nextRow;
    const mDocs = mBase + 1;
    const mBatches = mBase + 2;
    const mDays = mBase + 3;
    const mTool = mBase + 4;
    const dash = { v: L.dash, s: T.center };
    const totalDebit = reais(b.segmentDebit.reduce((s, v) => s + v, 0));
    const totalCredit = reais(b.segmentCredit.reduce((s, v) => s + v, 0));
    // Reference of each column: lines, debit and credit from the Base; documents from Documentos; batches from Lotes.
    const status = (r: number, cells: ('B' | 'C' | 'D' | 'E' | 'F')[]) => {
      // The level that defines a column is compared with the engine (Tool row); every other level with that level.
      const owner = (l: string) => (l === 'C' ? mDocs : l === 'D' ? mBatches : mBase);
      const ref = (l: string) => `${l}${owner(l) === r ? mTool : owner(l)}`;
      const parts = cells.map((l) => `ROUND(${l}${r}-${ref(l)},2)=0`);
      return { f: `IF(AND(${parts.join(',')}),${str(L.ok)},${str(L.check)})`, s: T.center };
    };
    sheet.row([
      { v: S.matrixRows.base, s: T.label },
      { f: `COUNTA(${BASE.range('file')})`, s: T.int },
      dash,
      dash,
      { f: `SUM(${BASE.range('debit')})`, s: T.money },
      { f: `SUM(${BASE.range('credit')})`, s: T.money },
      status(mBase, ['B', 'E', 'F']),
    ]);
    sheet.row([
      { v: S.matrixRows.documents, s: T.label },
      { f: `SUM(${DOCS.range('lines')})`, s: T.int },
      { f: `ROWS(${DOCS.range('segment')})`, s: T.int },
      dash,
      { f: `SUM(${DOCS.range('debit')})`, s: T.money },
      { f: `SUM(${DOCS.range('credit')})`, s: T.money },
      status(mDocs, ['B', 'C', 'E', 'F']),
    ]);
    sheet.row([
      { v: S.matrixRows.batches, s: T.label },
      { f: `SUM(${BATCHES.range('lines')})`, s: T.int },
      { f: `SUM(${BATCHES.range('documents')})`, s: T.int },
      { f: `ROWS(${BATCHES.range('segment')})`, s: T.int },
      { f: `SUM(${BATCHES.range('debit')})`, s: T.money },
      { f: `SUM(${BATCHES.range('credit')})`, s: T.money },
      status(mBatches, ['B', 'C', 'D', 'E', 'F']),
    ]);
    sheet.row([
      { v: S.matrixRows.days, s: T.label },
      { f: `SUM(${DAYS.range('lines')})`, s: T.int },
      { f: `SUM(${DAYS.range('documents')})`, s: T.int },
      { f: `SUM(${DAYS.range('batches')})`, s: T.int },
      { f: `SUM(${DAYS.range('debit')})`, s: T.money },
      { f: `SUM(${DAYS.range('credit')})`, s: T.money },
      status(mDays, ['B', 'C', 'D', 'E', 'F']),
    ]);
    sheet.row([
      { v: S.matrixRows.tool, s: T.label },
      { v: rows, s: T.int },
      { v: b.documents, s: T.int },
      { v: b.batches, s: T.int },
      { v: totalDebit, s: T.money },
      { v: totalCredit, s: T.money },
      status(mTool, ['B', 'C', 'D', 'E', 'F']),
    ]);
    const maxDiff = (l: string, refRow: number, rowsOf: number[]) => ({ f: `MAX(${rowsOf.map((r) => `ABS(${l}${r}-${l}${refRow})`).join(',')})`, s: l === 'E' || l === 'F' ? T.money : T.int });
    sheet.row([
      { v: S.matrixRows.max, s: T.totalLabel },
      maxDiff('B', mBase, [mDocs, mBatches, mDays, mTool]),
      maxDiff('C', mDocs, [mBatches, mDays, mTool]),
      maxDiff('D', mBatches, [mDays, mTool]),
      maxDiff('E', mBase, [mDocs, mBatches, mDays, mTool]),
      maxDiff('F', mBase, [mDocs, mBatches, mDays, mTool]),
      { v: null, s: T.totalBlank },
    ]);
    sheet.row([{ v: S.matrixNote, s: T.note }], { height: textHeight(S.matrixNote, 150, 9) });
    sheet.merge(`A${sheet.nextRow - 1}:J${sheet.nextRow - 1}`);
    // Conditional colors of the statuses.
    sheet.conditional({ sqref: `G${mBase}:G${mTool}`, formula: `G${mBase}=${str(L.check)}`, style: { fill: COLORS.badFill, font: { bold: true, color: COLORS.badFont } } });
    sheet.conditional({ sqref: `G${mBase}:G${mTool}`, formula: `G${mBase}=${str(L.ok)}`, style: { fill: COLORS.okFill, font: { bold: true, color: COLORS.okFont } } });

    // 3. Board of tests.
    section(S.board);
    headRow(S.boardCols);
    const boardFirst = sheet.nextRow;
    const occurrencesFormula = (code: Ct2TestCode): string => {
      if (code === 'P1') {
        const parts = (['routines', 'standardEntries'] as const).map(blockOf).filter((x) => x !== undefined);
        return parts.length ? parts.map((x) => `ROWS(${q(SHEET.profile)}!$A$${x.first}:$A$${x.first + x.groups - 1})`).join('+') : '0';
      }
      if (code === 'P2') {
        const x = blockOf('manual');
        return x ? `ROWS(${q(SHEET.profile)}!$A$${x.first}:$A$${x.first + x.groups - 1})` : '0';
      }
      // B4 diagnoses every document of B1.
      if (code === 'B4') return `COUNTIF(${DOCS.range('t:B1')},${YES})`;
      const layout = LEVEL_LAYOUT[CT2_TEST_INFO[code].level as Exclude<Ct2Level, 'profile'>];
      return `COUNTIF(${layout.range(`t:${code}`)},${YES})`;
    };
    for (const t of a.tests) {
      if (t.state !== 'on') continue;
      const r = sheet.nextRow;
      const exception = isException(t.code);
      const inList = exception ? EXC.map((e) => `COUNTIF(${e.range('code')},$A${r})`).join('+') : null;
      const confirmed = exception ? EXC.map((e) => `COUNTIFS(${e.range('code')},$A${r},${e.range('confirmed')},${YES})`).join('+') : null;
      sheet.row([
        { v: t.code, s: T.center },
        { v: L.tests[t.code], s: T.text },
        { v: L.levels[CT2_TEST_INFO[t.code].level], s: T.center },
        { v: L.severities[t.severity], s: T.center },
        { f: occurrencesFormula(t.code), s: T.count },
        inList ? { f: inList, s: T.int } : { v: L.dash, s: T.center },
        { v: t.occurrences, s: T.int },
        confirmed ? { f: confirmed, s: T.int } : { v: L.dash, s: T.center },
        { f: exception ? `IF(AND(E${r}=G${r},F${r}=G${r},H${r}=G${r}),${str(L.matches)},${str(L.check)})` : `IF(E${r}=G${r},${str(L.matches)},${str(L.check)})`, s: T.center },
        { f: exception ? `IF(E${r}=0,${str(L.ok)},${str(L.check)})` : str(L.info), s: T.center },
      ]);
    }
    const boardLast = sheet.nextRow - 1;
    if (boardLast >= boardFirst) {
      sheet.conditional({ sqref: `I${boardFirst}:J${boardLast}`, formula: `I${boardFirst}=${str(L.check)}`, style: { fill: COLORS.badFill, font: { bold: true, color: COLORS.badFont } } });
      sheet.conditional({ sqref: `I${boardFirst}:J${boardLast}`, formula: `OR(I${boardFirst}=${str(L.matches)},I${boardFirst}=${str(L.ok)})`, style: { font: { bold: true, color: COLORS.okFont } } });
    }
    sheet.row([{ v: S.boardNote, s: T.note }], { height: textHeight(S.boardNote, 150, 9) });
    sheet.merge(`A${sheet.nextRow - 1}:J${sheet.nextRow - 1}`);

    // 4. Unbalanced documents (rows of Documentos listed by the engine; every cell read by INDEX, empty kept empty).
    section(S.unbalanced);
    const unbalancedDocs: number[] = [];
    if (on.B1) for (let d = 0; d < b.documents; d++) if (a.marks.document[d]! & BIT.B1) unbalancedDocs.push(d);
    if (unbalancedDocs.length === 0) sheet.row([{ v: S.unbalancedNone, s: T.desc }]);
    else {
      const listCols: [string, string, number][] = [
        [S.unbalancedRow, '', T.int],
        [C.segment, 'segment', T.text],
        [C.date, 'k:date', T.date],
        [C.batch, `k:batch`, T.center],
        [C.document, `k:document`, T.center],
        [C.difference, 'difference', T.money],
        ...(on.B4 ? ([[L.testCol('B4'), 't:B4', T.text]] as [string, string, number][]) : []),
      ];
      headRow(listCols.map((c) => c[0]));
      for (const d of unbalancedDocs.slice(0, SUMMARY_UNBALANCED)) {
        const r = sheet.nextRow;
        sheet.row(
          listCols.map(([, id, s], i) => {
            if (i === 0) return { v: d + 2, s };
            const cell = `INDEX(${DOCS.column(id)},$A${r})`;
            return { f: `IF(${cell}="","",${cell})`, s };
          }),
        );
      }
      if (unbalancedDocs.length > SUMMARY_UNBALANCED) sheet.row([{ v: S.unbalancedMore(SUMMARY_UNBALANCED, unbalancedDocs.length), s: T.note }]);
    }

    // 5. Automatic conclusion (text of the engine; indications, never the cause).
    section(S.conclusion);
    const text = conclusion(language, a, on, config);
    sheet.row([{ v: text, s: T.paragraph }], { height: textHeight(text, 150, 10) });
    sheet.merge(`A${sheet.nextRow - 1}:J${sheet.nextRow - 1}`);
    sheet.end();
  }
  progress();

  // ════════ Criterios ════════
  {
    const CR = L.criteria;
    const width = [34, 18, 18, 18, 14, 60];
    const sheet = w.addSheet(SHEET.criteria, { columns: width.map((x) => ({ width: x })), showGridLines: false });
    sheet.row([{ v: CR.title, s: T.title }], { height: 30 });
    sheet.skip(1);
    sheet.row([{ v: CR.params, s: T.h2 }], { height: 22 });
    sheet.row(CR.paramCols.map((v) => ({ v, s: T.headSummary })), { height: 20 });
    const PP = CR.params_;
    const param = (label: string, value: CellInput, name: string) => sheet.row([{ v: label, s: T.kvLabel }, value, { v: name, s: T.center }], { height: 18 });
    param(PP.start, p.periodStart === null ? { v: null, s: T.inputDate } : dateCell(p.periodStart, T.inputDate), 'P_DATA_INI');
    param(PP.end, p.periodEnd === null ? { v: null, s: T.inputDate } : dateCell(p.periodEnd, T.inputDate), 'P_DATA_FIM');
    param(PP.balanceType, { v: p.expectedBalanceType, s: T.input }, 'P_SALDO');
    param(PP.currency, { v: p.expectedCurrency, s: T.input }, 'P_MOEDA');
    param(PP.localCurrency, { v: p.localCurrency, s: T.input }, 'P_MOEDA_LOCAL');
    param(PP.tolerance, { v: reais(p.toleranceCents), s: inputMoney }, 'P_TOL');
    param(PP.lineLimit, { v: p.documentLineLimit, s: T.input }, 'P_LIMITE_LINHAS');
    sheet.skip(1);
    sheet.row([{ v: CR.types, s: T.h2 }], { height: 22 }); // row 13
    sheet.row(CR.typeCols.map((v) => ({ v, s: T.headSummary })), { height: 20 }); // row 14
    const listRows = Math.max(...typeLists.map((x) => x.length), holidays.length, 1);
    for (let i = 0; i < listRows; i++) {
      sheet.row([
        ...typeLists.map((list) => (list[i] !== undefined ? { v: list[i]!, s: T.center } : null)),
        holidays[i] !== undefined ? dateCell(holidays[i]!, T.date) : null,
      ]);
    }
    sheet.skip(1);
    sheet.row([{ v: CR.rules, s: T.h2 }], { height: 22 });
    sheet.row(CR.ruleCols.map((v) => ({ v, s: T.headSummary })), { height: 20 });
    for (const code of CT2_TESTS) {
      const t = a.tests.find((x) => x.code === code)!;
      const rule = CT2_RULES[language][code];
      const state = t.state === 'on' ? L.severities[t.severity] : t.state === 'off' ? (language === 'pt' ? 'Desligado' : 'Off') : language === 'pt' ? 'Sem a coluna' : 'No column';
      const r = sheet.row(
        [
          { v: code, s: T.center },
          { v: L.levels[CT2_TEST_INFO[code].level], s: T.center },
          { v: state, s: T.center },
          { v: rule, s: T.text },
          { v: null, s: T.text },
          { v: null, s: T.text },
        ],
        { height: textHeight(rule, 92, 10) },
      );
      sheet.merge(`D${r}:F${r}`);
    }
    for (const [title, body] of criteriaParagraphs(language, config.table)) {
      sheet.skip(1);
      sheet.row([{ v: title, s: T.h2 }], { height: 20 });
      sheet.row([{ v: body, s: T.paragraph }], { height: textHeight(body, 160, 10) });
      sheet.merge(`A${sheet.nextRow - 1}:F${sheet.nextRow - 1}`);
    }
    sheet.end();
  }
  progress();

  // ════════ Documentos ════════
  {
    const sheet = sheetOf(DOCS);
    header(sheet, DOCS);
    const st = styles(DOCS);
    const B = (id: string) => BASE.letter(id);
    const comp = str(L.compensates);
    const none = str(L.noCompensation);
    for (let d = 0; d < b.documents; d++) {
      const r = d + 2;
      const first = b.documentStart[d]! + 2;
      const last = b.documentStart[d + 1]! + 1;
      const i = order[first - 2]!;
      const lastI = order[last - 2]!;
      const L_ = (id: string) => DOCS.letter(id);
      const cells: CellInput[] = [];
      const put = (id: string, cell: CellInput) => (cells[DOCS.cols.findIndex((c) => c.id === id)] = cell);
      put('segment', segmentOfRow(i));
      put('balanceType', textOf(store.text.balanceType, i));
      put('currency', textOf(store.text.currency, i));
      for (const f of keyFields) put(`k:${f}`, f === 'date' ? dateCell(store.day.get(i)) : textOf(store.text[f as 'batch'], i));
      put('batchRow', b.documentBatch[d]! + 2);
      put('first', first);
      put('last', last);
      put('lastOrdinal', lineOrdinal(textOf(store.text.line, lastI)));
      if (on.P3 && a.sequences) {
        put('sequences', a.sequences.perDocument[d]!);
        put('shared', a.sequences.shared[d] ? L.yes : L.no);
      }
      put('lines', { f: `ROWS(${BASE.block('file', first, last)})` });
      put('debit', { f: `SUM(${BASE.block('debit', first, last)})` });
      put('credit', { f: `SUM(${BASE.block('credit', first, last)})` });
      put('difference', { f: `ROUND(${L_('debit')}${r}-${L_('credit')}${r},2)` });
      const dif = (row: number) => `${L_('difference')}${row}`;
      if (on.B1) put('t:B1', { f: yesNo(`ABS(${dif(r)})>P_TOL`) });
      if (on.B4) {
        // The next document of the same batch first, then the previous one; never across batches (nor segments).
        const lot = (row: number) => `${L_('batchRow')}${row}`;
        const doc = (row: number) => `${L_('k:document')}${row}`;
        let inner = none;
        if (d > 0) inner = `IF(AND(${lot(r - 1)}=${lot(r)},ROUND(${dif(r)}+${dif(r - 1)},2)=0),${comp}&${doc(r - 1)},${inner})`;
        if (d + 1 < b.documents) inner = `IF(AND(${lot(r + 1)}=${lot(r)},ROUND(${dif(r)}+${dif(r + 1)},2)=0),${comp}&${doc(r + 1)},${inner})`;
        put('t:B4', { f: `IF(${L_('t:B1')}${r}=${str(L.no)},"",${inner})` });
      }
      if (on.B5) put('t:B5', { f: yesNo(`${L_('t:B4')}${r}=${none}`) });
      if (on.E2) put('t:E2', { f: `IF(${L_('lastOrdinal')}${r}="","",${yesNo(`${L_('lastOrdinal')}${r}<>${L_('lines')}${r}`)})` });
      if (on.P3) put('t:P3', { f: yesNo(`OR(${L_('sequences')}${r}>1,${L_('shared')}${r}=${YES})`) });
      if (on.P4) put('t:P4', { f: yesNo(`${L_('lines')}${r}>=P_LIMITE_LINHAS`) });
      put('linesWithException', { f: `COUNTIF(${BASE.block('exceptions', first, last)},">0")` });
      const firstOf = (id: string, field: Ct2Field) => {
        if (!DOCS.has(id)) return;
        const ref = `${q(SHEET.base)}!${B(`f:${field}`)}${first}`;
        put(id, { f: `IF(${ref}="","",${ref})` });
      };
      firstOf('routine', 'routine');
      firstOf('standardEntry', 'standardEntry');
      firstOf('ctkSequence', 'ctkSequence');
      firstOf('history', 'history');
      sheet.row(cells, { styles: st });
    }
    sheet.end();
  }
  progress();

  // ════════ Lotes ════════
  {
    const sheet = sheetOf(BATCHES);
    header(sheet, BATCHES);
    const st = styles(BATCHES);
    for (let k = 0; k < b.batches; k++) {
      const r = k + 2;
      const x = b.batchStart[k]! + 2;
      const y = b.batchStart[k + 1]! + 1;
      const i = order[b.documentStart[b.batchStart[k]!]!]!;
      const l = (id: string) => BATCHES.letter(id);
      sheet.row(
        [
          segmentOfRow(i),
          textOf(store.text.balanceType, i),
          textOf(store.text.currency, i),
          dateCell(store.day.get(i)),
          textOf(store.text.batch, i),
          textOf(store.text.subBatch, i),
          x,
          y,
          { f: `ROWS(${DOCS.block('segment', x, y)})` },
          { f: `SUM(${DOCS.block('lines', x, y)})` },
          { f: `SUM(${DOCS.block('debit', x, y)})` },
          { f: `SUM(${DOCS.block('credit', x, y)})` },
          { f: `ROUND(${l('debit')}${r}-${l('credit')}${r},2)` },
          ...(on.B2 ? [{ f: yesNo(`ABS(${l('difference')}${r})>P_TOL`) }] : []),
          ...(on.B1 ? [{ f: `COUNTIF(${DOCS.block('t:B1', x, y)},${YES})` }] : []),
        ],
        { styles: st },
      );
    }
    sheet.end();
  }
  progress();

  // ════════ Dias ════════
  {
    const sheet = sheetOf(DAYS);
    header(sheet, DAYS);
    const st = styles(DAYS);
    for (let k = 0; k < b.days; k++) {
      const r = k + 2;
      const x = b.dayStart[k]! + 2;
      const y = b.dayStart[k + 1]! + 1;
      const i = order[b.documentStart[b.batchStart[b.dayStart[k]!]!]!]!;
      const l = (id: string) => DAYS.letter(id);
      const date = `${l('date')}${r}`;
      sheet.row(
        [
          segmentOfRow(i),
          textOf(store.text.balanceType, i),
          textOf(store.text.currency, i),
          dateCell(a.dayNumber[k]!),
          x,
          y,
          { f: `ROWS(${BATCHES.block('segment', x, y)})` },
          { f: `SUM(${BATCHES.block('documents', x, y)})` },
          { f: `SUM(${BATCHES.block('lines', x, y)})` },
          { f: `SUM(${BATCHES.block('debit', x, y)})` },
          { f: `SUM(${BATCHES.block('credit', x, y)})` },
          { f: `ROUND(${l('debit')}${r}-${l('credit')}${r},2)` },
          ...(on.B3 ? [{ f: yesNo(`ABS(${l('difference')}${r})>P_TOL`) }] : []),
          ...(on.E6 ? [{ f: `IF(ISNUMBER(${date}),${yesNo(`OR(WEEKDAY(${date},2)>5,COUNTIF(P_FERIADOS,${date})>0)`)},"")` }] : []),
        ],
        { styles: st },
      );
    }
    sheet.end();
  }
  progress();

  // ════════ Excecoes (continued on other sheets above the row limit) ════════
  {
    let k = 0;
    for (const layout of EXC) {
      const sheet = sheetOf(layout);
      header(sheet, layout);
      const st = styles(layout);
      for (let n = 0; n < layout.rows; n++, k++) {
        const e = exceptionOrder[k]!;
        const code = CT2_TESTS[a.exceptions.test.get(e)]!;
        const item = a.exceptions.item.get(e);
        const level = CT2_TEST_INFO[code].level as Exclude<Ct2Level, 'profile'>;
        const origin = LEVEL_LAYOUT[level];
        const position = level === 'line' ? item : level === 'document' ? b.documentStart[item]! : level === 'batch' ? b.documentStart[b.batchStart[item]!]! : b.documentStart[b.batchStart[b.dayStart[item]!]!]!;
        const i = order[position]!;
        const originRow = item + 2;
        const value =
          level === 'line'
            ? store.amount.get(i)
            : level === 'document'
              ? b.documentDebit[item]! - b.documentCredit[item]!
              : level === 'batch'
                ? b.batchDebit[item]! - b.batchCredit[item]!
                : b.dayDebit[item]! - b.dayCredit[item]!;
        const r = sheet.nextRow;
        const testCell = `INDEX(${origin.column(`t:${code}`)},${layout.letter('row')}${r})`;
        sheet.row(
          [
            code,
            L.tests[code],
            L.levels[level],
            L.severities[config.tests[code].severity],
            origin.sheet,
            originRow,
            textOf(store.text.balanceType, i),
            textOf(store.text.currency, i),
            dateCell(store.day.get(i)),
            level === 'day' ? null : textOf(store.text.batch, i),
            level === 'day' ? null : textOf(store.text.subBatch, i),
            level === 'line' || level === 'document' ? textOf(store.text.document, i) : null,
            level === 'line' ? textOf(store.text.line, i) : null,
            level === 'line' ? files[store.source.get(i)]!.name : null,
            level === 'line' ? store.sourceRow.get(i) : null,
            Number.isNaN(value) ? null : reais(value),
            { f: yesNo(`${testCell}=${YES}`) },
          ],
          { styles: st },
        );
      }
      sheet.end();
    }
  }
  progress();

  // ════════ Perfil ════════
  {
    const PR = L.profile;
    const sheet = w.addSheet(SHEET.profile, { columns: [24, 22, 11, 15, 15, 12, 11].map((width) => ({ width })), showGridLines: false });
    sheet.row([{ v: PR.title, s: T.title }], { height: 30 });
    sheet.row([{ v: PR.note, s: T.note }], { height: textHeight(PR.note, 110, 9) });
    sheet.merge('A2:G2');
    sheet.skip(1);
    const segCrit = (seg: string) => `${BASE.range('segment')},${str(seg)}`;
    const groupRows = (block: (typeof profileBlocks)[number], list: Ct2Group[] | (Omit<Ct2Group, 'value'> & { origin: string })[]) => {
      while (sheet.nextRow < block.first - 2) sheet.skip(1);
      sheet.row([{ v: block.title, s: T.h2 }], { height: 22 });
      sheet.row(PR.groupCols(block.what).map((v) => ({ v, s: T.headSummary })), { height: 20 });
      for (const g of list) {
        const r = sheet.nextRow;
        const seg = L.segment(g.balanceType, g.currency);
        let lines: string;
        let debit: string;
        let credit: string;
        let shown: string;
        if ('origin' in g) {
          const codes = (o: string) => (o === 'manual' ? config.manualFlag.manual : config.manualFlag.automatic);
          const count = (fn: 'COUNTIFS' | 'SUMIFS', range: string | null, list: string[]) =>
            list.map((code) => `${fn}(${range ? `${range},` : ''}${segCrit(seg)},${BASE.range('f:manual')},${critEq(code)})`).join('+') || '0';
          const known = (fn: 'COUNTIFS' | 'SUMIFS', range: string | null) => count(fn, range, [...config.manualFlag.manual, ...config.manualFlag.automatic]);
          const pick = (fn: 'COUNTIFS' | 'SUMIFS', range: string | null) =>
            g.origin === 'unidentified' ? `${fn}(${range ? `${range},` : ''}${segCrit(seg)})-(${known(fn, range)})` : count(fn, range, codes(g.origin));
          lines = pick('COUNTIFS', null);
          debit = pick('SUMIFS', BASE.range('debit'));
          credit = pick('SUMIFS', BASE.range('credit'));
          shown = L.origins[g.origin as (typeof MANUAL_ORIGINS)[number]];
        } else {
          const field = block.id === 'routines' ? 'routine' : 'standardEntry';
          const crit = `${segCrit(seg)},${BASE.range(`f:${field}`)},${critEq(g.value)}`;
          lines = `COUNTIFS(${crit})`;
          debit = `SUMIFS(${BASE.range('debit')},${crit})`;
          credit = `SUMIFS(${BASE.range('credit')},${crit})`;
          shown = g.value === '' ? PR.empty : g.value;
        }
        sheet.row([
          { v: seg, s: T.label },
          { v: shown, s: T.text },
          { f: lines, s: T.int },
          { f: debit, s: T.money },
          { f: credit, s: T.money },
          { v: g.lines, s: T.int },
          { f: `IF(C${r}=F${r},${str(L.matches)},${str(L.check)})`, s: T.center },
        ]);
      }
    };
    for (const block of profileBlocks) groupRows(block, block.id === 'manual' ? profile.manual : profile[block.id]);
    sheet.skip(1);
    if (on.P3) {
      sheet.row([{ v: PR.sequences, s: T.h2 }], { height: 22 });
      sheet.row([{ v: PR.sequencesRow, s: T.kvLabel }, null, { f: `COUNTIF(${DOCS.range('t:P3')},${YES})`, s: T.int }], { height: 30 });
      sheet.merge(`A${sheet.nextRow - 1}:B${sheet.nextRow - 1}`);
      sheet.skip(1);
    }
    sheet.row([{ v: PR.limit, s: T.h2 }], { height: 22 });
    if (on.P4) {
      sheet.row([{ v: PR.limitRow, s: T.kvLabel }, null, { f: `COUNTIF(${DOCS.range('t:P4')},${YES})`, s: T.int }]);
      sheet.merge(`A${sheet.nextRow - 1}:B${sheet.nextRow - 1}`);
    }
    sheet.skip(1);
    sheet.row([{ v: PR.largest, s: T.h2 }], { height: 22 });
    sheet.row(PR.largestCols.map((v) => ({ v, s: T.headSummary })), { height: 20 });
    for (const big of profile.largest) {
      const r = sheet.nextRow;
      const read = (id: string, s: number) => {
        const cell = `INDEX(${DOCS.column(id)},$A${r})`;
        return { f: `IF(${cell}="","",${cell})`, s };
      };
      sheet.row([{ v: big.document + 2, s: T.int }, read('segment', T.text), read('k:date', T.date), read('k:batch', T.center), read('k:document', T.center), read('lines', T.int)]);
    }
    sheet.end();
  }
  progress();

  // ════════ Base ════════
  {
    const sheet = sheetOf(BASE);
    header(sheet, BASE);
    const st = styles(BASE);
    const l = (id: string) => BASE.letter(id);
    const fieldCol = (f: Ct2Field) => (present.has(f) ? l(`f:${f}`) : null);
    const TY = fieldCol('entryType')!;
    const DB = fieldCol('debitAccount')!;
    const CR = fieldCol('creditAccount')!;
    const VL = fieldCol('amount')!;
    const M1 = fieldCol('amountCurrency1');
    const HI = fieldCol('history')!;
    const BT = fieldCol('balanceType')!;
    const CU = fieldCol('currency')!;
    const DT = fieldCol('date')!;
    // E1: the line key (section 3), text compared with case as the engine does.
    const keyParts = (['balanceType', 'currency', ...keyFields, 'line', 'companyOrigin', 'branchOrigin'] as Ct2Field[]).filter((f, idx, all) => all.indexOf(f) === idx && present.has(f));
    const exceptionTests = LINE_TESTS.filter(isException);
    for (let pos = 0; pos < rows; pos++) {
      const r = pos + 2;
      const i = order[pos]!;
      const cells: CellInput[] = [files[store.source.get(i)]!.name, store.sourceRow.get(i), segmentOfRow(i)];
      for (const f of fields) {
        if (f === 'date') cells.push(dateCell(store.day.get(i)));
        else if (f === 'amount' || f === 'amountCurrency1') {
          const v = (f === 'amount' ? store.amount : store.amountCurrency1).get(i);
          cells.push(Number.isNaN(v) ? null : reais(v));
        } else cells.push(textOf(store.text[f as 'batch'], i));
      }
      for (const column of store.other.values()) cells.push(column.get(i) as CellInput);
      const T_ = `${TY}${r}`;
      const V = `${VL}${r}`;
      const D = `${DB}${r}`;
      const Cc = `${CR}${r}`;
      cells.push({ f: `IF(OR(${typeIs(T_, 'PD')},${typeIs(T_, 'DEB')}),${V},0)` });
      cells.push({ f: `IF(OR(${typeIs(T_, 'PD')},${typeIs(T_, 'CRED')}),${V},0)` });
      for (const t of LINE_TESTS) {
        let f: string;
        switch (t) {
          case 'I1':
            f = `IF(IF(${typeIs(T_, 'PD')},AND(${D}<>"",${Cc}<>""),IF(${typeIs(T_, 'DEB')},AND(${D}<>"",${Cc}=""),IF(${typeIs(T_, 'CRED')},AND(${D}="",${Cc}<>""),IF(${typeIs(T_, 'HIST')},AND(${D}="",${Cc}="",${V}=0),FALSE)))),${str(L.no)},${str(L.yes)})`;
            break;
          case 'I2':
            f = yesNo(`AND(NOT(${typeIs(T_, 'HIST')}),${V}<>"",${V}<=0)`);
            break;
          case 'I3':
            f = yesNo(`AND(${typeIs(T_, 'PD')},${D}<>"",EXACT(${D},${Cc}))`);
            break;
          case 'I4':
            f = yesNo(`AND(EXACT(${CU}${r},P_MOEDA_LOCAL),${M1}${r}<>"",${V}<>"",ROUND(${V}-${M1}${r},2)<>0)`);
            break;
          case 'I5':
            f = yesNo(`TRIM(${HI}${r})=""`);
            break;
          case 'E1':
            f = pos === 0 ? str(L.no) : yesNo(`AND(${keyParts.map((k) => (k === 'date' ? `${DT}${r}=${DT}${r - 1}` : `EXACT(${l(`f:${k}`)}${r},${l(`f:${k}`)}${r - 1})`)).join(',')})`);
            break;
          case 'E3':
            f = yesNo(`NOT(EXACT(${BT}${r},P_SALDO))`);
            break;
          case 'E4':
            f = yesNo(`NOT(EXACT(${CU}${r},P_MOEDA))`);
            break;
          default:
            f = yesNo(`AND(ISNUMBER(${DT}${r}),OR(${DT}${r}<P_DATA_INI,${DT}${r}>P_DATA_FIM))`);
        }
        cells.push({ f });
      }
      cells.push({ f: exceptionTests.length ? exceptionTests.map((t) => `(${l(`t:${t}`)}${r}=${YES})`).join('+') : '0' });
      sheet.row(cells, { styles: st });
      if ((pos & 0xffff) === 0xffff) onProgress(step, TOTAL_STEPS);
    }
    sheet.end();
  }
  progress();

  // ════════ Rastreabilidade ════════
  {
    const TR = L.trace;
    const TW = [30, 16, 18, 14, 14, 14, 14, 14, 14, 68];
    const sheet = w.addSheet(SHEET.trace, { columns: TW.map((width) => ({ width })), showGridLines: false });
    const trace = new TraceSheet(sheet, T, TW);
    sheet.row([{ v: TR.title, s: T.title }], { height: 30 });
    trace.heading(TR.kv);
    trace.kv(TR.tool, 'AuditAnalyzer');
    trace.kv(TR.version, input.appVersion);
    trace.kv(TR.generated, input.generatedAt);
    trace.kv(TR.language, language === 'pt' ? 'Português' : 'English');
    trace.kv(TR.period, periodText);
    trace.kv(TR.configHash, input.configHash);
    trace.kv(TR.holidays, holidays.map(formatDay).join(', ') || '—');
    if (failed.length) trace.confirmed(TR.confirmed.replace('{when}', input.generatedAt));
    trace.heading(TR.configDiff);
    trace.configDifferences(input.configDifferences, { none: TR.configDefault, cols: TR.configDiffCols });
    trace.heading(TR.files);
    trace.headRow(TR.fileCols);
    for (const f of files) {
      sheet.row(
        [
          { v: f.name, s: T.text },
          { v: f.size, s: T.int },
          { v: f.sheetName, s: T.center },
          { v: f.header.row, s: T.int },
          { v: f.rows.rowsAfterHeader, s: T.int },
          { v: f.rows.blankRows, s: T.int },
          { v: f.rows.detailRows, s: T.int },
          { v: f.rows.balanced ? TR.reconciles : TR.diverges, s: T.center },
          { v: `${f.entries.filter((e) => e.ok).length}/${f.entries.length}`, s: T.center },
          { v: f.sha256, s: T.text },
        ],
        { height: 18 },
      );
    }
    trace.heading(TR.mapping);
    trace.headRow(TR.mappingCols);
    for (const f of files) {
      for (const m of f.header.mapped) {
        sheet.row([{ v: f.name, s: T.text }, { v: m.field, s: T.center }, { v: m.title, s: T.text }, { v: colName(m.column - 1), s: T.center }], { height: 16 });
      }
    }
    trace.heading(TR.checks);
    trace.checks(reconciliation.checks, { cols: TR.checkCols, blocking: TR.blocking, warning: TR.warning, passed: TR.passed, failed: TR.failed }, 7);
    sheet.end();
  }
  progress();

  const blob = await w.finish();
  return { blob, fileName: ct2FileName(language, p.periodStart ?? summary.firstDay, p.periodEnd ?? summary.lastDay, input.generatedAt), minDateSerial: w.minDateSerial };
}

/** CT2_Integridade_<AAAA-MM>[_a_<AAAA-MM>]_<date>.xlsx (decision of 29/10/2026). */
export function ct2FileName(language: Language, start: number | null, end: number | null, generatedAt: string): string {
  const month = (day: number) => {
    const [y, m] = dateParts(day);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
  };
  const from = start === null || start === INVALID_TIME ? null : month(start);
  const to = end === null || end === INVALID_TIME ? null : month(end);
  const period = from === null ? (language === 'pt' ? 'sem-data' : 'no-date') : to === null || to === from ? from : `${from}_${language === 'pt' ? 'a' : 'to'}_${to}`;
  const date = generatedAt.slice(0, 10).split('/').reverse().join('-');
  return CT2_LABELS[language].file(period, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : generatedAt.slice(0, 10)).replace(/[\\/:*?"<>|]/g, '-');
}

/** Automatic conclusion (section 7.8): balancing by level, adjacent offsets, line limit and tests with Erro. */
function conclusion(language: Language, a: Ct2Analysis, on: Record<Ct2TestCode, boolean>, config: Ct2IntegrityConfig): string {
  const count = (code: Ct2TestCode) => a.tests.find((t) => t.code === code)!.occurrences;
  const pt = language === 'pt';
  const parts: string[] = [];
  const tol = (a.parameters.toleranceCents / 100).toFixed(2).replace('.', pt ? ',' : '.');
  if (on.B1 || on.B2 || on.B3) {
    const [d, l, k] = [count('B1'), count('B2'), count('B3')];
    parts.push(
      d + l + k === 0
        ? pt
          ? `Balanceamento: todos os documentos, lotes e dias estão balanceados (tolerância R$ ${tol}).`
          : `Balancing: every document, batch and day is balanced (tolerance R$ ${tol}).`
        : pt
          ? `Balanceamento: ${d} documento(s), ${l} lote(s) e ${k} dia(s) desbalanceado(s) (tolerância R$ ${tol}).`
          : `Balancing: ${d} document(s), ${l} batch(es) and ${k} day(s) unbalanced (tolerance R$ ${tol}).`,
    );
  }
  if (on.B4 && count('B1') > 0) {
    const offset = Array.from(a.compensation).filter((c) => c >= 0).length;
    const none = Array.from(a.compensation).filter((c) => c === -1).length;
    parts.push(
      pt
        ? `Dos ${count('B1')} documentos desbalanceados, ${offset} têm compensação exata pelo documento vizinho do lote e ${none} não têm: indícios a confirmar pelo analista.`
        : `Of the ${count('B1')} unbalanced documents, ${offset} are offset exactly by the adjacent document of the batch and ${none} are not: indications to be confirmed by the analyst.`,
    );
  }
  if (on.P4) {
    parts.push(
      pt
        ? `${count('P4')} documento(s) atingiram o limite de ${a.parameters.documentLineLimit} linhas por documento (P4).`
        : `${count('P4')} document(s) reached the limit of ${a.parameters.documentLineLimit} lines per document (P4).`,
    );
  }
  const errors = a.tests.filter((t) => t.state === 'on' && config.tests[t.code].severity === 'error' && t.occurrences > 0);
  parts.push(
    errors.length === 0
      ? pt
        ? 'Nenhum teste de severidade Erro tem ocorrência.'
        : 'No test of severity Error has occurrences.'
      : pt
        ? `Testes de severidade Erro com ocorrências: ${errors.map((t) => `${t.code} (${t.occurrences})`).join(', ')}.`
        : `Tests of severity Error with occurrences: ${errors.map((t) => `${t.code} (${t.occurrences})`).join(', ')}.`,
  );
  parts.push(pt ? 'Os indícios não provam a causa; a conclusão cabe ao analista.' : 'Indications do not prove the cause; the conclusion is the analyst’s.');
  return parts.join(' ');
}

