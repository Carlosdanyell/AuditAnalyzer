/**
 * Synthetic CTBR400 ledger (docs/FASE_15_CONCILIADOR_FOLHA.md, section 6.1, ledger part): one description of a ledger
 * gives the spool TXT (as the Protheus prints it: ESC sequences, FF, CRLF, stray 0x03, windows-1252) and the XML
 * SpreadsheetML (Parametros sheet, titles repeated per page, ss:Index on some cells and not on others, CDATA and
 * entities, Number cells with 0, 1 or 2 decimals), coherent between themselves: both must read to the same records.
 * Running balances, page transports and closing totals are computed here; the defective variants change one of them.
 * Invented company, accounts, keys, histories and values only (the real files gave the layout, nothing else).
 */

export interface FixtureEntry {
  /** dd/mm/aaaa */
  date: string;
  key: string;
  history: string;
  ledgerBranch: string;
  /** FILIAL DE ORIGEM (XML only); defaults to the FILIAL CTB. */
  originBranch?: string;
  counterpart?: string;
  costCenter?: string;
  productGroup?: string;
  debit?: number;
  credit?: number;
}

export interface FixtureAccount {
  code: string;
  description: string;
  group: { code: string; description: string };
  /** Signed cents, credit positive. */
  opening: number;
  entries: FixtureEntry[];
}

export interface LedgerFixture {
  /** dd/mm/aaaa */
  from: string;
  to: string;
  currency: string;
  /** Parameter 06 as printed. */
  balanceType: string;
  accounts: FixtureAccount[];
}

export interface LedgerFileOptions {
  /** Ledger lines per page of the TXT (and rows between the repeated titles of the XML). */
  linesPerPage?: number;
  /** `(Pre-Lancamento)` in the page titles of the TXT; default: parameter 06 = 9. */
  marker?: boolean;
  /** Cents added to the total debit of the closing of an account (R-1). */
  closingDebitDelta?: { account: string; cents: number };
  /** Cents added to the value of the first A TRANSPORTAR of the TXT (R-5). */
  transportDelta?: number;
  /** Cents added to the printed running balance of one line (R-2), by account and line position from 0. */
  runningDelta?: { account: string; index: number; cents: number };
  /** Extra text line printed after a line of an account (R-6 / unknown line), TXT only. */
  extraLine?: { account: string; index: number; text: string };
  /** Spaces inserted before the title "C/PARTIDA" in the line of titles (title out of position). */
  titleShift?: number;
  /** Ledger sheet name of the XML. */
  sheetName?: string;
}

const WIDTH = 218;

/** 123456 → "1.234,56" (pt-BR, thousands with dots), without Intl. */
export function brAmount(cents: number): string {
  const abs = Math.abs(cents);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${int},${String(abs % 100).padStart(2, '0')}`;
}

/** Signed balance as the report prints it: "1.234,56 C", "1.234,56 D", or "0,00" without D/C. */
export function brBalance(cents: number): string {
  return cents === 0 ? '0,00' : `${brAmount(cents)} ${cents > 0 ? 'C' : 'D'}`;
}

/** Number cell text with as many decimals as needed: 150000 → "1500", 150050 → "1500.5", 150055 → "1500.55". */
export function numberText(cents: number): string {
  const int = Math.floor(cents / 100);
  const dec = cents % 100;
  if (dec === 0) return String(int);
  return dec % 10 === 0 ? `${int}.${dec / 10}` : `${int}.${String(dec).padStart(2, '0')}`;
}

/** Text placed at `at` (base 0) of a line of spaces, padded to `width`. */
class Line {
  private chars: string[];
  constructor(width = WIDTH) {
    this.chars = Array.from({ length: width }, () => ' ');
  }
  put(at: number, text: string): this {
    for (let i = 0; i < text.length; i++) this.chars[at + i] = text[i]!;
    return this;
  }
  /** Text that ends (exclusive) at `end`. */
  right(end: number, text: string): this {
    return this.put(end - text.length, text);
  }
  toString(): string {
    return this.chars.join('');
  }
}

/** The balance the report prints right-aligned to `end`, followed by " C"/" D" or a space for zero. */
function balanceAt(line: Line, end: number, cents: number): Line {
  line.right(end, brAmount(cents));
  return line.put(end, cents === 0 ? ' ' : ` ${cents > 0 ? 'C' : 'D'}`);
}

const PARAMETERS = (f: LedgerFixture): [string, string][] => [
  ['Da Conta', f.accounts[0]?.code.replace(/\./g, '') ?? ''],
  ['Ate Conta', f.accounts[f.accounts.length - 1]?.code.replace(/\./g, '') ?? ''],
  ['Da Data', f.from],
  ['Ate a Data', f.to],
  ['Moeda', f.currency],
  ['Tipo de Saldo', f.balanceType],
  ['Cod. Config. Livros', ''],
  ['Tipo Relatorio', 'Analitico'],
  ['Impr. Cta S/ Movim', 'Nao'],
  ['Junta C.C. Contabil', 'Sim'],
];

/** Running balances of an account's lines, as printed (with the defect of `runningDelta`). */
function runningBalances(a: FixtureAccount, o: LedgerFileOptions): number[] {
  let running = a.opening;
  return a.entries.map((e, i) => {
    running += (e.credit ?? 0) - (e.debit ?? 0);
    const delta = o.runningDelta && o.runningDelta.account === a.code && o.runningDelta.index === i ? o.runningDelta.cents : 0;
    return running + delta;
  });
}

function closingOf(a: FixtureAccount, o: LedgerFileOptions): { debit: number; credit: number; balance: number } {
  const debit = a.entries.reduce((s, e) => s + (e.debit ?? 0), 0) + (o.closingDebitDelta?.account === a.code ? o.closingDebitDelta.cents : 0);
  const credit = a.entries.reduce((s, e) => s + (e.credit ?? 0), 0);
  return { debit, credit, balance: a.opening + a.entries.reduce((s, e) => s + (e.credit ?? 0) - (e.debit ?? 0), 0) };
}

const COMPANY = 'EMPRESA FICTICIA DE TESTES S/A';
const CNPJ = '11.222.333/0001-44';

/** Lines of the TXT spool (before the control sequences), as the reader sees them after the normalization. */
export function ledgerSpoolLines(f: LedgerFixture, o: LedgerFileOptions = {}): string[] {
  const perPage = o.linesPerPage ?? 10;
  const marker = (o.marker ?? f.balanceType === '9') ? ' (Pre-Lancamento)' : '';
  const title = `RAZAO ANALITICO EM REAL DE ${f.from} ATE ${f.to}${marker}`;
  const out: string[] = [];
  const rule = '*'.repeat(WIDTH + 2);
  // First page: the report header and the parameters.
  out.push('', rule, `*${'EMPRESA FICTICIA / FILIAL 01'.padEnd(WIDTH)}*`);
  out.push(`*${new Line(WIDTH).put(0, 'SIGA /CTBR400/v.12').put(60, `Parâmetros - ${title}`).right(WIDTH, 'DT.Ref.: 23/11/2026')}*`);
  out.push(`*${new Line(WIDTH).put(0, 'Hora...: 10:00:00 - Grupo de empresa: EMPRESA FICTICIA').right(WIDTH, 'Emissão: 23/11/2026')}*`, rule, '', '     ');
  PARAMETERS(f).forEach(([label, value], i) => out.push(`     Pergunta ${String(i + 1).padStart(2, '0')} : ${label} ?   ${value.padEnd(12)}`));
  out.push(' '.repeat(WIDTH), '');
  const titles = new Line(WIDTH).put(0, 'LOTE/SUB/DOC/LINHA').put(20, 'H I S T O R I C O').put(60 + (o.titleShift ?? 0), 'C/PARTIDA').put(85, 'C CUSTO').put(111, 'FILIAL CTB').put(137, 'GRP PRODUT').put(165, 'DEBITO').put(186, 'CREDITO').put(204, 'SALDO ATUAL');
  const pageHeader = () => {
    out.push(rule, ' EMPRESA FICTICIA / FILIAL 01', new Line(WIDTH).put(85, COMPANY).toString(), new Line(WIDTH).put(101, CNPJ).toString());
    out.push(` SIGA /CTBR400/v.12${' '.repeat(84)}${title}`, new Line(WIDTH).put(1, 'Hora...: 10:00:01').right(WIDTH, 'Emissão: 23/11/2026').toString(), rule, 'DATA', titles.toString(), rule);
  };
  pageHeader();
  let onPage = 0;
  let transports = 0;
  const transportValue = (v: number) => v + (transports++ === 0 ? (o.transportDelta ?? 0) : 0);
  f.accounts.forEach((a, ai) => {
    const balances = runningBalances(a, o);
    const accountTitle = ` CONTA - ${a.code.padEnd(35)}- ${a.description}`;
    if (ai > 0) out.push('');
    out.push(`${a.group.code.padEnd(20)} - ${a.group.description.padEnd(40)}`, '');
    out.push(balanceAt(new Line(WIDTH).put(0, accountTitle).put(150, 'SALDO ANTERIOR:'), 216, a.opening).toString(), '');
    let date = '';
    a.entries.forEach((e, i) => {
      if (onPage === perPage) {
        const running = i === 0 ? a.opening : balances[i - 1]!;
        out.push('', balanceAt(new Line(WIDTH).put(159, 'A TRANSPORTAR :'), 216, transportValue(running)).toString(), '');
        pageHeader();
        out.push(balanceAt(new Line(WIDTH).put(0, accountTitle).put(149, 'DE TRANSPORTE :'), 216, running).toString(), '');
        onPage = 0;
        date = '';
      }
      if (e.date !== date) {
        out.push(e.date);
        date = e.date;
      }
      const line = new Line(WIDTH).put(0, e.key).put(19, e.history.slice(0, 40)).put(60, e.counterpart ?? '').put(85, e.costCenter ?? '').put(111, e.ledgerBranch).put(137, e.productGroup ?? '');
      line.right(174, brAmount(e.debit ?? 0)).right(196, brAmount(e.credit ?? 0));
      out.push(balanceAt(line, 216, balances[i]!).toString().trimEnd());
      if (o.extraLine && o.extraLine.account === a.code && o.extraLine.index === i) out.push(o.extraLine.text);
      onPage++;
    });
    const c = closingOf(a, o);
    out.push('', '', balanceAt(new Line(WIDTH).put(19, 'T o t a i s  d a  C o n t a  ==>').right(174, brAmount(c.debit)).right(196, brAmount(c.credit)), 216, c.balance).toString());
    out.push('-'.repeat(200));
  });
  const debit = f.accounts.reduce((s, a) => s + closingOf(a, o).debit, 0);
  const credit = f.accounts.reduce((s, a) => s + closingOf(a, o).credit, 0);
  out.push(new Line(200).put(30, 'T O T A L  G E R A L ==>').right(174, brAmount(debit)).right(196, brAmount(credit)).toString().trimEnd(), '-'.repeat(200));
  return out;
}

/** windows-1252 byte of a character (the ones the fixture uses); throws for any other. */
function cp1252(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) return c;
  throw new Error(`Caractere sem byte windows-1252 no gerador: ${ch}`);
}

/**
 * Bytes of the spool: windows-1252, CRLF, a printer sequence (ESC + 2 bytes) around every `****` line, FF before each
 * new page and a stray 0x03 in the page headers, as the real spool has them.
 */
export function ledgerSpool(f: LedgerFixture, o: LedgerFileOptions = {}): Uint8Array {
  const bytes: number[] = [0x08, 0x05, 0x1b, 0x01, 0x01];
  let rules = 0;
  for (const line of ledgerSpoolLines(f, o)) {
    if (line.startsWith('****')) {
      // FF before the rule that opens each page of the ledger (the 3rd rule, then every 3).
      if (rules >= 2 && (rules - 2) % 3 === 0) bytes.push(0x0c);
      rules++;
      bytes.push(0x1b, 0x06, 0x01);
    }
    for (const ch of line) bytes.push(cp1252(ch));
    if (line.startsWith(' Hora...:')) bytes.push(0x03);
    if (line.startsWith('****')) bytes.push(0x1b, 0x04, 0x02);
    bytes.push(0x0d, 0x0a);
  }
  return new Uint8Array(bytes);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type XmlCell = { type: 'String' | 'Number' | 'DateTime'; text: string };
type XmlValue = XmlCell | null;

const str = (text: string): XmlCell => ({ type: 'String', text });
const num = (cents: number): XmlCell => ({ type: 'Number', text: numberText(cents) });
const dateTime = (ddmmyyyy: string): XmlCell => {
  const [d, m, y] = ddmmyyyy.split('/');
  return { type: 'DateTime', text: `${y}-${m}-${d}T00:00:00` };
};

/**
 * A row: cells by column from 1; `mode` "index" writes ss:Index on every cell (as the Protheus), "implicit" none (the
 * position follows the previous cell), "sparse" skips the empty cells and jumps with ss:Index.
 */
function rowXml(r: number, cells: XmlValue[], mode: 'index' | 'implicit' | 'sparse', entities = false, merge?: number): string {
  if (cells.length === 0) return `<Row ss:Index="${r}"/>`;
  const out: string[] = [];
  let skipped = false;
  cells.forEach((v, i) => {
    if (mode === 'sparse' && (v === null || v.text === '')) {
      skipped = true;
      return;
    }
    const at = mode === 'index' || (mode === 'sparse' && skipped) ? ` ss:Index="${i + 1}"` : '';
    skipped = false;
    const mergeAttr = merge !== undefined && i === 0 ? ` ss:MergeAcross="${merge}"` : '';
    const value = v ?? str('');
    const body = value.type === 'String' ? (entities ? esc(value.text) : `<![CDATA[${value.text}]]>`) : value.text;
    out.push(`<Cell${at} ss:StyleID="s${i + 1}"${mergeAttr}>\n<Data ss:Type="${value.type}">${body}</Data>\n</Cell>`);
  });
  return `<Row ss:Index="${r}">\n${out.join('\n')}\n</Row>`;
}

const XML_TITLES = ['DATA', 'LOTE/SUB/DOC/LINHA', 'HISTORICO', 'C/PARTIDA', 'FILIAL DE ORIGEM', 'C CUSTO', 'FILIAL CTB', 'GRP PRODUT', 'DEBITO', 'CREDITO', 'SALDO ATUAL'];

/** Text of the XML SpreadsheetML of the ledger (UTF-8). */
export function ledgerXml(f: LedgerFixture, o: LedgerFileOptions = {}): string {
  const perPage = o.linesPerPage ?? 10;
  const params = PARAMETERS(f)
    .map(([label, value], i) => rowXml(9 + i, [str(`Pergunta ${String(i + 1).padStart(2, '0')} : ${label} ?`), str(value)], 'index'))
    .join('\n');
  const rows: string[] = [];
  let r = 7;
  const titles = () => rows.push(rowXml(r++, XML_TITLES.map(str), 'index'));
  titles();
  rows.push(rowXml(r++, [str('CONTA'), str('DESCRICAO')], 'index'));
  let onPage = 0;
  let n = 0;
  f.accounts.forEach((a, ai) => {
    const balances = runningBalances(a, o);
    if (ai > 0) rows.push(rowXml(r++, [], 'index'));
    rows.push(rowXml(r++, [str(a.group.code), str(` - ${a.group.description}`)], 'index'));
    rows.push(rowXml(r++, [], 'index'));
    rows.push(rowXml(r++, [str(`CONTA - ${a.code} - ${a.description}`), str(`SALDO ANTERIOR:        ${brBalance(a.opening)}`)], 'index'));
    let date = '';
    a.entries.forEach((e, i) => {
      if (onPage === perPage) {
        titles();
        onPage = 0;
      }
      if (e.date !== date) {
        rows.push(rowXml(r++, [], 'index'));
        date = e.date;
      }
      const cells: XmlValue[] = [
        dateTime(e.date),
        str(e.key),
        str(e.history),
        str(e.counterpart ?? ''),
        str(e.originBranch ?? e.ledgerBranch),
        str(e.costCenter ?? ''),
        str(e.ledgerBranch),
        str(e.productGroup ?? ''),
        num(e.debit ?? 0),
        num(e.credit ?? 0),
        str(`      ${brBalance(balances[i]!)}`),
      ];
      const mode = n % 3 === 0 ? 'index' : n % 3 === 1 ? 'sparse' : 'implicit';
      rows.push(rowXml(r++, cells, mode, n % 4 === 2));
      n++;
      onPage++;
    });
    const c = closingOf(a, o);
    rows.push(rowXml(r++, [str('T o t a i s  d a  C o n t a  ==> ')], 'implicit', false, 10));
    rows.push(rowXml(r++, [null, null, null, null, null, null, null, null, num(c.debit), num(c.credit), str(`      ${brBalance(c.balance)}`)], 'sparse'));
  });
  const debit = f.accounts.reduce((s, a) => s + closingOf(a, o).debit, 0);
  const credit = f.accounts.reduce((s, a) => s + closingOf(a, o).credit, 0);
  rows.push(rowXml(r++, [str('T O T A L  G E R A L ==> ')], 'implicit', false, 9));
  rows.push(rowXml(r++, [null, null, null, null, null, null, null, null, num(debit), num(credit)], 'sparse'));
  return (
    '<?xml version="1.0" encoding="UTF-8" ?>\n<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    '<Styles>\n<Style ss:ID="Default" ss:Name="Normal">\n<Font ss:FontName="Courier New" ss:Size="8">\n</Font>\n</Style>\n</Styles>\n' +
    `<Worksheet ss:Name="Parametros">\n<Table>\n${params}\n</Table>\n</Worksheet>\n` +
    `<Worksheet ss:Name="${esc(o.sheetName ?? '99-01 - Emissao do Razao Sintetico')}">\n<Table>\n` +
    XML_TITLES.map((_, i) => `<Column ss:Index="${i + 1}" ss:Width="90">\n</Column>`).join('\n') +
    `\n${rows.join('\n')}\n</Table>\n<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">\n</WorksheetOptions>\n</Worksheet>\n</Workbook>\n`
  );
}

/** Competence of the sample ledgers: the second month of the report. */
export const LEDGER_COMPETENCE = { year: 2026, month: 10 } as const;

/** Batch prefixes of the synthetic profile (tests/synthetic/reconciliationProfile.ts): integration and Financeiro. */
const INT = '000777';
const FIN = '000888';

const e = (date: string, key: string, history: string, ledgerBranch: string, amounts: { debit?: number; credit?: number }, more: Partial<FixtureEntry> = {}): FixtureEntry => ({ date, key, history, ledgerBranch, ...amounts, ...more });

/**
 * Two accounts over two months (September and October 2026), all in real balance (type 1): Financeiro payments of the
 * previous month (keys repeated between the months), integration lines by branch and by cost center, a manual entry
 * (batch ddmmaa) with FILIAL DE ORIGEM ≠ FILIAL CTB, a balance that goes through zero (printed without D/C), a debit
 * balance, an asset account with a debit opening, and enough lines for page breaks with transports.
 */
export function sampleLedger(): LedgerFixture {
  const net: FixtureEntry[] = [
    // September: the August payroll paid by the Financeiro (balance goes to zero), then the September integration.
    e('04/09/2026', `${FIN}001000001001`, 'PAG FOLHA 08/2026 FIL 01', '01', { debit: 250000 }),
    e('04/09/2026', `${FIN}001000002001`, 'PAG FOLHA 08/2026 FIL 02', '02', { debit: 100000 }, { originBranch: '01' }),
    e('30/09/2026', `${INT}001000001001`, 'A10 SALARIO 09/2026', '01', { credit: 200000 }, { costCenter: '1001' }),
    e('30/09/2026', `${INT}001000001002`, 'A10 SALARIO 09/2026', '01', { credit: 120050 }, { costCenter: '1002' }),
    e('30/09/2026', `${INT}001000001003`, 'B20 DESCONTO X 09/2026', '01', { debit: 15000 }),
    e('30/09/2026', `${INT}001000001004`, 'A10 SALARIO 09/2026', '02', { credit: 90000 }),
    e('30/09/2026', `${INT}001000001005`, '7AB ADICIONAL 1º TURNO 09/2026', '02', { credit: 12345 }),
    e('30/09/2026', `${INT}001000001006`, 'B20 DESCONTO X 09/2026', '02', { debit: 5000 }),
    // October: the September payroll paid (same keys as in September), a payment of the month, the integration.
    e('06/10/2026', `${FIN}001000001001`, 'PAG FOLHA 09/2026 FIL 01', '01', { debit: 305050 }),
    e('06/10/2026', `${FIN}001000002001`, 'PAG FOLHA 09/2026 FIL 02', '02', { debit: 97345 }, { originBranch: '01' }),
    e('06/10/2026', `${FIN}001000003001`, 'PAG RESCISAO 10/2026 & ACORDO', '01', { debit: 4000 }),
    e('31/10/2026', `${INT}001000001001`, 'A10 SALARIO 10/2026', '01', { credit: 210000 }, { costCenter: '1001' }),
    e('31/10/2026', `${INT}001000001002`, 'A10 SALARIO 10/2026', '01', { credit: 125000 }, { costCenter: '1002' }),
    e('31/10/2026', `${INT}001000001003`, 'B20 DESCONTO X 10/2026', '01', { debit: 15500 }),
    e('31/10/2026', `${INT}001000001004`, 'C30 HORAS EXTRAS 10/2026', '01', { credit: 3310 }),
    e('31/10/2026', `${INT}001000001005`, 'A10 SALARIO 10/2026', '02', { credit: 91000 }),
    e('31/10/2026', `${INT}001000001006`, '7AB ADICIONAL 1º TURNO 10/2026', '02', { credit: 12000 }),
    e('31/10/2026', `${INT}001000001007`, 'B20 DESCONTO X 10/2026', '02', { debit: 5100 }),
    e('31/10/2026', `${INT}001000001008`, 'X99 LIQUIDO 10/2026', '02', { credit: 1 }),
    e('31/10/2026', `${INT}001000001009`, 'INTEGRACAO SEM VERBA', '01', { credit: 99 }),
    e('31/10/2026', '311026001000001001', 'A10 AJUSTE MANUAL 10/2026 - MAT. 000123', '02', { credit: 3750 }, { originBranch: '01', counterpart: '9.9.5.0.10.01' }),
  ];
  const advance: FixtureEntry[] = [
    e('15/09/2026', `${FIN}001000010001`, 'ADIANTAMENTO QUINZENAL 09/2026', '01', { debit: 50000 }),
    e('30/09/2026', `${INT}001000002001`, 'C31 DESCONTO ADIANTAMENTO 09/2026', '01', { credit: 80000 }),
    e('15/10/2026', `${FIN}001000010001`, 'ADIANTAMENTO QUINZENAL 10/2026', '01', { debit: 60000 }, { productGroup: 'GRP1' }),
    e('31/10/2026', `${INT}001000002001`, 'C31 DESCONTO ADIANTAMENTO 10/2026', '01', { credit: 45000 }),
  ];
  return {
    from: '01/09/2026',
    to: '31/10/2026',
    currency: '01',
    balanceType: '1',
    accounts: [
      { code: '9.9.1.0.10.01', description: 'ORDENADOS A PAGAR SINTETICA', group: { code: '9.9.1.0.1', description: 'OBRIGACOES SINTETICAS' }, opening: 350000, entries: net },
      { code: '9.9.1.0.20.01', description: 'ADIANTAMENTOS SINTETICA', group: { code: '9.9.1.0.2', description: 'ADIANTAMENTOS SINTETICOS' }, opening: -30000, entries: advance },
    ],
  };
}

const isOctober = (x: FixtureEntry) => x.date.endsWith('/10/2026');

/**
 * The same ledger extracted twice with the same interval, as at the close of October (5.7): September effective (type 1)
 * and October in pre-entry (type 9, opening balance zero). Their combined view equals the sample all in type 1.
 */
export function splitLedger(): { real: LedgerFixture; preEntry: LedgerFixture } {
  const all = sampleLedger();
  return {
    real: { ...all, accounts: all.accounts.map((a) => ({ ...a, entries: a.entries.filter((x) => !isOctober(x)) })) },
    preEntry: { ...all, balanceType: '9', accounts: all.accounts.map((a) => ({ ...a, opening: 0, entries: a.entries.filter(isOctober) })) },
  };
}
