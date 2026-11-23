/**
 * Reader S-1, GPER040 (payroll; docs/REGRAS_CONCILIADOR.md, section 4). Receives the lines of the report, already
 * normalized (4.1) by a format adapter (formats/text.ts; the PDF of Phase 16 gives the same lines), and knows no format.
 * A state machine over the line types of 4.2, classified in the order of the table (error 1 of the phase: the label
 * "Empresa: X" without "Contrato do Tipo" opens a totalization and does not change the context), verba lines by the
 * absolute positions of 4.3 (each value is the number that ends at its position), blocks of 4.4 and the footer of 4.5 by
 * a regular expression (never by position). What it cannot read becomes an issue of the invariant it breaks, with the
 * line of the file: the invariants themselves are computed in gper040Checks.ts.
 */
import { centsFromBrText } from '../../../../shared/money';
import type { PayrollColumn, PayrollLevel } from '../../../../shared/modules/reconciliation';
import { ChunkedArray } from '../../../store/chunked';
import { Dictionary } from '../../../store/dictionary';

export const GPER040_LINE_TYPES = [
  'pageRule',
  'pageHeader',
  'companyHeader',
  'processHeader',
  'employeeHeader',
  'employeeData',
  'totalLabel',
  'columnTitle',
  'columnHeader',
  'verbaLine',
  'footer',
  'counts',
  'rule',
  'blank',
  'unknown',
] as const;
export type Gper040LineType = (typeof GPER040_LINE_TYPES)[number];

/** Section 4.2: the first rule that matches, in this order. */
export function gper040LineType(line: string): Gper040LineType {
  if (line.startsWith('****')) return 'pageRule';
  if (line.startsWith('*')) return 'pageHeader';
  if (line.startsWith('Empresa:') && line.includes('Contrato do Tipo :')) return 'companyHeader';
  if (line.startsWith('Processo:')) return 'processHeader';
  if (line.startsWith('C.CUSTO:')) return 'employeeHeader';
  if (line.startsWith('DT.ADM.:') || line.startsWith('Sit. Folha:')) return 'employeeData';
  if (line.startsWith('Filial: ') || line.startsWith('Empresa: ') || line.startsWith('Grupo de Empresas: ')) return 'totalLabel';
  if (line.includes('P R O V E N T O S')) return 'columnTitle';
  if (line.startsWith('COD DESCRICAO')) return 'columnHeader';
  if (line.length >= 95 && line[46] === '|' && line[94] === '|') return 'verbaLine';
  if (line.startsWith('TOTAIS ->')) return 'footer';
  if (line.startsWith('Sit.Normal:') || line.startsWith('Ferias:') || line.startsWith('Total:')) return 'counts';
  if (line.startsWith('----')) return 'rule';
  if (line.trim() === '') return 'blank';
  return 'unknown';
}

/** Contract type of the totalizations that add the others (L-5), as the report prints it. */
export const ALL_CONTRACTS = 'Todos';

export const PAYROLL_COLUMNS: readonly PayrollColumn[] = ['P', 'D', 'B'];

/** Positions of section 4.3 (base 0, end exclusive): the stretch of the column, the code and the end of the value. */
const COLUMN_LAYOUT = [
  { column: 'P', start: 0, end: 46, code: 0, description: [4, 18], valueEnd: 43 },
  { column: 'D', start: 47, end: 94, code: 48, description: [52, 66], valueEnd: 91 },
  { column: 'B', start: 95, end: Infinity, code: 96, description: [100, 118], valueEnd: 129 },
] as const;

const CODE = /^[0-9A-Z]{3}$/;
/** The last token before the end of the value: a number in the format `-?[\d.]*\d,\d\d` (4.3). */
const LAST_TOKEN = /(\S+)$/;
const VALUE = /^-?[\d.]*\d,\d\d$/;
const NUMBER = '(-?[\\d.]*\\d,\\d\\d)';
/** 4.5: references and total of proventos, references and total of descontos, the value after "SALARIO LIQ.". */
const FOOTER = new RegExp(`^TOTAIS ->\\s+${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s+SALARIO LIQ\\.\\s+${NUMBER}\\s*$`);

export interface VerbaCell {
  column: PayrollColumn;
  code: string;
  description: string;
  amountCents: number;
}

/**
 * The verbas of a verba line, or the reason it cannot be read. A filled column needs a code of 3 characters [0-9A-Z]
 * and a value that ends exactly at its position, separated by a space from what comes before it (in column B a value
 * of 12 characters takes the end of the description: the description is what is left before it).
 */
export function parseVerbaLine(line: string): { cells: VerbaCell[] } | { error: string } {
  const cells: VerbaCell[] = [];
  for (const c of COLUMN_LAYOUT) {
    const stretch = line.slice(c.start, Math.min(c.end, line.length));
    if (stretch.trim() === '') continue;
    const code = line.slice(c.code, c.code + 3);
    if (!CODE.test(code)) return { error: `coluna ${c.column} com código "${code.trim()}" fora do formato de 3 letras maiúsculas ou algarismos` };
    const after = line.charAt(c.valueEnd);
    if (after !== '' && after !== ' ' && after !== '|') return { error: `coluna ${c.column} sem valor terminando na posição ${c.valueEnd}` };
    const token = LAST_TOKEN.exec(line.slice(c.code + 3, c.valueEnd))?.[1] ?? '';
    const amountCents = VALUE.test(token) ? centsFromBrText(token) : NaN;
    if (Number.isNaN(amountCents)) return { error: `coluna ${c.column} sem valor terminando na posição ${c.valueEnd}` };
    const valueStart = c.valueEnd - token.length;
    const description = line.slice(c.description[0], Math.min(c.description[1], valueStart)).trim();
    cells.push({ column: c.column, code, description, amountCents });
  }
  return { cells };
}

/** The numbers of a footer line (4.5), by regular expression, or null. */
export function parseFooter(line: string): { earningsCents: number; deductionsCents: number; netCents: number } | null {
  const m = FOOTER.exec(line);
  if (!m) return null;
  const [earningsCents, deductionsCents, netCents] = [m[2]!, m[4]!, m[5]!].map(centsFromBrText) as [number, number, number];
  return Number.isNaN(earningsCents) || Number.isNaN(deductionsCents) || Number.isNaN(netCents) ? null : { earningsCents, deductionsCents, netCents };
}

/** Totals of the footer of a block; NaN when the footer could not be read (an L-2 issue). */
export interface BlockFooter {
  earningsCents: number;
  deductionsCents: number;
  netCents: number;
}

export type PayrollAmounts = Map<string, { column: PayrollColumn; amountCents: number }>;

/** A totalization block (4.4): its scope and, per verba, the sum of its lines (error 4: a code repeats in lines). */
export interface PayrollScope {
  level: PayrollLevel;
  company: string;
  branch: string | null;
  contractType: string;
  /** Lines of the file: the label, the column header that opens the block and the footer that closes it. */
  labelLine: number;
  startLine: number;
  footerLine: number;
  amounts: PayrollAmounts;
  footer: BlockFooter;
  /** "Total:" of the counts after the block, when printed. */
  headcount: number | null;
}

/**
 * Employee blocks, kept compactly for detail (dictionary for the texts, typed arrays for the numbers). The entries of
 * employee `i` are `[entryStart[i], entryStart[i + 1])`, in the order of the lines; `entryColumn` indexes
 * PAYROLL_COLUMNS.
 */
export interface PayrollEmployees {
  count: number;
  registration: Uint32Array;
  costCenter: Uint32Array;
  company: Uint32Array;
  branch: Uint32Array;
  contractType: Uint32Array;
  startLine: Uint32Array;
  footerLine: Uint32Array;
  earningsCents: Float64Array;
  deductionsCents: Float64Array;
  netCents: Float64Array;
  entryStart: Uint32Array;
  entryCode: Uint32Array;
  entryColumn: Uint8Array;
  entryCents: Float64Array;
  entryLine: Uint32Array;
}

export type ReadingInvariant = 'L-1' | 'L-2' | 'L-6' | 'L-7';

/** Something the reading could not accept, for the invariant it breaks (L-1, L-2, L-6, L-7). */
export interface ReadingIssue {
  invariant: ReadingInvariant;
  line: number;
  message: string;
}

export interface PayrollReport {
  /** Competência AAAAMM and payment number (the first ones read; L-7 when there are others). */
  period: string | null;
  paymentNumber: string | null;
  /** Payment date of the process header, as printed (dd/mm/aaaa). */
  paymentDate: string | null;
  periods: Map<string, number>;
  paymentNumbers: Map<string, number>;
  /** Totalization blocks, in the order of the file. */
  scopes: PayrollScope[];
  employees: PayrollEmployees;
  dictionary: Dictionary;
  /** Column of each code (L-6: one only) and the first description read. */
  columnOf: Map<string, PayrollColumn>;
  descriptions: Map<string, string>;
  lineTypes: Record<Gper040LineType, number>;
  lines: number;
  unknownOutsideBlocks: number;
  unknownLines: number[];
  issues: ReadingIssue[];
}

/** Line types allowed between the column header and the footer: verbas and what a page break repeats. */
const INSIDE_BLOCK = new Set<Gper040LineType>(['verbaLine', 'pageRule', 'pageHeader', 'companyHeader', 'processHeader', 'columnTitle', 'rule', 'blank', 'employeeData', 'counts']);

const UNKNOWN_LINES_KEPT = 20;

interface Context {
  company: string;
  branch: string | null;
  contractType: string;
}

type Pending =
  | { kind: 'employee'; line: number; registration: string; costCenter: string }
  | { kind: 'total'; line: number; level: PayrollLevel; branch: string | null };

interface OpenBlock {
  pending: Pending;
  context: Context;
  startLine: number;
  /** Totalization: the sums by code. */
  amounts: PayrollAmounts | null;
  /** Employee: the cells and their lines, stored when the footer closes the block (a block left open is dropped). */
  cells: VerbaCell[];
  cellLines: number[];
}

/** The context of a company header: "Empresa: X   Fil.: NN - …   Contrato do Tipo : Y" (Fil. absent above the branch). */
function companyContext(line: string): Context | null {
  const contractAt = line.indexOf('Contrato do Tipo :');
  const contractType = line.slice(contractAt + 'Contrato do Tipo :'.length).trim();
  const branchAt = line.indexOf('Fil.:');
  const company = line.slice('Empresa:'.length, branchAt >= 0 && branchAt < contractAt ? branchAt : contractAt).trim();
  const branch = branchAt >= 0 && branchAt < contractAt ? (/^Fil\.:\s*(\S+)/.exec(line.slice(branchAt))?.[1] ?? null) : null;
  if (contractType === '' || (branchAt >= 0 && branch === null)) return null;
  return { company, branch, contractType };
}

/** Incremental reader: `push` each line with its number (1-based), then `end`. */
export class Gper040Reader {
  private readonly dictionary = new Dictionary();
  private readonly lineTypes = Object.fromEntries(GPER040_LINE_TYPES.map((t) => [t, 0])) as Record<Gper040LineType, number>;
  private readonly issues: ReadingIssue[] = [];
  private readonly scopes: PayrollScope[] = [];
  private readonly columnOf = new Map<string, PayrollColumn>();
  private readonly columnLine = new Map<string, number>();
  private readonly descriptions = new Map<string, string>();
  private readonly periods = new Map<string, number>();
  private readonly paymentNumbers = new Map<string, number>();
  private paymentDate: string | null = null;
  private context: Context | null = null;
  private pending: Pending | null = null;
  private open: OpenBlock | null = null;
  /** The last block closed was this totalization (it takes the "Total:" that follows). */
  private lastTotal: PayrollScope | null = null;
  private lines = 0;
  private unknownOutsideBlocks = 0;
  private readonly unknownLines: number[] = [];

  private readonly e = {
    registration: new ChunkedArray((n) => new Uint32Array(n)),
    costCenter: new ChunkedArray((n) => new Uint32Array(n)),
    company: new ChunkedArray((n) => new Uint32Array(n)),
    branch: new ChunkedArray((n) => new Uint32Array(n)),
    contractType: new ChunkedArray((n) => new Uint32Array(n)),
    startLine: new ChunkedArray((n) => new Uint32Array(n)),
    footerLine: new ChunkedArray((n) => new Uint32Array(n)),
    earningsCents: new ChunkedArray((n) => new Float64Array(n)),
    deductionsCents: new ChunkedArray((n) => new Float64Array(n)),
    netCents: new ChunkedArray((n) => new Float64Array(n)),
    entryStart: new ChunkedArray((n) => new Uint32Array(n)),
    entryCode: new ChunkedArray((n) => new Uint32Array(n)),
    entryColumn: new ChunkedArray((n) => new Uint8Array(n)),
    entryCents: new ChunkedArray((n) => new Float64Array(n)),
    entryLine: new ChunkedArray((n) => new Uint32Array(n)),
  };
  private employees = 0;
  private entries = 0;

  private issue(invariant: ReadingInvariant, line: number, message: string): void {
    this.issues.push({ invariant, line, message });
  }

  push(line: string, n: number): void {
    this.lines = n;
    const type = gper040LineType(line);
    this.lineTypes[type]++;
    if (this.open) this.inside(type, line, n);
    else this.outside(type, line, n);
  }

  private outside(type: Gper040LineType, line: string, n: number): void {
    switch (type) {
      case 'companyHeader':
        this.companyHeader(line, n);
        break;
      case 'processHeader':
        this.processHeader(line, n);
        break;
      case 'employeeHeader': {
        const costCenter = /^C\.CUSTO:\s*([^\s-]+)/.exec(line)?.[1];
        const registration = /MAT\.:\s*(\S+)/.exec(line)?.[1];
        if (!costCenter || !registration) this.issue('L-1', n, 'cabeçalho de funcionário sem C.CUSTO ou MAT.');
        this.pending = { kind: 'employee', line: n, registration: registration ?? '', costCenter: costCenter ?? '' };
        this.lastTotal = null;
        break;
      }
      case 'totalLabel': {
        const level: PayrollLevel = line.startsWith('Filial: ') ? 'branch' : line.startsWith('Empresa: ') ? 'company' : 'groupOfCompanies';
        const branch = level === 'branch' ? (/^Filial:\s*(\S+)/.exec(line)?.[1] ?? null) : null;
        if (level === 'branch' && branch === null) this.issue('L-1', n, 'rótulo "Filial:" sem o código da filial');
        this.pending = { kind: 'total', line: n, level, branch };
        this.lastTotal = null;
        break;
      }
      case 'columnHeader':
        this.openBlock(n);
        break;
      case 'counts': {
        const total = /^Total:\s*(\d+)/.exec(line)?.[1];
        if (total !== undefined && this.lastTotal) this.lastTotal.headcount = Number(total);
        break;
      }
      case 'verbaLine':
        this.issue('L-1', n, 'linha de verbas fora de um bloco (sem "COD DESCRICAO" antes)');
        break;
      case 'footer':
        this.issue('L-1', n, 'rodapé "TOTAIS ->" sem bloco aberto');
        break;
      case 'unknown':
        this.unknownOutsideBlocks++;
        if (this.unknownLines.length < UNKNOWN_LINES_KEPT) this.unknownLines.push(n);
        break;
      default:
        break;
    }
  }

  private inside(type: Gper040LineType, line: string, n: number): void {
    const open = this.open!;
    if (type === 'verbaLine') {
      this.verbaLine(open, line, n);
    } else if (type === 'footer') {
      this.closeBlock(open, line, n);
    } else if (type === 'unknown') {
      this.issue('L-1', n, `linha não reconhecida dentro do bloco aberto na linha ${open.startLine}`);
    } else if (INSIDE_BLOCK.has(type)) {
      // A page break inside the block repeats the page and company headers: the context is the same.
      if (type === 'companyHeader') this.companyHeader(line, n);
      else if (type === 'processHeader') this.processHeader(line, n);
    } else {
      // A new block starts before the footer of this one: it is left without footer.
      this.issue('L-1', n, `bloco aberto na linha ${open.startLine} não foi fechado por "TOTAIS ->"`);
      this.open = null;
      this.pending = null;
      this.outside(type, line, n);
    }
  }

  private companyHeader(line: string, n: number): void {
    const context = companyContext(line);
    if (!context) this.issue('L-1', n, 'cabeçalho "Empresa: … Contrato do Tipo :" sem o tipo de contrato ou a filial');
    else this.context = context;
  }

  private processHeader(line: string, n: number): void {
    const period = /(?:^|\s)Periodo:\s*(\d{6})(?!\d)/.exec(line)?.[1];
    const payment = /Numero de Pagamento:\s*(\S+)/.exec(line)?.[1];
    if (period === undefined) this.issue('L-7', n, 'cabeçalho "Processo:" sem "Periodo: AAAAMM"');
    else if (!this.periods.has(period)) this.periods.set(period, n);
    if (payment === undefined) this.issue('L-7', n, 'cabeçalho "Processo:" sem "Numero de Pagamento:"');
    else if (!this.paymentNumbers.has(payment)) this.paymentNumbers.set(payment, n);
    this.paymentDate ??= /Dt Pagto:\s*(\d{2}\/\d{2}\/\d{4})/.exec(line)?.[1] ?? null;
  }

  private openBlock(n: number): void {
    this.lastTotal = null;
    if (!this.pending) {
      this.issue('L-1', n, 'bloco sem cabeçalho de funcionário ("C.CUSTO:") nem rótulo de totalização antes');
      return;
    }
    if (!this.context) {
      this.issue('L-1', n, 'bloco sem o cabeçalho "Empresa: … Contrato do Tipo :" antes');
      return;
    }
    const pending = this.pending;
    this.open = { pending, context: this.context, startLine: n, amounts: pending.kind === 'total' ? new Map() : null, cells: [], cellLines: [] };
  }

  private verbaLine(open: OpenBlock, line: string, n: number): void {
    const parsed = parseVerbaLine(line);
    if ('error' in parsed) {
      this.issue('L-1', n, `linha de verbas ilegível: ${parsed.error}`);
      return;
    }
    for (const cell of parsed.cells) {
      const known = this.columnOf.get(cell.code);
      if (known === undefined) {
        this.columnOf.set(cell.code, cell.column);
        this.columnLine.set(cell.code, n);
        this.descriptions.set(cell.code, cell.description);
      } else if (known !== cell.column) {
        this.issue('L-6', n, `verba ${cell.code} na coluna ${cell.column}, já lida na coluna ${known} (linha ${this.columnLine.get(cell.code)})`);
      }
      if (open.amounts) {
        const a = open.amounts.get(cell.code);
        if (!a) open.amounts.set(cell.code, { column: cell.column, amountCents: cell.amountCents });
        else if (a.column === cell.column) a.amountCents += cell.amountCents;
      } else {
        open.cells.push(cell);
        open.cellLines.push(n);
      }
    }
  }

  private closeBlock(open: OpenBlock, line: string, n: number): void {
    this.open = null;
    this.pending = null;
    const read = parseFooter(line);
    if (!read) this.issue('L-2', n, 'rodapé "TOTAIS ->" sem os cinco valores (proventos, descontos e líquido)');
    const footer: BlockFooter = read ?? { earningsCents: NaN, deductionsCents: NaN, netCents: NaN };
    const { pending, context } = open;
    if (pending.kind === 'total') {
      const scope: PayrollScope = {
        level: pending.level,
        company: context.company,
        branch: pending.branch,
        contractType: context.contractType,
        labelLine: pending.line,
        startLine: open.startLine,
        footerLine: n,
        amounts: open.amounts!,
        footer,
        headcount: null,
      };
      this.scopes.push(scope);
      this.lastTotal = scope;
      return;
    }
    const d = this.dictionary;
    const e = this.e;
    e.registration.push(d.intern(pending.registration));
    e.costCenter.push(d.intern(pending.costCenter));
    e.company.push(d.intern(context.company));
    e.branch.push(d.intern(context.branch ?? ''));
    e.contractType.push(d.intern(context.contractType));
    e.startLine.push(open.startLine);
    e.footerLine.push(n);
    e.earningsCents.push(footer.earningsCents);
    e.deductionsCents.push(footer.deductionsCents);
    e.netCents.push(footer.netCents);
    e.entryStart.push(this.entries);
    open.cells.forEach((cell, k) => {
      e.entryCode.push(d.intern(cell.code));
      e.entryColumn.push(PAYROLL_COLUMNS.indexOf(cell.column));
      e.entryCents.push(cell.amountCents);
      e.entryLine.push(open.cellLines[k]!);
    });
    this.entries += open.cells.length;
    this.employees++;
  }

  end(): PayrollReport {
    if (this.open) {
      this.issue('L-1', this.open.startLine, `bloco aberto na linha ${this.open.startLine} não foi fechado por "TOTAIS ->" até o fim do arquivo`);
      this.open = null;
    }
    const e = this.e;
    const entryStart = new Uint32Array(this.employees + 1);
    for (let i = 0; i < this.employees; i++) entryStart[i] = e.entryStart.get(i);
    entryStart[this.employees] = this.entries;
    return {
      period: this.periods.keys().next().value ?? null,
      paymentNumber: this.paymentNumbers.keys().next().value ?? null,
      paymentDate: this.paymentDate,
      periods: this.periods,
      paymentNumbers: this.paymentNumbers,
      scopes: this.scopes,
      employees: {
        count: this.employees,
        registration: e.registration.toArray(),
        costCenter: e.costCenter.toArray(),
        company: e.company.toArray(),
        branch: e.branch.toArray(),
        contractType: e.contractType.toArray(),
        startLine: e.startLine.toArray(),
        footerLine: e.footerLine.toArray(),
        earningsCents: e.earningsCents.toArray(),
        deductionsCents: e.deductionsCents.toArray(),
        netCents: e.netCents.toArray(),
        entryStart,
        entryCode: e.entryCode.toArray(),
        entryColumn: e.entryColumn.toArray(),
        entryCents: e.entryCents.toArray(),
        entryLine: e.entryLine.toArray(),
      },
      dictionary: this.dictionary,
      columnOf: this.columnOf,
      descriptions: this.descriptions,
      lineTypes: this.lineTypes,
      lines: this.lines,
      unknownOutsideBlocks: this.unknownOutsideBlocks,
      unknownLines: this.unknownLines,
      issues: this.issues,
    };
  }
}

/** Reads lines in memory (numbered from 1): the tests and the small inputs. */
export function readGper040(lines: Iterable<string>): PayrollReport {
  const reader = new Gper040Reader();
  let n = 0;
  for (const line of lines) reader.push(line, ++n);
  return reader.end();
}

/** The amounts of employee `i` by code (summed over its lines), with their column. */
export function employeeAmounts(report: PayrollReport, i: number): PayrollAmounts {
  const e = report.employees;
  const out: PayrollAmounts = new Map();
  for (let k = e.entryStart[i]!; k < e.entryStart[i + 1]!; k++) {
    const code = report.dictionary.get(e.entryCode[k]!);
    const column = PAYROLL_COLUMNS[e.entryColumn[k]!]!;
    const a = out.get(code);
    if (!a) out.set(code, { column, amountCents: e.entryCents[k]! });
    else if (a.column === column) a.amountCents += e.entryCents[k]!;
  }
  return out;
}

/** The totalization of a scope (the first one, when the file repeats it), or null. */
export function findScope(report: PayrollReport, level: PayrollLevel, contractType: string, branch: string | null = null): PayrollScope | null {
  return report.scopes.find((s) => s.level === level && s.contractType === contractType && s.branch === branch) ?? null;
}
