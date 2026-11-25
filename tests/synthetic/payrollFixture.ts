/**
 * Synthetic payroll of the Conciliador (docs/FASE_15_CONCILIADOR_FOLHA.md, section 6.1): from a small description
 * (company, branches, verbas, employees) it prints the GPER040 spool as the Protheus does (page headers with printer
 * sequences ESC + 2 bytes, 0x02/0x03 left over, FF, CRLF, U+FFFD in header texts) and computes, on its own path, the
 * totals the reader must find. Step 4 derives the ledger from the same description and totals. Everything is invented:
 * verbas A10, A20, B20, C31, 7AB, B90, X99 (the codes of tests/synthetic/reconciliationProfile.ts), branches 01/02.
 */

export type FixtureColumn = 'P' | 'D' | 'B';
export type FixtureContract = 'Indeterminado' | 'Determinado';
export type FixtureScopeContract = FixtureContract | 'Todos';
export type FixtureLevel = 'branch' | 'company' | 'groupOfCompanies';

export interface FixtureVerba {
  code: string;
  /** Up to 14 characters (P and D) or 16 (B: a 12-character value may take the last two of the 18). */
  description: string;
  column: FixtureColumn;
}

export interface FixtureEntry {
  code: string;
  amountCents: number;
  /** Reference (hours, days, %), in hundredths; P and D only. */
  referenceCents?: number;
  /** Installment ("PC"), P and D only: the totalization prints one line per code and installment (error 4). */
  installment?: string;
}

export interface FixtureEmployee {
  registration: string;
  costCenter: string;
  branch: string;
  contract: FixtureContract;
  /** Without the net pay verba: it is added (P − D, column B) when the difference is not zero. */
  entries: FixtureEntry[];
}

export interface PayrollFixtureDescription {
  company: string;
  group: string;
  branches: { code: string; name: string }[];
  /** Competência AAAAMM, payment number and payment date (dd/mm/aaaa). */
  period: string;
  paymentNumber: string;
  paymentDate: string;
  /** Verba of the net pay, in column B (payrollReport.netPayCode of the profile). */
  netPayCode: string;
  verbas: FixtureVerba[];
  employees: FixtureEmployee[];
}

export type PayrollDefect = 'L-1' | 'L-2' | 'L-3' | 'L-4' | 'L-5' | 'L-6' | 'L-7';

export interface PayrollFixtureOptions {
  encoding?: 'utf-8' | 'windows-1252';
  /** Lines per page before a page break (page breaks also fall inside blocks). */
  pageLines?: number;
  /** Prints the block Empresa / Todos (absent in the layout observed: there the group follows the branches / Todos). */
  companyTodos?: boolean;
  defect?: PayrollDefect;
}

export type FixtureAmounts = Record<string, { column: FixtureColumn; amountCents: number }>;

export interface FixtureScope {
  level: FixtureLevel;
  branch: string | null;
  contractType: FixtureScopeContract;
  amounts: FixtureAmounts;
  earningsCents: number;
  deductionsCents: number;
  netCents: number;
  /** Employee blocks of the scope ("Total:" of the counts). */
  employees: number;
}

export interface PayrollFixtureTotals {
  /** Every totalization block printed, in the order of the file. */
  scopes: FixtureScope[];
  /** Per employee (order of the file): Σ P, Σ D and net, with the net pay verba included in `amounts`. */
  employees: { registration: string; branch: string; contract: FixtureContract; amounts: FixtureAmounts; earningsCents: number; deductionsCents: number; netCents: number }[];
  verbaLines: number;
}

export interface PayrollFixture {
  bytes: Uint8Array;
  totals: PayrollFixtureTotals;
  /** Lines after the normalization of section 4.1 (what the reader sees), FF included. */
  lineCount: number;
  /** Line (after the normalization) the failing check of the defect cites. */
  defectLine?: number | undefined;
  description: PayrollFixtureDescription;
}

const B = (code: string, amountCents: number): FixtureEntry => ({ code, amountCents });

/**
 * The default description: two branches, two contract types, an employee without verbas (only the base of the salary),
 * an alphanumeric code (7AB), a verba with two installments (two lines of the same code in the totalizations) and a
 * group total above one million (a 12-character value in column B).
 */
export function payrollFixtureDescription(): PayrollFixtureDescription {
  return {
    company: 'EMPRESA X',
    group: 'GRUPO X',
    branches: [
      { code: '01', name: 'FILIAL UM' },
      { code: '02', name: 'FILIAL DOIS' },
    ],
    period: '202610',
    paymentNumber: '01',
    paymentDate: '06/11/2026',
    netPayCode: 'X99',
    verbas: [
      { code: 'A10', description: 'SALARIO', column: 'P' },
      { code: 'A20', description: 'ADICIONAL Y', column: 'P' },
      { code: 'B20', description: 'DESC X', column: 'D' },
      { code: 'C31', description: 'ADIANTAMENTO', column: 'D' },
      { code: '7AB', description: 'BASE Y', column: 'B' },
      { code: 'B90', description: 'SALARIO DO MES', column: 'B' },
      { code: 'X99', description: 'LIQUIDO A RECE', column: 'B' },
    ],
    employees: [
      {
        registration: '000101',
        costCenter: '9101',
        branch: '01',
        contract: 'Indeterminado',
        entries: [
          { code: 'A10', amountCents: 300000, referenceCents: 3000, installment: '00' },
          { code: 'A20', amountCents: 45025, referenceCents: 1000, installment: '01' },
          { code: 'B20', amountCents: 33000, referenceCents: 0, installment: '00' },
          { code: 'C31', amountCents: 120000, referenceCents: 4000, installment: '00' },
          B('7AB', 24000),
          B('B90', 300000),
        ],
      },
      {
        registration: '000102',
        costCenter: '9101',
        branch: '01',
        contract: 'Indeterminado',
        entries: [
          { code: 'A10', amountCents: 250000, referenceCents: 3000, installment: '00' },
          { code: 'A20', amountCents: 12345, referenceCents: 550, installment: '02' },
          { code: 'B20', amountCents: 20000, referenceCents: 0, installment: '00' },
          B('7AB', 20000),
          B('B90', 250000),
        ],
      },
      // Without verbas: only the base of the salary (footer 0,00, no net pay verba).
      { registration: '000103', costCenter: '9102', branch: '01', contract: 'Indeterminado', entries: [B('B90', 156372)] },
      {
        registration: '000201',
        costCenter: '9201',
        branch: '02',
        contract: 'Indeterminado',
        entries: [
          // Above one million in the totals of the group: values of 12 characters.
          { code: 'A10', amountCents: 99000000, referenceCents: 3000, installment: '00' },
          { code: 'B20', amountCents: 2750000, referenceCents: 0, installment: '00' },
          { code: 'C31', amountCents: 1000000, referenceCents: 4000, installment: '00' },
          B('7AB', 7920000),
          B('B90', 99000000),
        ],
      },
      {
        registration: '000202',
        costCenter: '9201',
        branch: '02',
        contract: 'Indeterminado',
        entries: [
          { code: 'A10', amountCents: 180000, referenceCents: 2000, installment: '00' },
          { code: 'A20', amountCents: 9999, referenceCents: 1000, installment: '01' },
          { code: 'B20', amountCents: 14400, referenceCents: 0, installment: '00' },
          B('7AB', 14400),
          B('B90', 270000),
        ],
      },
      {
        registration: '000111',
        costCenter: '9103',
        branch: '01',
        contract: 'Determinado',
        entries: [
          { code: 'A10', amountCents: 120000, referenceCents: 3000, installment: '00' },
          { code: 'B20', amountCents: 9600, referenceCents: 0, installment: '00' },
          B('7AB', 9600),
          B('B90', 120000),
        ],
      },
      {
        registration: '000211',
        costCenter: '9202',
        branch: '02',
        contract: 'Determinado',
        entries: [
          { code: 'A10', amountCents: 150000, referenceCents: 3000, installment: '00' },
          { code: 'A20', amountCents: 30000, referenceCents: 1000, installment: '01' },
          { code: 'A20', amountCents: 15000, referenceCents: 500, installment: '02' },
          { code: 'B20', amountCents: 12000, referenceCents: 0, installment: '00' },
          { code: 'C31', amountCents: 60000, referenceCents: 4000, installment: '00' },
          B('7AB', 12000),
          B('B90', 150000),
        ],
      },
      {
        registration: '000212',
        costCenter: '9202',
        branch: '02',
        contract: 'Determinado',
        entries: [
          { code: 'A10', amountCents: 141221, referenceCents: 2600, installment: '00' },
          { code: 'A20', amountCents: 4410, referenceCents: 300, installment: '01' },
          { code: 'B20', amountCents: 11300, referenceCents: 0, installment: '00' },
          B('7AB', 11300),
          B('B90', 141221),
        ],
      },
    ],
  };
}

// --- Totals (computed from the description, not from the printed text) ------------------------------------------------

interface Line3 {
  code: string;
  description: string;
  amountCents: number;
  referenceCents: number;
  installment: string;
}

interface PrintedBlock {
  P: Line3[];
  D: Line3[];
  B: Line3[];
  earningsCents: number;
  deductionsCents: number;
  netCents: number;
  earningsRefCents: number;
  deductionsRefCents: number;
}

function verbaOf(d: PayrollFixtureDescription, code: string): FixtureVerba {
  const v = d.verbas.find((x) => x.code === code);
  if (!v) throw new Error(`verba ${code} fora do catálogo da descrição`);
  return v;
}

/** The entries of an employee with the net pay verba (P − D) added when it is not zero. */
function employeeEntries(d: PayrollFixtureDescription, e: FixtureEmployee): FixtureEntry[] {
  let net = 0;
  for (const x of e.entries) {
    const column = verbaOf(d, x.code).column;
    if (column === 'P') net += x.amountCents;
    else if (column === 'D') net -= x.amountCents;
  }
  return net !== 0 ? [...e.entries, B(d.netPayCode, net)] : e.entries;
}

/** Lines of a block: the entries grouped by code and installment (and summed), each column in the catalog order. */
function printedBlock(d: PayrollFixtureDescription, entries: FixtureEntry[]): PrintedBlock {
  const groups = new Map<string, Line3 & { column: FixtureColumn; order: number }>();
  for (const x of entries) {
    const v = verbaOf(d, x.code);
    const installment = v.column === 'B' ? '' : (x.installment ?? '00');
    const key = `${x.code}|${installment}`;
    const g = groups.get(key);
    if (g) {
      g.amountCents += x.amountCents;
      g.referenceCents += x.referenceCents ?? 0;
    } else {
      groups.set(key, { code: x.code, description: v.description, amountCents: x.amountCents, referenceCents: x.referenceCents ?? 0, installment, column: v.column, order: d.verbas.indexOf(v) });
    }
  }
  const sorted = [...groups.values()].sort((a, b) => a.order - b.order || (a.installment < b.installment ? -1 : a.installment > b.installment ? 1 : 0));
  const block: PrintedBlock = { P: [], D: [], B: [], earningsCents: 0, deductionsCents: 0, netCents: 0, earningsRefCents: 0, deductionsRefCents: 0 };
  for (const g of sorted) block[g.column].push(g);
  for (const g of block.P) {
    block.earningsCents += g.amountCents;
    block.earningsRefCents += g.referenceCents;
  }
  for (const g of block.D) {
    block.deductionsCents += g.amountCents;
    block.deductionsRefCents += g.referenceCents;
  }
  block.netCents = block.earningsCents - block.deductionsCents;
  return block;
}

function amountsOf(d: PayrollFixtureDescription, entries: FixtureEntry[]): FixtureAmounts {
  const out: FixtureAmounts = {};
  for (const x of entries) {
    const column = verbaOf(d, x.code).column;
    const a = (out[x.code] ??= { column, amountCents: 0 });
    a.amountCents += x.amountCents;
  }
  return out;
}

// --- Printing ----------------------------------------------------------------------------------------------------------

/** Integer cents → "1.234,56" (own path, independent of the code under test). */
export function brMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${units},${String(abs % 100).padStart(2, '0')}`;
}

class Row {
  private readonly chars: string[];
  constructor(width: number) {
    this.chars = new Array<string>(width).fill(' ');
  }
  at(start: number, text: string): this {
    for (let i = 0; i < text.length; i++) this.chars[start + i] = text[i]!;
    return this;
  }
  /** Writes `text` so that it ends at `end` (exclusive). */
  endingAt(end: number, text: string): this {
    return this.at(end - text.length, text);
  }
  text(length?: number): string {
    return this.chars.slice(0, length ?? this.chars.length).join('');
  }
}

/** Positions of section 4.3 (base 0, end exclusive). */
const COLUMNS = {
  P: { code: 0, description: 4, descriptionWidth: 14, referenceEnd: 28, valueEnd: 43, installment: 44 },
  D: { code: 48, description: 52, descriptionWidth: 14, referenceEnd: 76, valueEnd: 91, installment: 92 },
  B: { code: 96, description: 100, descriptionWidth: 18, referenceEnd: 0, valueEnd: 129, installment: 0 },
} as const;

/** One verba line: up to one verba per column; without B the line still reaches column 95 (trailing spaces). */
export function verbaLineText(p?: Line3Like, d?: Line3Like, b?: Line3Like): string {
  const row = new Row(133).at(46, '|').at(94, '|');
  for (const [column, x] of [['P', p], ['D', d], ['B', b]] as const) {
    if (!x) continue;
    const c = COLUMNS[column];
    row.at(c.code, x.code).at(c.description, x.description.padEnd(c.descriptionWidth).slice(0, c.descriptionWidth));
    if (column !== 'B') row.endingAt(c.referenceEnd, brMoney(x.referenceCents ?? 0)).at(c.installment, (x.installment ?? '00').padEnd(2).slice(0, 2));
    row.endingAt(c.valueEnd, brMoney(x.amountCents));
  }
  return b ? row.text(129) : row.text(133);
}
export type Line3Like = { code: string; description: string; amountCents: number; referenceCents?: number; installment?: string };

function footerText(b: Pick<PrintedBlock, 'earningsRefCents' | 'earningsCents' | 'deductionsRefCents' | 'deductionsCents' | 'netCents'>): string {
  return new Row(131)
    .at(0, 'TOTAIS ->')
    .endingAt(27, brMoney(b.earningsRefCents))
    .endingAt(44, brMoney(b.earningsCents))
    .endingAt(73, brMoney(b.deductionsRefCents))
    .endingAt(88, brMoney(b.deductionsCents))
    .at(100, 'SALARIO LIQ.')
    .endingAt(131, brMoney(b.netCents))
    .text();
}

const ESC = 0x1b;
const RULE = '-'.repeat(132);
const PAGE_RULE = '*'.repeat(132);
const COLUMN_TITLE = '               P R O V E N T O S                              D E S C O N T O S                              B A S E S';
const COLUMN_HEADER = 'COD DESCRICAO           REF.          VALOR PC| COD DESCRICAO           REF.          VALOR PC| COD DESCRICAO               VALOR';

type Segment = string | number[];
interface Context {
  branch: { code: string; name: string } | null;
  contract: FixtureScopeContract;
}

class Printer {
  readonly lines: Segment[][] = [];
  private onPage = 0;
  private page = 0;
  private context: Context | null = null;
  processPaymentNumber: (page: number) => string;

  constructor(
    private readonly d: PayrollFixtureDescription,
    private readonly o: Required<Pick<PayrollFixtureOptions, 'encoding' | 'pageLines'>>,
  ) {
    this.processPaymentNumber = () => d.paymentNumber;
  }

  private raw(...segments: Segment[]): number {
    this.lines.push(segments);
    this.onPage++;
    return this.lines.length;
  }

  /** A body line; a page break first when the page is full. */
  line(...segments: Segment[]): number {
    if (this.onPage >= this.o.pageLines) this.newPage();
    return this.raw(...segments);
  }

  setContext(context: Context): void {
    this.context = context;
    this.newPage();
  }

  private newPage(): void {
    const d = this.d;
    const c = this.context!;
    this.page++;
    this.onPage = 0;
    const emission = this.o.encoding === 'utf-8' ? 'Emiss�o' : 'Emissão';
    const [year, month] = [Number(d.period.slice(0, 4)), Number(d.period.slice(4))];
    const last = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
    const mm = d.period.slice(4);
    const start = `01/${mm}/${year}`;
    const end = `${last}/${mm}/${year}`;
    // FF before the page (the previous line already ended with CRLF: FF ends one more, empty, line).
    if (this.page > 1) this.raw([0x0c]);
    this.raw([ESC, 0x28, 0x73, 0x02], PAGE_RULE, [0x03]);
    this.raw(`*${d.company} / ${c.branch?.name ?? d.company}`.padEnd(120) + `Folha..: ${String(this.page).padStart(5)}`);
    this.raw(`*SIGA /GPER040/v.12               Folha                         Periodo : ${start} A ${end}               DT.Ref.: ${end}`);
    this.raw(`*Hora...: 08:00:00 - Grupo de Empresas: ${d.group} / Filial: ${c.branch?.name ?? '-'}`.padEnd(116) + `${emission}: ${end}`);
    this.raw(PAGE_RULE);
    const company = `Empresa: ${d.company}`.padEnd(23);
    const branch = (c.branch ? `Fil.: ${c.branch.code} - ${c.branch.name}` : '').padEnd(29);
    // 0x02 left over before the header: kept, it would move "Empresa:" away from the start of the line (error 2).
    this.raw([ESC, 0x45, 0x21, 0x02], `${company}${branch}Contrato do Tipo : ${c.contract}`);
    this.raw(
      `Processo: 00001-SINTETICO Periodo: ${d.period} Numero de Pagamento: ${this.processPaymentNumber(this.page)} Dt Periodo: ${start}-${end} Dt Pagto: ${d.paymentDate}`,
    );
    this.raw(PAGE_RULE);
    this.raw('');
  }

  bytes(): Uint8Array {
    const parts: number[] = [];
    const encodeText = (s: string) => {
      if (this.o.encoding === 'utf-8') for (const b of new TextEncoder().encode(s)) parts.push(b);
      else
        for (const ch of s) {
          const code = ch.codePointAt(0)!;
          if (code > 0xff || (code >= 0x80 && code < 0xa0)) throw new Error(`caractere fora do windows-1252 usado: ${ch}`);
          parts.push(code);
        }
    };
    for (const segments of this.lines) {
      // The FF line: FF alone (no CRLF), the next line starts right after it.
      if (segments.length === 1 && Array.isArray(segments[0]) && segments[0][0] === 0x0c) {
        parts.push(0x0c);
        continue;
      }
      for (const s of segments) {
        if (typeof s === 'string') encodeText(s);
        else parts.push(...s);
      }
      parts.push(0x0d, 0x0a);
    }
    return new Uint8Array(parts);
  }
}

/** Prints the spool of a description, with an optional defect of the invariants of section 4.6. */
export function payrollSpool(description: PayrollFixtureDescription = payrollFixtureDescription(), options: PayrollFixtureOptions = {}): PayrollFixture {
  const d = description;
  const defect = options.defect;
  const p = new Printer(d, { encoding: options.encoding ?? 'utf-8', pageLines: options.pageLines ?? 23 });
  const totals: PayrollFixtureTotals = { scopes: [], employees: [], verbaLines: 0 };
  let defectLine: number | undefined;
  let defectDone = false;
  const take = () => {
    if (defectDone) return false;
    defectDone = true;
    return true;
  };

  /** Prints the verba lines; `extra` goes after the first one (returns its line). */
  const printLines = (block: PrintedBlock, onLine?: (index: number, line: number) => void, extra?: string) => {
    const rows = Math.max(block.P.length, block.D.length, block.B.length);
    let extraLine: number | undefined;
    for (let i = 0; i < rows; i++) {
      const at = p.line(verbaLineText(block.P[i], block.D[i], block.B[i]));
      totals.verbaLines++;
      onLine?.(i, at);
      if (i === 0 && extra !== undefined) extraLine = p.line(extra);
    }
    return extraLine;
  };

  const printEmployee = (e: FixtureEmployee, index: number) => {
    const entries = employeeEntries(d, e);
    const block = printedBlock(d, entries);
    const amounts = amountsOf(d, entries);
    totals.employees.push({ registration: e.registration, branch: e.branch, contract: e.contract, amounts, earningsCents: block.earningsCents, deductionsCents: block.deductionsCents, netCents: block.netCents });
    const printed = structuredClone(block);
    const first = index === 0;
    if (first && defect === 'L-3' && take()) printed.B.find((x) => x.code === d.netPayCode)!.amountCents += 1;
    if (first && defect === 'L-4' && take()) printed.B.find((x) => x.code === '7AB')!.amountCents += 1;
    let l6 = false;
    if (first && defect === 'L-6' && take()) {
      // The code of a provento printed also in column B (L-6).
      printed.B.push({ code: printed.P[0]!.code, description: 'MESMO CODIGO', amountCents: 100, referenceCents: 0, installment: '' });
      l6 = true;
    }
    p.line(`C.CUSTO:${e.costCenter}-SETOR SINTETICO MAT.: ${e.registration} NOME: ${`FUNCIONARIO ${e.registration}`.padEnd(30)} FUNCAO: 00100  CARGO SINTETICO`);
    p.line(`DT.ADM.:01/02/2020  CATEG.: MENSALISTA   SAL.: ${brMoney(amounts['B90']?.amountCents ?? 0).padStart(14)}  DEP.I.R.: 00  DEP.SAL.FAM.: 00`);
    p.line('Sit. Folha: NORMAL');
    p.line(COLUMN_TITLE);
    p.line(COLUMN_HEADER);
    printLines(printed, (i, at) => {
      if (l6 && i === printed.B.length - 1) defectLine = at;
    });
    p.line(RULE);
    const footer = structuredClone(block);
    if (first && defect === 'L-2' && take()) footer.earningsCents += 1;
    const footerLine = p.line(footerText(footer));
    if (first && (defect === 'L-2' || defect === 'L-3')) defectLine = footerLine;
    p.line(RULE);
    return footerLine;
  };

  const printTotal = (level: FixtureLevel, branch: { code: string; name: string } | null, contract: FixtureScopeContract, employees: FixtureEmployee[]) => {
    const entries = employees.flatMap((e) => employeeEntries(d, e));
    const block = printedBlock(d, entries);
    const amounts = amountsOf(d, entries);
    totals.scopes.push({ level, branch: branch?.code ?? null, contractType: contract, amounts, earningsCents: block.earningsCents, deductionsCents: block.deductionsCents, netCents: block.netCents, employees: employees.length });
    const printed = structuredClone(block);
    const l5 = level === 'company' && contract === 'Indeterminado' && defect === 'L-5' && take();
    if (l5) printed.B.find((x) => x.code === '7AB')!.amountCents += 1;
    const l1 = level === 'branch' && defect === 'L-1' && take();
    p.line(level === 'branch' ? `Filial: ${branch!.code} - ${branch!.name}`.padEnd(54) : level === 'company' ? `Empresa: ${d.company}`.padEnd(49) : `Grupo de Empresas: ${d.group}`);
    p.line('');
    p.line(COLUMN_TITLE);
    p.line(COLUMN_HEADER);
    const unknownLine = printLines(printed, undefined, l1 ? 'LINHA SEM TIPO CONHECIDO' : undefined);
    if (l1) defectLine = unknownLine;
    p.line(RULE);
    const footerLine = p.line(footerText(block));
    if (l5) defectLine = footerLine;
    p.line(RULE);
    p.line(`Sit.Normal: ${String(employees.length).padStart(5, '0')}                  Admitidos:   00000                  Afastados:     00000                  Demitidos:00000`);
    p.line('Ferias:     00000                  Transferidos:00000                  Outros C.Custo:00000                  Inativos: 00000');
    p.line(`Total:      ${String(employees.length).padStart(5, '0')}`);
    return footerLine;
  };

  if (defect === 'L-7') p.processPaymentNumber = (page) => (page === 2 ? '02' : d.paymentNumber);
  const contracts: FixtureContract[] = ['Indeterminado', 'Determinado'];
  let employeeIndex = 0;
  let branchIndetFooter: number | undefined;
  for (const contract of contracts) {
    const ofContract = d.employees.filter((e) => e.contract === contract);
    if (ofContract.length === 0) continue;
    for (const branch of d.branches) {
      const ofBranch = ofContract.filter((e) => e.branch === branch.code);
      if (ofBranch.length === 0) continue;
      p.setContext({ branch, contract });
      for (const e of ofBranch) printEmployee(e, employeeIndex++);
      p.setContext({ branch, contract });
      const footer = printTotal('branch', branch, contract, ofBranch);
      branchIndetFooter ??= footer;
    }
    p.setContext({ branch: null, contract });
    printTotal('company', null, contract, ofContract);
  }
  for (const branch of d.branches) {
    const ofBranch = d.employees.filter((e) => e.branch === branch.code);
    if (ofBranch.length === 0) continue;
    p.setContext({ branch, contract: 'Todos' });
    printTotal('branch', branch, 'Todos', ofBranch);
  }
  if (options.companyTodos) {
    p.setContext({ branch: null, contract: 'Todos' });
    printTotal('company', null, 'Todos', d.employees);
  }
  p.setContext({ branch: null, contract: 'Todos' });
  printTotal('groupOfCompanies', null, 'Todos', d.employees);

  if (defect === 'L-4') defectLine = branchIndetFooter;
  if (defect === 'L-7') {
    // The process header of page 2, the one with the other payment number.
    defectLine = p.lines.findIndex((segments) => segments.some((s) => typeof s === 'string' && s.includes('Numero de Pagamento: 02'))) + 1;
  }
  return { bytes: p.bytes(), totals, lineCount: p.lines.length, defectLine, description: d };
}
