/**
 * The workpaper of the Conciliador, payroll profile, Padrão A (docs/REGRAS_CONCILIADOR.md, section 10; Phase 15, step 6),
 * tied out by formulas. The readings go in as values (Folha_Escopo: the scope of the payroll; Folha_Filial: its branch
 * blocks; Razao: the opening balance of the competence by balance type and every line of the competence of the accounts
 * analyzed); everything derived is a formula over them: the contribution of each verba of the criterion (Criterios), the
 * payroll and ledger sides of each key branch × verba and its situation (Integracao), the parcels of the bridge and the
 * balances (Ponte) and, on the Resumo, the account by account summary with "Confere" when the bridge closes, the
 * integration ties with Folha_Filial and Razao and the payroll of the scope ties with its footer and its branches. The
 * values of the engine are written next to what the workbook computes (Ponte, Integracao, the key figures), so the
 * recalculated workbook proves it computes what the tool did (CC-6). Streamed by the XLSX writer; the same session gives
 * the same bytes.
 */
import type { PayrollProfileConfig } from '../../../config/reconciliationSchema';
import type { ConfigDifference } from '../../../shared/configTools';
import { formatDay } from '../../../shared/dates';
import type { ReconciliationExportJustification } from '../../../shared/modules/reconciliation';
import type { CheckResult } from '../../../shared/protocol';
import { TraceSheet } from '../../export/common/traceability';
import type { Language } from '../../export/labels';
import { COLORS, FORMATS, createTheme, fitWidth, headerHeight, textHeight, type ColGroup, type ColKind } from '../../export/theme';
import { XlsxWriter, colName, dateCell, type Cell, type CellInput, type SheetWriter } from '../../export/xlsxWriter';
import type { ReconciliationIngested } from './ingest';
import type { BatchClassId, CombinedLedgerLine } from './ledger';
import { BATCH_CLASS_ORDER, type PayrollAccountResult } from './profiles/payroll/analyze';
import { payrollScopes } from './profiles/payroll/expected';
import type { IntegrationKey } from './profiles/payroll/integration';
import { RECONCILIATION_LABELS, type ReconciliationWorkpaperLabels } from './workpaperLabels';

export interface ReconciliationWorkpaperInput {
  state: Pick<ReconciliationIngested, 'reconciliation' | 'summary' | 'profile' | 'payroll' | 'ledgers' | 'analysis'>;
  language: Language;
  /** Display text (local time of the user), "dd/mm/aaaa hh:mm:ss". */
  generatedAt: string;
  appVersion: string;
  configHash: string;
  configDifferences: ConfigDifference[];
  /** Blocking checks that failed and were confirmed by the user. */
  confirmedFailures: CheckResult[];
  /** The user's justification and situation of each account, in this competence (screen Justificativas). */
  justifications: readonly ReconciliationExportJustification[];
}

export interface ReconciliationWorkpaperOutput {
  blob: Blob;
  fileName: string;
  /** Smallest date serial written (null when none): no date before 01/01/1901 (export/common/guards.ts). */
  minDateSerial: number | null;
}

const q = (name: string) => (/^[A-Za-z_][\w.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
const str = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** Criterion of COUNTIFS/SUMIFS that matches exactly this text (wildcards escaped; empty: the empty cells). */
const critEq = (v: string) => (v === '' ? '""' : str(`=${v.replace(/[~*?]/g, '~$&')}`));
const reais = (cents: number) => cents / 100;

/** A column of a data sheet; its letter is known before writing, so every formula can reference it. */
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
    /** Data rows (the header is row `first − 1`). */
    readonly rows: number,
    /** First data row. */
    readonly first = 2,
  ) {
    this.cols = cols.map((c) => ({ ...c, width: fitWidth(c.header, c.width) }));
    this.cols.forEach((c, i) => this.letters.set(c.id, colName(i)));
  }
  letter(id: string): string {
    const l = this.letters.get(id);
    if (!l) throw new Error(`Coluna ${id} ausente em ${this.sheet}`);
    return l;
  }
  /** Absolute range of the data rows of a column, with the sheet (at least one row, so an empty sheet still sums 0). */
  range(id: string): string {
    const l = this.letter(id);
    return `${q(this.sheet)}!$${l}$${this.first}:$${l}$${Math.max(this.first, this.first + this.rows - 1)}`;
  }
  get lastRef(): string {
    return `${colName(this.cols.length - 1)}${Math.max(this.first, this.first + this.rows - 1)}`;
  }
}

const col = (id: string, header: string, width: number, kind: ColKind, group: ColGroup = 'data'): Col => ({ id, header, width, kind, group });

/** Code of a parcel of the bridge (7.5) in the Razao and on the Ponte; never a text Excel would read as a number or a date. */
export function parcelCode(id: string): string {
  if (id === 'expected') return 'P1';
  if (id === 'criterion') return 'P2';
  if (id === 'outside') return 'P3';
  if (id === 'opening') return 'P4';
  const k = BATCH_CLASS_ORDER.indexOf(id.slice('movement:'.length) as BatchClassId);
  return `P5${'abcd'[k] ?? 'x'}`;
}

/** A row of the Razao: the opening balance of the competence of a balance type, or a line of the competence. */
interface LedgerRow {
  account: PayrollAccountResult;
  type: '1' | '9';
  line: CombinedLedgerLine | null;
  /** Cents; for the opening row, its balance on the side it is on (credit positive in the ledger). */
  debit: number;
  credit: number;
  date: number;
  parcel: string;
  settled: boolean;
  checked: boolean;
  file: number;
}

/** A row of the Ponte of an account: the parcels, then the totals. */
interface BridgeBlock {
  account: PayrollAccountResult;
  bar: number;
  firstParcel: number;
  parcels: { code: string; label: string; amount: number; row: number }[];
  total: number;
  types: { type: '1' | '9'; row: number; amount: number }[];
  combined: number;
  closes: number;
  difference: number;
}

export async function buildReconciliationWorkpaper(input: ReconciliationWorkpaperInput, onProgress: (step: number, total: number) => void): Promise<ReconciliationWorkpaperOutput> {
  const { state, language } = input;
  const L: ReconciliationWorkpaperLabels = RECONCILIATION_LABELS[language];
  const { analysis, profile, reconciliation, summary } = state;
  const report = state.payroll.report;
  const SHEET = L.sheets;
  const TOTAL_STEPS = 9;
  let step = 0;
  const progress = () => onProgress(++step, TOTAL_STEPS);
  const YES = str(L.yes);
  const NO = str(L.no);
  const yesNo = (cond: string) => `IF(${cond},${YES},${NO})`;
  const matches = (cond: string) => `IF(${cond},${str(L.matches)},${str(L.check)})`;
  const equalMoney = (a: string, b: string) => `ROUND(${a}-${b},2)=0`;

  const analyzed = analysis.accounts.filter((a) => a.status === 'analyzed');
  const scopes = payrollScopes(report, profile.payrollReport.scope);
  const scope = scopes.scope;
  const scopeText = `${L.levels[profile.payrollReport.scope.level]} / ${profile.payrollReport.scope.contractType}`;
  const period = `${analysis.period.slice(4)}/${analysis.period.slice(0, 4)}`;
  const classLabel = (id: BatchClassId) => profile.ledger.batchClasses.find((c) => c.id === id)?.label ?? (id === 'other' ? L.otherClass : id);
  const parcelLabel = (id: string) => (id.startsWith('movement:') ? L.parcels.movement(classLabel(id.slice('movement:'.length) as BatchClassId)) : L.parcels[id as 'expected' | 'criterion' | 'outside' | 'opening']);
  const rank = { P: 0, D: 1, B: 2 } as const;
  const sortedAmounts = (amounts: ReadonlyMap<string, { column: 'P' | 'D' | 'B'; amountCents: number }>) =>
    [...amounts].sort(([x, a], [y, b]) => rank[a.column] - rank[b.column] || (x < y ? -1 : x > y ? 1 : 0));

  // ── Rows of every sheet, known before writing (the formulas of each sheet reference the others) ──

  // Folha_Escopo: the verbas of the scope of the profile.
  const scopeRows = scope ? sortedAmounts(scope.amounts).map(([code, v]) => ({ code, ...v })) : [];
  // Folha_Filial: the branch blocks of the contract of the scope, once each (as the integration takes them, expected.ts).
  const branchRows: { company: string; branch: string; contract: string; code: string; column: 'P' | 'D' | 'B'; amountCents: number; line: number }[] = [];
  {
    const seen = new Set<string>();
    for (const s of report.scopes) {
      if (s.level !== 'branch' || s.contractType !== profile.payrollReport.scope.contractType || s.branch === null) continue;
      const id = `${s.company}|${s.branch}`;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const [code, v] of sortedAmounts(s.amounts)) branchRows.push({ company: s.company, branch: s.branch, contract: s.contractType, code, column: v.column, amountCents: v.amountCents, line: s.labelLine });
    }
  }

  // Criterios: the verbas of each account of Padrão A (criterion and settlement verbas).
  const criteriaRows: { account: PayrollProfileConfig['accounts'][number]; role: 'criterion' | 'settlement'; code: string; sign: 1 | -1 | null; configured: string | null }[] = [];
  for (const a of profile.accounts) {
    if (a.mode === 'verbas') {
      for (const v of a.verbas) criteriaRows.push({ account: a, role: 'criterion', code: v.code, sign: v.sign, configured: v.column ?? null });
      for (const code of a.settlementVerbas ?? []) criteriaRows.push({ account: a, role: 'settlement', code, sign: null, configured: null });
    } else if (a.mode === 'netPay') criteriaRows.push({ account: a, role: 'criterion', code: a.netPayCode, sign: 1, configured: null });
  }

  // Integracao: the keys branch × verba of the engine, account by account.
  const keyRows = analyzed.flatMap((a) => (a.integration?.keys ?? []).map((k) => ({ a, k })));

  // Razao: per account analyzed, the opening balance of the competence by balance type, then its lines.
  const ledgerRows: LedgerRow[] = [];
  for (const a of analyzed) {
    const view = analysis.ledger.accounts.find((v) => v.account === a.account)!;
    for (const t of ['1', '9'] as const) {
      const part = view.types[t];
      if (!part) continue;
      const c = part.competenceOpening;
      ledgerRows.push({ account: a, type: t, line: null, debit: c < 0 ? -c : 0, credit: c > 0 ? c : 0, date: analysis.competence.first, parcel: parcelCode('opening'), settled: false, checked: false, file: part.file });
    }
    const parcelOf = new Map<number, string>();
    for (const p of a.bridge?.parcels ?? []) for (const i of p.lines) if (!parcelOf.has(i)) parcelOf.set(i, parcelCode(p.id));
    const settled = new Set(a.settlement?.settled ?? []);
    a.lines.forEach((l, i) => {
      ledgerRows.push({ account: a, type: l.balanceType, line: l, debit: l.debit, credit: l.credit, date: l.date, parcel: parcelOf.get(i) ?? '', settled: settled.has(i), checked: l.batchClass === 'integration' && l.verba !== null, file: l.file });
    });
  }

  // Ponte: one block per account analyzed.
  const bridgeBlocks: BridgeBlock[] = [];
  {
    let r = 4;
    for (const a of analyzed) {
      const bar = r;
      const firstParcel = r + 2;
      const parcels = a.bridge!.parcels.map((p, i) => ({ code: parcelCode(p.id), label: parcelLabel(p.id), amount: p.amount, row: firstParcel + i }));
      let next = firstParcel + parcels.length;
      const total = next++;
      const types = (['1', '9'] as const).filter((t) => a.balanceByType[t] !== undefined).map((t) => ({ type: t, row: next++, amount: a.balanceByType[t]! }));
      const combined = next++;
      const closes = next++;
      const difference = next++;
      bridgeBlocks.push({ account: a, bar, firstParcel, parcels, total, types, combined, closes, difference });
      r = difference + 2;
    }
  }
  const bridgeLast = bridgeBlocks.length ? bridgeBlocks[bridgeBlocks.length - 1]!.difference : 4;

  // ── Layouts of the data sheets ──
  const CR = L.criteria.cols;
  const CRITERIA = new Layout(
    SHEET.criteria,
    [
      col('tickMark', CR.tickMark, 9, 'center'),
      col('account', CR.account, 16, 'text'),
      col('name', CR.name, 26, 'wrap'),
      col('mode', CR.mode, 14, 'text'),
      col('naturalSide', CR.naturalSide, 9, 'center'),
      col('role', CR.role, 16, 'text'),
      col('verba', CR.verba, 8, 'center'),
      col('description', CR.description, 20, 'text'),
      col('sign', CR.sign, 7, 'id'),
      col('configuredColumn', CR.configuredColumn, 10, 'center'),
      col('column', CR.column, 10, 'center'),
      col('columnMatches', CR.columnMatches, 11, 'center'),
      col('amount', CR.amount, 15, 'money', 'helper'),
      col('contribution', CR.contribution, 15, 'money', 'helper'),
    ],
    criteriaRows.length,
    5,
  );
  const PS = L.payrollScope.cols;
  const SCOPE = new Layout(
    SHEET.payrollScope,
    [
      col('verba', PS.verba, 9, 'center'),
      col('description', PS.description, 26, 'text'),
      col('column', PS.column, 8, 'center'),
      col('amount', PS.amount, 16, 'money'),
      col('branches', PS.branches, 16, 'money', 'helper'),
      col('branchesMatch', PS.branchesMatch, 14, 'center', 'helper'),
    ],
    scopeRows.length,
  );
  const PB = L.payrollBranch.cols;
  const BRANCH = new Layout(
    SHEET.payrollBranch,
    [
      col('company', PB.company, 18, 'text'),
      col('branch', PB.branch, 8, 'center'),
      col('contract', PB.contract, 14, 'center'),
      col('verba', PB.verba, 8, 'center'),
      col('description', PB.description, 26, 'text'),
      col('column', PB.column, 8, 'center'),
      col('amount', PB.amount, 16, 'money'),
      col('line', PB.line, 10, 'int'),
    ],
    branchRows.length,
  );
  const IC = L.integration.cols;
  const INTEGRATION = new Layout(
    SHEET.integration,
    [
      col('account', IC.account, 16, 'text'),
      col('branch', IC.branch, 9, 'center'),
      col('verba', IC.verba, 8, 'center'),
      col('description', IC.description, 22, 'text'),
      col('column', IC.column, 8, 'center'),
      col('role', IC.role, 20, 'text'),
      col('sign', IC.sign, 7, 'id'),
      col('payroll', IC.payroll, 16, 'money', 'helper'),
      col('ledger', IC.ledger, 16, 'money', 'helper'),
      col('difference', IC.difference, 16, 'money', 'helper'),
      col('lines', IC.lines, 10, 'int', 'helper'),
      col('status', IC.status, 20, 'center', 'helper'),
      col('code', IC.code, 11, 'center', 'helper'),
      col('engine', IC.engine, 20, 'center'),
      col('matchesEngine', IC.matchesEngine, 12, 'center', 'helper'),
    ],
    keyRows.length,
  );
  const RC = L.ledger.cols;
  const LEDGER = new Layout(
    SHEET.ledger,
    [
      col('account', RC.account, 16, 'text'),
      col('naturalSide', RC.naturalSide, 9, 'center'),
      col('kind', RC.kind, 18, 'text'),
      col('balanceType', RC.balanceType, 15, 'center'),
      col('date', RC.date, 11, 'date'),
      col('key', RC.key, 20, 'center'),
      col('history', RC.history, 40, 'text'),
      col('branch', RC.branch, 9, 'center'),
      col('costCenter', RC.costCenter, 11, 'center'),
      col('counterpart', RC.counterpart, 16, 'text'),
      col('batchClass', RC.batchClass, 18, 'text'),
      col('verba', RC.verba, 8, 'center'),
      col('debit', RC.debit, 14, 'money'),
      col('credit', RC.credit, 14, 'money'),
      col('amount', RC.amount, 15, 'money', 'helper'),
      col('parcel', RC.parcel, 8, 'center'),
      col('parcelLabel', RC.parcelLabel, 36, 'text'),
      col('settled', RC.settled, 12, 'center'),
      col('checked', RC.checked, 12, 'center'),
      col('file', RC.file, 20, 'text'),
      col('source', RC.source, 10, 'int'),
    ],
    ledgerRows.length,
  );

  const w = new XlsxWriter();
  const T = createTheme(w.styles);
  const totalMoney = w.styles.style({ border: 'box', borderColor: COLORS.grid, fill: COLORS.light, font: { size: 10, bold: true }, numFmt: FORMATS.moneySummary, align: { h: 'right', v: 'center' } });
  const totalCenter = w.styles.style({ border: 'box', borderColor: COLORS.grid, fill: COLORS.light, font: { size: 10, bold: true }, align: { h: 'center', v: 'center' } });
  const editText = w.styles.style({ fill: COLORS.inputFill, font: { size: 10, color: COLORS.inputFont }, border: 'box', borderColor: COLORS.inputBorder, align: { h: 'left', v: 'center', wrap: true, indent: 1 } });
  const dash = { v: L.dash, s: T.center };
  const failed = input.confirmedFailures;
  const statusRule = (sheet: SheetWriter, sqref: string, top: string, ok: string, bad: string) => {
    sheet.conditional({ sqref, formula: `${top}=${str(bad)}`, style: { fill: COLORS.badFill, font: { bold: true, color: COLORS.badFont } } });
    sheet.conditional({ sqref, formula: `${top}=${str(ok)}`, style: { fill: COLORS.okFill, font: { bold: true, color: COLORS.okFont } } });
  };
  const header = (sheet: SheetWriter, layout: Layout) => sheet.row(layout.cols.map((c) => ({ v: c.header, s: T.head[c.group] })), { height: headerHeight(layout.cols) });
  const dataSheet = (layout: Layout) => {
    const sheet = w.addSheet(layout.sheet, { columns: layout.cols.map((c) => ({ width: c.width })), freeze: { rows: 1, cols: 0 }, autoFilter: `A1:${layout.lastRef}`, zoom: 90 });
    header(sheet, layout);
    return sheet;
  };
  /** A data row: cells by column id (missing = empty with the column's style). */
  const dataRow = (sheet: SheetWriter, layout: Layout, cells: Record<string, CellInput>) =>
    sheet.row(
      layout.cols.map((c) => {
        const v = cells[c.id];
        if (v === undefined || v === null || v === '') return null;
        return typeof v === 'object' ? { s: T.kind[c.kind], ...v } : { v, s: T.kind[c.kind] };
      }),
      { styles: layout.cols.map((c) => T.kind[c.kind]) },
    );
  const money = (cents: number): Cell | null => (cents === 0 ? null : { v: reais(cents) });

  // The ranges the formulas use.
  const R = (id: string) => LEDGER.range(id);
  const ledgerOf = (account: string, ...more: string[]) => `SUMIFS(${R('amount')},${R('account')},${account}${more.length ? `,${more.join(',')}` : ''})`;
  const isEntry = `${R('kind')},${str(L.lineKinds.entry)}`;
  const checkedCrit = `${R('checked')},${YES}`;
  const expectedOf = (account: string) => `SUMIFS(${CRITERIA.range('contribution')},${CRITERIA.range('account')},${account})`;

  // ════════ Resumo ════════
  const accountsFirst = 7;
  const accountsLast = accountsFirst + analysis.accounts.length - 1;
  const tiesFirst = accountsLast + 4;
  const PAYROLL_TIES = 6;
  {
    const S = L.summary;
    const C = S.cols;
    const widths = [9, 16, 28, 8, 15, 15, 15, 15, 15, 26, 18, 14, 18, 36, 15];
    const last = colName(widths.length - 1);
    const sheet = w.addSheet(SHEET.summary, { columns: widths.map((width) => ({ width })), showGridLines: false, tabColor: COLORS.navy, fitToWidth: true });
    sheet.row([{ v: S.title, s: T.title }], { height: 30 });
    sheet.row([{ v: S.subtitle(period, scopeText, input.generatedAt), s: T.subtitle }]);
    sheet.row([{ v: failed.length ? S.failBanner(input.generatedAt) : S.okBanner, s: failed.length ? T.fail : T.ok }, ...Array.from({ length: widths.length - 1 }, () => ({ v: null, s: failed.length ? T.fail : T.ok }))], { height: 24 });
    sheet.merge(`A3:${last}3`);
    const section = (text: string) => {
      sheet.skip(1);
      const r = sheet.row([{ v: text, s: T.section }, ...Array.from({ length: widths.length - 1 }, () => ({ v: null, s: T.section }))], { height: 22 });
      sheet.merge(`A${r}:${last}${r}`);
    };

    // 1. The accounts of the profile.
    section(S.accounts);
    const cols = [C.tickMark, C.account, C.name, C.pattern, C.expected, C.real, C.preEntry, C.balance, C.difference, C.situation, C.settlement, C.settled, C.userStatus, C.justification, C.matches];
    sheet.row(
      cols.map((v, i) => ({ v, s: i === 12 || i === 13 ? T.head.edit : T.headSummary })),
      { height: headerHeight(cols.map((h, i) => ({ header: h, width: widths[i]! }))) },
    );
    const justificationOf = new Map<string, ReconciliationExportJustification>();
    for (const j of input.justifications) if (!justificationOf.has(j.account)) justificationOf.set(j.account, j);
    const IN = (id: string) => INTEGRATION.range(id);
    const tieRange = `$J$${tiesFirst}:$J$${tiesFirst + PAYROLL_TIES - 1}`;
    analysis.accounts.forEach((a, i) => {
      const r = accountsFirst + i;
      if (sheet.nextRow !== r) throw new Error(`Resumo: linha ${sheet.nextRow} no lugar de ${r}`);
      const j = justificationOf.get(a.account);
      const B = `$B${r}`;
      const block = bridgeBlocks.find((x) => x.account === a);
      const base: CellInput[] = [
        { v: a.tickMark, s: T.center },
        { v: a.account, s: T.text },
        { v: a.name, s: T.label },
        { v: a.mode === 'provision' ? 'B' : 'A', s: T.center },
      ];
      const user: CellInput[] = [
        { v: j?.status ?? null, s: editText },
        { v: j?.text.trim() ? j.text : null, s: editText },
      ];
      const height = Math.max(20, textHeight(a.name, widths[2]!, 10), textHeight(j?.text ?? '', widths[13]!, 10), textHeight(a.reason ?? (a.situation ? L.situations[a.situation] : ''), widths[9]!, 10));
      if (a.status !== 'analyzed' || !block) {
        sheet.row([...base, dash, dash, dash, dash, dash, { v: a.reason, s: T.text }, dash, dash, ...user, dash], { height });
        return;
      }
      const typeCell = (t: '1' | '9'): Cell => (a.balanceByType[t] === undefined ? { v: L.notLoaded, s: T.center } : { f: ledgerOf(B, `${R('balanceType')},${str(L.balanceTypes[t])}`), s: T.money });
      const conditions = [
        `${q(SHEET.bridge)}!$C$${block.closes}=${YES}`,
        `COUNTIF(${q(SHEET.bridge)}!$E$${block.firstParcel}:$E$${block.difference},${NO})=0`,
        equalMoney(`SUMIFS(${IN('ledger')},${IN('account')},${B})`, ledgerOf(B, checkedCrit)),
        `SUMIFS(${IN('lines')},${IN('account')},${B})=COUNTIFS(${R('account')},${B},${checkedCrit})`,
        equalMoney(`SUMIFS(${IN('payroll')},${IN('account')},${B},${IN('role')},${str(L.roles.criterion)})`, `E${r}`),
        `COUNTIFS(${IN('account')},${B},${IN('matchesEngine')},${NO})=0`,
        `COUNTIF(${tieRange},${str(L.check)})=0`,
      ];
      sheet.row(
        [
          ...base,
          { f: expectedOf(B), s: T.money },
          typeCell('1'),
          typeCell('9'),
          { f: ledgerOf(B), s: T.money },
          { f: `ROUND(E${r}-H${r},2)`, s: T.money },
          { v: L.situations[a.situation!], s: T.text },
          { v: L.settlements[a.settlement!.situation], s: T.center },
          { f: `ABS(${ledgerOf(B, `${R('settled')},${YES}`)})`, s: T.money },
          ...user,
          { f: matches(`AND(${conditions.join(',')})`), s: T.center },
        ],
        { height },
      );
    });
    if (analysis.accounts.length > 0) statusRule(sheet, `O${accountsFirst}:O${accountsLast}`, `O${accountsFirst}`, L.matches, L.check);

    // 2. The tie-outs of the workbook (section 10): the payroll of the scope (the first rows, in every account's
    // "Confere"), then the integration, the bridge and the ledger as a whole.
    const tieTable = (title: string, titles: readonly string[], items: { label: string; value: string; reference: CellInput; s?: number }[], first: number | null) => {
      section(title);
      const head = sheet.row([{ v: titles[0]!, s: T.headSummary }, ...[1, 2, 3, 4, 5].map(() => ({ v: null, s: T.headSummary })), ...titles.slice(1).map((v) => ({ v, s: T.headSummary }))], { height: 20 });
      sheet.merge(`A${head}:F${head}`);
      if (first !== null && sheet.nextRow !== first) throw new Error(`Resumo: amarrações na linha ${sheet.nextRow} no lugar de ${first}`);
      const from = sheet.nextRow;
      for (const t of items) {
        const r = sheet.nextRow;
        const s = t.s ?? T.money;
        sheet.row(
          [
            { v: t.label, s: T.label },
            ...[1, 2, 3, 4, 5].map(() => ({ v: null, s: T.label })),
            { f: t.value, s },
            typeof t.reference === 'object' && t.reference !== null ? { s, ...t.reference } : { v: t.reference, s },
            { f: `ROUND(G${r}-H${r},2)`, s },
            { f: matches(`ROUND(G${r}-H${r},2)=0`), s: T.center },
          ],
          { height: Math.max(18, textHeight(t.label, widths.slice(0, 6).reduce((x, y) => x + y, 0), 10)) },
        );
        sheet.merge(`A${r}:F${r}`);
      }
      statusRule(sheet, `J${from}:J${sheet.nextRow - 1}`, `J${from}`, L.matches, L.check);
    };
    const footer = scope?.footer ?? { earningsCents: 0, deductionsCents: 0, netCents: 0 };
    const SC = (id: string) => SCOPE.range(id);
    const netPayCode = profile.payrollReport.netPayCode;
    const byCompany = profile.payrollReport.scope.level === 'company' && scope ? `,${BRANCH.range('company')},${critEq(scope.company)}` : '';
    const tieTop = sheet.nextRow + 3;
    tieTable(
      S.ties,
      S.tieCols,
      [
        { label: S.tie.earnings, value: `SUMIFS(${SC('amount')},${SC('column')},"P")`, reference: reais(footer.earningsCents) },
        { label: S.tie.deductions, value: `SUMIFS(${SC('amount')},${SC('column')},"D")`, reference: reais(footer.deductionsCents) },
        { label: S.tie.net, value: `ROUND(G${tieTop}-G${tieTop + 1},2)`, reference: reais(footer.netCents) },
        { label: S.tie.netPay(netPayCode), value: `SUMIFS(${SC('amount')},${SC('verba')},${critEq(netPayCode)},${SC('column')},"B")`, reference: reais(footer.netCents) },
        { label: S.tie.branchVerbas, value: `COUNTIF(${SC('branchesMatch')},${NO})`, reference: 0, s: T.int },
        { label: S.tie.branchTotal, value: byCompany ? `SUMIFS(${BRANCH.range('amount')}${byCompany})` : `SUM(${BRANCH.range('amount')})`, reference: { f: `SUM(${SC('amount')})` } },
        { label: S.tie.integrationLedger, value: `SUM(${IN('ledger')})`, reference: { f: `SUMIFS(${R('amount')},${checkedCrit})` } },
        { label: S.tie.integrationEngine, value: `COUNTIF(${IN('matchesEngine')},${NO})`, reference: 0, s: T.int },
        { label: S.tie.bridgeOpen, value: `COUNTIF(${q(SHEET.bridge)}!$C$1:$C$${bridgeLast},${NO})`, reference: 0, s: T.int },
        { label: S.tie.bridgeEngine, value: `COUNTIF(${q(SHEET.bridge)}!$E$1:$E$${bridgeLast},${NO})`, reference: 0, s: T.int },
        { label: S.tie.ledgerLines, value: `COUNTIFS(${isEntry})`, reference: analyzed.reduce((n, a) => n + a.lines.length, 0), s: T.int },
      ],
      tiesFirst,
    );

    // 3. The key figures: by the workbook, next to the engine's.
    const accountsRange = (l: string) => `$${l}$${accountsFirst}:$${l}$${Math.max(accountsFirst, accountsLast)}`;
    const F = S.figure;
    const figuresTop = sheet.nextRow + 3;
    const fig = summary.figures;
    tieTable(
      S.figures,
      S.figureCols,
      [
        { label: F.accounts, value: `COUNTA(${accountsRange('B')})`, reference: fig.accounts, s: T.int },
        { label: F.analyzed, value: `COUNTIF(${accountsRange('O')},${str(L.matches)})+COUNTIF(${accountsRange('O')},${str(L.check)})`, reference: fig.analyzed, s: T.int },
        { label: F.matching, value: `COUNTIF(${accountsRange('O')},${str(L.matches)})`, reference: fig.analyzed, s: T.int },
        { label: F.noDifference, value: `COUNTIF(${accountsRange('I')},0)`, reference: fig.noDifference, s: T.int },
        { label: F.withDifference, value: `G${figuresTop + 1}-G${figuresTop + 3}`, reference: fig.withDifference, s: T.int },
        { label: F.integrationErrors, value: `COUNTIF(${IN('status')},${str(L.keyStatus.different)})`, reference: fig.integrationErrors, s: T.int },
        { label: F.missingIntegration, value: `COUNTIF(${IN('status')},${str(L.keyStatus.missing)})`, reference: fig.missingIntegration, s: T.int },
        { label: F.checkedLines, value: `COUNTIF(${R('checked')},${YES})`, reference: fig.checkedLines, s: T.int },
      ],
      figuresTop,
    );

    // 4. How to read it.
    section(S.notes);
    const width = widths.reduce((x, y) => x + y, 0);
    const r = sheet.row([{ v: S.note, s: T.paragraph }], { height: textHeight(S.note, width, 10) });
    sheet.merge(`A${r}:${last}${r}`);
    sheet.end();
  }
  progress();

  // ════════ Criterios ════════
  {
    const CRL = L.criteria;
    const widths = CRITERIA.cols.map((c) => c.width);
    const sheet = w.addSheet(SHEET.criteria, { columns: widths.map((width) => ({ width })), showGridLines: false, fitToWidth: true, freeze: { rows: 4, cols: 0 } });
    const tr = new TraceSheet(sheet, T, widths);
    sheet.row([{ v: CRL.title, s: T.title }], { height: 30 });
    sheet.skip(1);
    sheet.row([{ v: CRL.verbas, s: T.h2 }], { height: 22 });
    header(sheet, CRITERIA);
    const columnOf = (code: string) => report.columnOf.get(code) ?? null;
    for (const x of criteriaRows) {
      const r = sheet.nextRow;
      const a = x.account;
      const found = columnOf(x.code);
      const columnMatches = x.configured === null || found === null || x.configured === found;
      dataRow(sheet, CRITERIA, {
        tickMark: a.tickMark,
        account: a.account,
        name: a.name,
        mode: L.modes[a.mode],
        naturalSide: a.naturalSide,
        role: L.roles[x.role],
        verba: x.code,
        description: report.descriptions.get(x.code) ?? '',
        sign: x.sign,
        configuredColumn: x.configured ?? L.dash,
        column: found ?? L.dash,
        columnMatches: columnMatches ? L.yes : L.no,
        amount: { f: `SUMIFS(${SCOPE.range('amount')},${SCOPE.range('verba')},$G${r})` },
        contribution: x.sign === null ? null : { f: `$I${r}*$M${r}` },
      });
    }
    if (criteriaRows.length === 0) sheet.skip(1);

    tr.heading(CRL.profile);
    const kv = (label: string, value: string) => tr.cellsSpan([{ cell: { v: label, s: T.kvLabel }, span: 3 }, { cell: { v: value, s: T.kvValue }, span: widths.length - 3 }], 18);
    kv(CRL.scope, `GPER040 · ${scopeText}`);
    kv(CRL.netPayCode, profile.payrollReport.netPayCode);
    kv(CRL.verbaFromHistory, profile.ledger.verbaFromHistory);
    kv(CRL.maxCandidates, String(profile.settlementSearch.maxCandidates));
    kv(CRL.statuses, (profile.workpaperStatuses ?? []).join(' · ') || CRL.none);

    tr.heading(CRL.classes);
    const classSpans = [3, 3, 3, widths.length - 9];
    tr.cellsSpan(CRL.classCols.map((v, i) => ({ cell: { v, s: T.headSummary }, span: classSpans[i]! })), 20);
    for (const c of profile.ledger.batchClasses) {
      const values = [c.id, c.label, c.match.prefix ?? L.dash, c.match.pattern ?? L.dash];
      tr.cellsSpan(values.map((v, i) => ({ cell: { v, s: i === 0 ? T.center : T.text }, span: classSpans[i]! })), 18);
    }

    tr.heading(CRL.texts);
    tr.cellsSpan([{ cell: { v: CRL.textCols[0]!, s: T.headSummary } }, { cell: { v: CRL.textCols[1]!, s: T.headSummary } }, { cell: { v: CRL.textCols[2]!, s: T.headSummary }, span: widths.length - 2 }], 20);
    const textWidth = widths.slice(2).reduce((x, y) => x + y, 0);
    for (const a of analyzed) {
      tr.cellsSpan([{ cell: { v: a.tickMark, s: T.center } }, { cell: { v: a.account, s: T.text } }, { cell: { v: a.narrative, s: T.paragraph }, span: widths.length - 2 }], Math.max(20, textHeight(a.narrative, textWidth, 10)));
    }

    tr.heading(CRL.rules);
    const ruleWidth = widths.slice(3).reduce((x, y) => x + y, 0);
    for (const [title, body] of CRL.rule) tr.cellsSpan([{ cell: { v: title, s: T.kvLabel }, span: 3 }, { cell: { v: body, s: T.kvValue }, span: widths.length - 3 }], Math.max(18, textHeight(body, ruleWidth, 10)));
    sheet.end();
  }
  progress();

  // ════════ Folha_Escopo ════════
  {
    const sheet = dataSheet(SCOPE);
    const byCompany = profile.payrollReport.scope.level === 'company' && scope ? `,${BRANCH.range('company')},${critEq(scope.company)}` : '';
    for (const x of scopeRows) {
      const r = sheet.nextRow;
      dataRow(sheet, SCOPE, {
        verba: x.code,
        description: report.descriptions.get(x.code) ?? '',
        column: x.column,
        amount: { v: reais(x.amountCents) },
        branches: { f: `SUMIFS(${BRANCH.range('amount')},${BRANCH.range('verba')},$A${r}${byCompany})` },
        branchesMatch: { f: yesNo(equalMoney(`D${r}`, `E${r}`)) },
      });
    }
    sheet.end();
  }
  progress();

  // ════════ Folha_Filial ════════
  {
    const sheet = dataSheet(BRANCH);
    for (const x of branchRows) {
      dataRow(sheet, BRANCH, { company: x.company, branch: x.branch, contract: x.contract, verba: x.code, description: report.descriptions.get(x.code) ?? '', column: x.column, amount: { v: reais(x.amountCents) }, line: x.line });
    }
    sheet.end();
  }
  progress();

  // ════════ Integracao ════════
  {
    const sheet = dataSheet(INTEGRATION);
    const signOf = (a: PayrollAccountResult, k: IntegrationKey): 1 | -1 => {
      if (k.role !== 'criterion') return 1;
      const config = profile.accounts.find((x) => x.account === a.account);
      if (config?.mode === 'verbas') return config.verbas.find((v) => v.code === k.verba)?.sign ?? 1;
      return k.column === 'D' ? -1 : 1;
    };
    const status = `IF($K{r}>0,IF(${equalMoney('ABS($I{r})', 'ABS($H{r})')},${str(L.keyStatus.equal)},${str(L.keyStatus.different)}),IF(ROUND($H{r},2)<>0,${str(L.keyStatus.missing)},${str(L.keyStatus.zero)}))`;
    for (const { a, k } of keyRows) {
      const r = sheet.nextRow;
      const at = (s: string) => s.replace(/\{r\}/g, String(r));
      const keyCrit = `${R('account')},$A${r},${R('branch')},$B${r},${R('verba')},$C${r},${checkedCrit}`;
      const outside = k.role === 'outside';
      const outsideCode = a.mode === 'netPay' && report.columnOf.get(k.verba) === 'B' ? 'F1e' : 'F1b';
      const different = `$L${r}=${str(L.keyStatus.different)}`;
      dataRow(sheet, INTEGRATION, {
        account: a.account,
        branch: k.branch,
        verba: k.verba,
        description: report.descriptions.get(k.verba) ?? '',
        column: k.column ?? L.dash,
        role: L.roles[k.role],
        sign: signOf(a, k),
        payroll: { f: `$G${r}*SUMIFS(${BRANCH.range('amount')},${BRANCH.range('branch')},$B${r},${BRANCH.range('verba')},$C${r})` },
        ledger: { f: `SUMIFS(${R('amount')},${keyCrit})` },
        difference: { f: `ROUND(ABS($I${r})-ABS($H${r}),2)` },
        lines: { f: `COUNTIFS(${keyCrit})` },
        status: { f: at(status) },
        code: { f: outside ? `IF(${different},"F1a; ","")&${str(outsideCode)}` : `IF(${different},"F1a",IF($L${r}=${str(L.keyStatus.missing)},"F1c",""))` },
        engine: L.keyStatus[k.status],
        matchesEngine: { f: yesNo(`$L${r}=$N${r}`) },
      });
    }
    if (keyRows.length > 0) statusRule(sheet, `O2:O${keyRows.length + 1}`, 'O2', L.yes, L.no);
    sheet.end();
  }
  progress();

  // ════════ Razao ════════
  {
    const sheet = dataSheet(LEDGER);
    const classOf = (id: string) => classLabel(id as BatchClassId);
    const labelOf = new Map<string, string>();
    for (const a of analyzed) for (const p of a.bridge?.parcels ?? []) labelOf.set(parcelCode(p.id), parcelLabel(p.id));
    for (const x of ledgerRows) {
      const r = sheet.nextRow;
      const l = x.line;
      dataRow(sheet, LEDGER, {
        account: x.account.account,
        naturalSide: x.account.naturalSide,
        kind: l ? L.lineKinds.entry : L.lineKinds.opening,
        balanceType: L.balanceTypes[x.type],
        date: dateCell(x.date),
        key: l?.key ?? null,
        history: l?.history ?? null,
        branch: l?.ledgerBranch ?? null,
        costCenter: l?.costCenter ?? null,
        counterpart: l?.counterpart ?? null,
        batchClass: l ? classOf(l.batchClass) : null,
        verba: l?.verba ?? null,
        debit: money(x.debit),
        credit: money(x.credit),
        amount: { f: `ROUND(IF($B${r}="D",$M${r}-$N${r},$N${r}-$M${r}),2)` },
        parcel: x.parcel,
        parcelLabel: labelOf.get(x.parcel) ?? '',
        settled: x.settled ? L.yes : L.no,
        checked: x.checked ? L.yes : L.no,
        file: state.ledgers[x.file]?.name ?? '',
        source: l?.source ?? null,
      });
    }
    sheet.end();
  }
  progress();

  // ════════ Ponte ════════
  {
    const B = L.bridge;
    const widths = [9, 56, 16, 16, 12, 12, 16, 16];
    const last = colName(widths.length - 1);
    const sheet = w.addSheet(SHEET.bridge, { columns: widths.map((width) => ({ width })), showGridLines: false, fitToWidth: true });
    sheet.row([{ v: B.title, s: T.title }], { height: 30 });
    {
      const r = sheet.row([{ v: B.note, s: T.note }], { height: textHeight(B.note, widths.reduce((x, y) => x + y, 0), 9) });
      sheet.merge(`A${r}:${last}${r}`);
    }
    sheet.skip(1);
    if (bridgeBlocks.length === 0) sheet.row([{ v: B.none, s: T.desc }]);
    const compare = (r: number) => ({ f: yesNo(equalMoney(`C${r}`, `D${r}`)), s: T.center });
    for (const b of bridgeBlocks) {
      const a = b.account;
      const acct = critEq(a.account);
      if (sheet.nextRow !== b.bar) throw new Error(`Ponte: linha ${sheet.nextRow} no lugar de ${b.bar}`);
      const bar = sheet.row([{ v: `${a.tickMark} · ${a.account} · ${a.name}`, s: T.section }, ...Array.from({ length: widths.length - 1 }, () => ({ v: null, s: T.section }))], { height: 22 });
      sheet.merge(`A${bar}:${last}${bar}`);
      sheet.row(B.cols.map((v) => ({ v, s: T.headSummary })), { height: headerHeight(B.cols.map((h, i) => ({ header: h, width: widths[i]! }))) });
      const p1 = b.firstParcel;
      for (const p of b.parcels) {
        const r = p.row;
        const of = (...more: string[]) => `SUMIFS(${R('amount')},${R('account')},${acct},${R('parcel')},${str(p.code)}${more.length ? `,${more.join(',')}` : ''})`;
        const lines = p.code === 'P1';
        sheet.row([
          { v: p.code, s: T.center },
          { v: p.label, s: T.label },
          { f: p.code === 'P1' ? expectedOf(acct) : p.code === 'P2' ? `${of()}-C${p1}` : of(), s: T.money },
          { v: reais(p.amount), s: T.money },
          compare(r),
          lines ? { v: null, s: T.int } : { f: `COUNTIFS(${R('account')},${acct},${R('parcel')},${str(p.code)},${isEntry})`, s: T.int },
          lines ? { v: null, s: T.money } : { f: of(isEntry, `${R('balanceType')},${str(L.balanceTypes['1'])}`), s: T.money },
          lines ? { v: null, s: T.money } : { f: of(isEntry, `${R('balanceType')},${str(L.balanceTypes['9'])}`), s: T.money },
        ]);
      }
      const totalRow = (label: string, value: Cell, engine: Cell, check: Cell) =>
        sheet.row([{ v: null, s: T.totalBlank }, { v: label, s: T.totalLabel }, value, engine, check, { v: null, s: T.totalBlank }, { v: null, s: T.totalBlank }, { v: null, s: T.totalBlank }], { height: 18 });
      totalRow(B.total, { f: `SUM(C${p1}:C${b.total - 1})`, s: totalMoney }, { v: reais(a.bridge!.total), s: totalMoney }, compare(b.total));
      for (const t of b.types) totalRow(B.balanceOf(L.balanceTypes[t.type]), { f: ledgerOf(acct, `${R('balanceType')},${str(L.balanceTypes[t.type])}`), s: totalMoney }, { v: reais(t.amount), s: totalMoney }, compare(t.row));
      totalRow(B.combined, { f: ledgerOf(acct), s: totalMoney }, { v: reais(a.ledgerBalance), s: totalMoney }, compare(b.combined));
      totalRow(B.closes, { f: yesNo(equalMoney(`C${b.total}`, `C${b.combined}`)), s: totalCenter }, { v: a.bridge!.closes ? L.yes : L.no, s: totalCenter }, { f: yesNo(`C${b.closes}=D${b.closes}`), s: T.center });
      totalRow(B.difference, { f: `ROUND(C${p1}-C${b.combined},2)`, s: totalMoney }, { v: reais(a.difference), s: totalMoney }, compare(b.difference));
      statusRule(sheet, `E${p1}:E${b.difference}`, `E${p1}`, L.yes, L.no);
      sheet.skip(1);
    }
    sheet.end();
  }
  progress();

  // ════════ Rastreabilidade ════════
  {
    const TR = L.trace;
    const TW = [30, 14, 12, 22, 14, 12, 18, 24, 30, 68];
    const sheet = w.addSheet(SHEET.trace, { columns: TW.map((width) => ({ width })), showGridLines: false, fitToWidth: true });
    const trace = new TraceSheet(sheet, T, TW);
    sheet.row([{ v: TR.title, s: T.title }], { height: 30 });
    trace.heading(TR.kv);
    trace.kv(TR.tool, 'AuditAnalyzer');
    trace.kv(TR.version, input.appVersion);
    trace.kv(TR.generated, input.generatedAt);
    trace.kv(TR.language, language === 'pt' ? 'Português' : 'English');
    trace.kv(TR.period, period);
    trace.kv(TR.scope, `GPER040 · ${scopeText}`);
    trace.kv(TR.configHash, input.configHash);
    trace.kv(TR.accounts, String(profile.accounts.length));
    if (failed.length) trace.confirmed(TR.confirmed.replace('{when}', input.generatedAt));
    trace.heading(TR.configDiff);
    // The accounts of the profile are on Criterios: one line here instead of the whole list.
    const ACCOUNTS = 'profiles.payroll.accounts';
    const differences = input.configDifferences.map((d) => (d.path === ACCOUNTS ? { path: d.path, base: d.base, value: TR.accountsDiff(profile.accounts.length) } : d));
    trace.configDifferences(differences, { none: TR.configDefault, cols: TR.configDiffCols });

    trace.heading(TR.files);
    trace.headRow(TR.fileCols);
    for (const f of reconciliation.files) {
      const role = f.kind === 'payroll' ? (f.used ? TR.roles.payroll : TR.roles.comparedPayroll) : f.kind === 'ledger' ? TR.roles.ledger : TR.roles.other;
      const interval =
        f.kind === 'ledger' ? (f.interval ? TR.interval(formatDay(f.interval.from), formatDay(f.interval.to)) : L.dash) : f.kind === 'payroll' && f.period ? TR.competence(`${f.period.slice(4)}/${f.period.slice(0, 4)}`) : L.dash;
      sheet.row(
        [
          { v: f.name, s: T.text },
          { v: f.size, s: T.int },
          { v: f.kind === 'other' ? (f.report ?? TR.unknown) : f.report, s: T.center },
          { v: f.kind === 'other' ? L.dash : L.formats[f.format], s: T.center },
          { v: f.kind === 'other' ? L.dash : f.encoding, s: T.center },
          f.kind === 'other' ? dash : { v: f.lines, s: T.int },
          { v: f.kind === 'ledger' && f.balanceType ? L.balanceTypes[f.balanceType] : L.dash, s: T.center },
          { v: interval, s: T.center },
          { v: role, s: T.text },
          { v: f.sha256, s: T.text },
        ],
        { height: 18 },
      );
    }

    trace.heading(TR.parameters);
    const spans = [1, 1, 4, 4];
    const ledgers = reconciliation.files.filter((f) => f.kind === 'ledger');
    if (ledgers.length === 0) trace.cellsSpan([{ cell: { v: TR.noParameters, s: T.kvValue }, span: 8 }], 18);
    else {
      trace.cellsSpan(TR.parameterCols.map((v, i) => ({ cell: { v, s: T.headSummary }, span: spans[i]! })), 20);
      for (const f of ledgers) {
        for (const p of f.parameters) {
          const values = [f.name, p.number, p.label, p.value];
          trace.cellsSpan(values.map((v, i) => ({ cell: { v, s: i === 1 ? T.center : T.text }, span: spans[i]! })), 18);
        }
      }
    }

    trace.heading(TR.checks);
    trace.checks(reconciliation.checks, { cols: TR.checkCols, blocking: TR.blocking, warning: TR.warning, passed: TR.passed, failed: TR.failed }, 7);
    sheet.end();
  }
  progress();

  const blob = await w.finish();
  progress();
  return { blob, fileName: reconciliationFileName(language, analysis.period, input.generatedAt), minDateSerial: w.minDateSerial };
}

/** Conciliador_Folha_<AAAA-MM>_<date>.xlsx, like the other modules (CT2_Integridade_<AAAA-MM>_<date>.xlsx). */
export function reconciliationFileName(language: Language, period: string, generatedAt: string): string {
  const month = /^\d{6}$/.test(period) ? `${period.slice(0, 4)}-${period.slice(4)}` : language === 'pt' ? 'sem-competencia' : 'no-period';
  const date = generatedAt.slice(0, 10).split('/').reverse().join('-');
  return RECONCILIATION_LABELS[language].file(month, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : generatedAt.slice(0, 10)).replace(/[\\/:*?"<>|]/g, '-');
}
