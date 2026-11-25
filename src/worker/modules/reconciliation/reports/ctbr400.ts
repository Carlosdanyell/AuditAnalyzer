/**
 * Reader of the CTBR400 ledger (S-2; docs/REGRAS_CONCILIADOR.md, section 5). It receives lines, never a file: fixed-width
 * lines of the spool (formats/text.ts) or of the PDF (formats/pdf.ts, which also gives the proportional text of each
 * page: the page header and, on the first page, the parameters) or spreadsheet rows of the XML
 * (formats/spreadsheetml.ts), and both give the same normalized records (5.1): parameters, accounts with their opening
 * balance, lines and closing totals. The checks R-1 to R-6 and R-9 of one reading are here; the session checks (R-7,
 * R-8) and the combined view of the balance types (5.7) are in ../ledger.ts.
 *
 * Amounts are integer cents converted from the text (pt-BR "1.234,56" in the TXT and in the balances of the XML, the
 * Number text "1234.56" in the XML); balances are signed with credit positive (C) and debit negative (D), as R-1 writes
 * them: opening + Σ (credit − debit) = final. Dates are day numbers (src/shared/dates.ts).
 */
import { LEDGER_DEFAULT_TITLES, LEDGER_FIELDS, type LedgerField } from '../../../../config/reconciliationSchema';
import { INVALID_TIME, dayFromExcelSerial, formatDay, lastDayOfMonth, parseDate } from '../../../../shared/dates';
import { formatCents } from '../../../../shared/format';
import { centsFromBrText, parseCents } from '../../../../shared/money';
import { LEDGER_BALANCE_TYPES, type LedgerBalanceType, type ReconciliationFormat } from '../../../../shared/modules/reconciliation';
import type { CheckResult } from '../../../../shared/protocol';
import { spoolRoutine } from '../../../../shared/spool';
import { normalizeTitle } from '../../../../shared/titles';
import type { SpreadsheetCells } from '../formats/spreadsheetml';

/** `Pergunta NN → (rótulo, valor)` of the extraction (5.1). */
export interface LedgerParameter {
  /** Two digits, as printed ("06"). */
  number: string;
  label: string;
  value: string;
}

/** Parameters the Rastreabilidade must show (5.1): accounts, dates, currency, balance type, report type. */
export const LEDGER_TRACE_PARAMETERS = ['01', '02', '03', '04', '05', '06', '08'] as const;

/** One ledger line (5.1). Identity = (date, key): the key alone repeats between months. */
export interface LedgerLine {
  date: number;
  /** LOTE/SUB/DOC/LINHA: 18 digits (batch 6 + sub-batch 3 + document 6 + line 3). */
  key: string;
  history: string;
  counterpart: string;
  costCenter: string;
  /** FILIAL CTB: the branch of every rule (D-8). */
  ledgerBranch: string;
  productGroup: string;
  /** FILIAL DE ORIGEM: only in the XML, never used by a rule (5.1); null in the TXT. */
  originBranch: string | null;
  debit: number;
  credit: number;
  /** Running balance as printed, signed (credit positive). */
  balance: number;
  /** Line of the file (TXT) or row of the ledger sheet (XML). */
  source: number;
}

export interface LedgerClosing {
  debit: number;
  credit: number;
  balance: number;
  source: number;
}

export interface LedgerAccount {
  /** Code as printed ("9.9.1.0.10.01"). */
  code: string;
  description: string;
  /** Opening balance at the start date of the report (signed). */
  openingBalance: number;
  /** Line of the opening. */
  source: number;
  lines: LedgerLine[];
  /** "Totais da Conta"; null when the account was not closed (R-1 fails). */
  closing: LedgerClosing | null;
}

/** A page transport of the TXT (5.2): `A TRANSPORTAR` at the end of a page, `DE TRANSPORTE` at the start of the next. */
export interface LedgerTransport {
  kind: 'carried' | 'brought';
  account: string;
  value: number;
  /** Running balance at that point: of the last line printed, or the opening balance. */
  expected: number;
  source: number;
}

/** A line that is not part of the records: of an unknown type, or a ledger line that could not be read. */
export interface LedgerIssue {
  source: number;
  /** The line (TXT) or the cells joined by " | " (XML). */
  text: string;
  /** Account open at that point. */
  account: string | null;
  reason: string;
}

/** The normalized records of one ledger file and what its reading found. */
export interface LedgerReading {
  format: ReconciliationFormat;
  /** Worksheet of the ledger (XML). */
  sheetName: string | null;
  /** Lines (TXT) or rows (XML, all worksheets) read. */
  sourceLines: number;
  parameters: LedgerParameter[];
  /** TXT and PDF: page titles (`SIGA /CTBR400/`) with and without the `(Pre-Lancamento)` marker; null in the XML. */
  titles: { withMarker: number; withoutMarker: number } | null;
  accounts: LedgerAccount[];
  grandTotal: { debit: number; credit: number; source: number } | null;
  transports: LedgerTransport[];
  /** Lines of an unknown type; inside an account they fail R-6. */
  unknown: LedgerIssue[];
  /** Ledger lines that could not be read (no date, malformed amounts, outside an account): R-3. */
  invalid: LedgerIssue[];
}

/** The layout of the file is not the one documented (title out of position, no title line): stop and ask (5.2). */
export class LedgerLayoutError extends Error {
  override name = 'LedgerLayoutError';
  constructor(
    message: string,
    readonly source: number,
  ) {
    super(message);
  }
}

/** Marker of the pre-entry balance type in the page title of the TXT (5.6, R-9). */
export const PRE_ENTRY_TITLE_MARKER = '(Pre-Lancamento)';

/** Titles of the TXT and where each one starts (5.2, observed in the real report); any other position stops the reading. */
export const LEDGER_TEXT_TITLES = [
  ['LOTE/SUB/DOC/LINHA', 0],
  ['H I S T O R I C O', 20],
  ['C/PARTIDA', 60],
  ['C CUSTO', 85],
  ['FILIAL CTB', 111],
  ['GRP PRODUT', 137],
  ['DEBITO', 165],
  ['CREDITO', 186],
  ['SALDO ATUAL', 204],
] as const;

/** Fields of a TXT ledger line (5.2): [start, end) base 0; the three amounts from AMOUNTS_FROM on, read from the right. */
const TEXT_FIELDS = {
  key: [0, 18],
  history: [19, 59],
  counterpart: [60, 85],
  costCenter: [85, 111],
  ledgerBranch: [111, 137],
  productGroup: [137, 160],
} as const;
const AMOUNTS_FROM = 160;

const AMOUNT = String.raw`[\d.]*\d,\d\d`;
const BALANCE = String.raw`(${AMOUNT})(?: ([DC]))?`;
const ENTRY = /^\d{18} /;
const ENTRY_AMOUNTS = new RegExp(String.raw`^\s*(${AMOUNT})\s+(${AMOUNT})\s+${BALANCE}\s*$`);
const PARAMETER_TEXT = /^\s*Pergunta (\d{2}) : (.*?) \?(.*)$/;
const PARAMETER_CELL = /^\s*Pergunta (\d{2}) : (.*?) \?\s*$/;
const GROUP = /^\s*\d+(\.\d+)+\s+- /;
const OPENING_TEXT = new RegExp(String.raw`^\s*CONTA - (\S+)\s+- (.*?)\s+SALDO ANTERIOR:\s+${BALANCE}\s*$`);
const OPENING_CELL = /^\s*CONTA - (\S+) - (.*?)\s*$/;
const OPENING_BALANCE_CELL = new RegExp(String.raw`^\s*SALDO ANTERIOR:\s+${BALANCE}\s*$`);
const CARRIED = new RegExp(String.raw`A TRANSPORTAR :\s+${BALANCE}\s*$`);
const BROUGHT = new RegExp(String.raw`^\s*CONTA - (\S+)\s+- .*?DE TRANSPORTE :\s+${BALANCE}\s*$`);
const DATE_LINE = /^\d{2}\/\d{2}\/\d{4}$/;
const CLOSING_LABEL = 'T o t a i s  d a  C o n t a';
const GRAND_LABEL = 'T O T A L  G E R A L';
const CLOSING_TEXT = new RegExp(String.raw`^\s*${CLOSING_LABEL}  ==>\s+(${AMOUNT})\s+(${AMOUNT})\s+${BALANCE}\s*$`);
const GRAND_TEXT = new RegExp(String.raw`^\s*${GRAND_LABEL} ==>\s+(${AMOUNT})\s+(${AMOUNT})\s*$`);
const KEY = /^\d{18}$/;
const BALANCE_CELL = new RegExp(String.raw`^\s*${BALANCE}\s*$`);

/** "1.234,56" + D/C → signed cents (credit positive); a zero comes without D/C (5.1). NaN when malformed. */
function signedBalance(amount: string, side: string | undefined): number {
  const cents = centsFromBrText(amount);
  if (Number.isNaN(cents)) return NaN;
  if (side === undefined) return cents === 0 ? 0 : NaN;
  return side === 'D' ? -cents : cents;
}

/** Signed balance as printed: "1.234,56 C", "1.234,56 D" or "0,00". */
export function balanceText(cents: number): string {
  if (cents === 0) return formatCents(0);
  return `${formatCents(Math.abs(cents))} ${cents > 0 ? 'C' : 'D'}`;
}

/** The value of a parameter, or null when the report does not print it. */
export function ledgerParameter(reading: LedgerReading, number: string): string | null {
  return reading.parameters.find((p) => p.number === number)?.value ?? null;
}

/** Balance type of every line of the file: the parameter 06 (5.1), or null when it is neither 1 nor 9 (R-9). */
export function ledgerBalanceType(reading: LedgerReading): LedgerBalanceType | null {
  const v = ledgerParameter(reading, '06');
  return (LEDGER_BALANCE_TYPES as readonly string[]).includes(v ?? '') ? (v as LedgerBalanceType) : null;
}

/** Interval of the report (parameters 03 and 04) as day numbers; null when absent or not a date. */
export function ledgerInterval(reading: LedgerReading): { from: number; to: number } | null {
  const from = parseDate((ledgerParameter(reading, '03') ?? '').trim());
  const to = parseDate((ledgerParameter(reading, '04') ?? '').trim());
  return from === INVALID_TIME || to === INVALID_TIME ? null : { from, to };
}

/** Shared state of the two readers: the records being built. */
class LedgerBuilder {
  readonly parameters: LedgerParameter[] = [];
  readonly accounts: LedgerAccount[] = [];
  readonly transports: LedgerTransport[] = [];
  readonly unknown: LedgerIssue[] = [];
  readonly invalid: LedgerIssue[] = [];
  grandTotal: LedgerReading['grandTotal'] = null;
  /** Account between its opening and its closing. */
  account: LedgerAccount | null = null;
  sourceLines = 0;

  parameter(number: string, label: string, value: string, source: number, where = `linha ${source}`): void {
    if (this.parameters.some((p) => p.number === number)) throw new LedgerLayoutError(`Pergunta ${number} repetida nos parâmetros do razão (${where}).`, source);
    this.parameters.push({ number, label: label.trim(), value: value.trim() });
  }

  open(code: string, description: string, openingBalance: number, source: number): void {
    this.account = { code, description: description.trim(), openingBalance, source, lines: [], closing: null };
    this.accounts.push(this.account);
  }

  /** Running balance at this point of the open account: the last line printed, or the opening balance. */
  get running(): number {
    const a = this.account!;
    return a.lines.length > 0 ? a.lines[a.lines.length - 1]!.balance : a.openingBalance;
  }

  close(debit: number, credit: number, balance: number, source: number): void {
    this.account!.closing = { debit, credit, balance, source };
    this.account = null;
  }

  grand(debit: number, credit: number, source: number, text: string): void {
    if (this.grandTotal) this.issue('unknown', source, text, 'Segundo total geral no mesmo arquivo.');
    else this.grandTotal = { debit, credit, source };
  }

  issue(list: 'unknown' | 'invalid', source: number, text: string, reason: string): void {
    this[list].push({ source, text, account: this.account?.code ?? null, reason });
  }

  reading(format: ReconciliationFormat, sheetName: string | null, titles: LedgerReading['titles']): LedgerReading {
    return {
      format,
      sheetName,
      sourceLines: this.sourceLines,
      parameters: [...this.parameters].sort((a, b) => a.number.localeCompare(b.number)),
      titles,
      accounts: this.accounts,
      grandTotal: this.grandTotal,
      transports: this.transports,
      unknown: this.unknown,
      invalid: this.invalid,
    };
  }
}

/**
 * Fixed-width lines (5.2), in order: `line()` for each normalized line, then `finish()`. The page header of the spool
 * (between a `****` line and the next, with the `SIGA /CTBR400/` line) is identification only: the PDF has none, so
 * nothing but the routine and the title marker is taken from it (3.3). From a PDF (`format: 'pdf'`) the same lines come
 * without the `****` rules, and `pageHeader()` gives, before the lines of each page, its proportional text: the routine,
 * the title (with the marker) and, on the first page, the parameters (3.3, step 6), which the TXT has in the body.
 */
export class LedgerTextReader {
  private readonly b = new LedgerBuilder();
  private readonly format: 'text' | 'pdf';
  /** `body` → `****` → `header` (page header) → `****` → `afterHeader` (DATA and titles, or the parameters) → `****`. */
  private state: 'body' | 'header' | 'afterHeader' = 'body';
  private titlesOfPage = false;
  private titlesSeen = false;
  private withMarker = 0;
  private withoutMarker = 0;
  private date = INVALID_TIME;

  constructor(options: { format?: 'text' | 'pdf' } = {}) {
    this.format = options.format ?? 'text';
  }

  /**
   * The proportional text of a page of the PDF, in reading order, before its lines. One title per page: the page has
   * the marker when any of its header lines has it (in the PDF the routine and the title are separate lines).
   */
  pageHeader(lines: readonly string[], page: number): void {
    let routine: string | null = null;
    let marker = false;
    for (const text of lines) {
      const m = PARAMETER_TEXT.exec(text);
      if (m) {
        this.b.parameter(m[1]!, m[2]!, m[3]!, page, `página ${page} do PDF`);
        continue;
      }
      if (text.includes(PRE_ENTRY_TITLE_MARKER)) marker = true;
      const found = spoolRoutine(text);
      if (found === null) continue;
      if (found !== 'CTBR400') throw new LedgerLayoutError(`O arquivo não é um razão CTBR400: a página ${page} é de ${found}.`, page);
      routine = found;
    }
    if (routine === null) return;
    if (marker) this.withMarker++;
    else this.withoutMarker++;
  }

  line(text: string, n: number): void {
    const b = this.b;
    b.sourceLines = n;
    if (text.startsWith('****')) {
      this.rule();
      return;
    }
    // The bottom border of the parameters page comes glued to the padding of the last answer (observed): a separator
    // that neither opens nor closes a page header.
    if (text.charCodeAt(0) === 32 && /^ +\*{4,} *$/.test(text)) return;
    if (this.state === 'header' || text.startsWith('*')) {
      this.headerLine(text, n);
      return;
    }
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === 'DATA' || text.startsWith('----')) return;
    let m: RegExpExecArray | null;
    if ((m = PARAMETER_TEXT.exec(text))) {
      b.parameter(m[1]!, m[2]!, m[3]!, n);
      return;
    }
    if (text.startsWith(LEDGER_TEXT_TITLES[0][0])) {
      this.titleLine(text, n);
      return;
    }
    if (GROUP.test(text)) return;
    if (text.includes('A TRANSPORTAR :')) {
      this.transport('carried', CARRIED.exec(text), null, text, n);
      return;
    }
    if (text.includes('DE TRANSPORTE :')) {
      m = BROUGHT.exec(text);
      this.transport('brought', m ? [m[2]!, m[3]] : null, m?.[1] ?? null, text, n);
      return;
    }
    if (text.includes('SALDO ANTERIOR:') && (m = OPENING_TEXT.exec(text))) {
      const opening = signedBalance(m[3]!, m[4]);
      if (Number.isNaN(opening)) b.issue('unknown', n, text, 'Saldo anterior ilegível.');
      else {
        b.open(m[1]!, m[2]!, opening, n);
        this.date = INVALID_TIME;
      }
      return;
    }
    if (DATE_LINE.test(trimmed)) {
      this.date = parseDate(trimmed);
      if (this.date === INVALID_TIME) b.issue('invalid', n, text, 'Data inválida.');
      return;
    }
    if (ENTRY.test(text)) {
      this.entry(text, n);
      return;
    }
    if (text.trimStart().startsWith(CLOSING_LABEL)) {
      m = CLOSING_TEXT.exec(text);
      const balance = m ? signedBalance(m[3]!, m[4]) : NaN;
      if (!m || !b.account || Number.isNaN(balance)) b.issue('unknown', n, text, b.account ? 'Totais da conta ilegíveis.' : 'Totais fora de uma conta.');
      else b.close(centsFromBrText(m[1]!), centsFromBrText(m[2]!), balance, n);
      return;
    }
    if (text.includes(GRAND_LABEL)) {
      m = GRAND_TEXT.exec(text);
      if (!m) b.issue('unknown', n, text, 'Total geral ilegível.');
      else b.grand(centsFromBrText(m[1]!), centsFromBrText(m[2]!), n, text);
      return;
    }
    b.issue('unknown', n, text, 'Tipo de linha não descrito (seção 5.2).');
  }

  finish(): LedgerReading {
    return this.b.reading(this.format, null, { withMarker: this.withMarker, withoutMarker: this.withoutMarker });
  }

  private rule(): void {
    if (this.state === 'body') this.state = 'header';
    else if (this.state === 'header') {
      this.state = 'afterHeader';
      this.titlesOfPage = false;
    } else this.state = this.titlesOfPage ? 'body' : 'header';
  }

  private headerLine(text: string, n: number): void {
    // A ledger line is never part of a page header: if one is here, the page structure is not the one described.
    if (ENTRY.test(text)) {
      this.b.issue('unknown', n, text, 'Lançamento dentro do cabeçalho da página.');
      return;
    }
    const routine = spoolRoutine(text);
    if (routine === null) return;
    if (routine !== 'CTBR400') throw new LedgerLayoutError(`O arquivo não é um razão CTBR400: a linha ${n} é de ${routine}.`, n);
    if (text.includes(PRE_ENTRY_TITLE_MARKER)) this.withMarker++;
    else this.withoutMarker++;
  }

  /** The line of titles: every title where the layout documents it (5.2), on every page. */
  private titleLine(text: string, n: number): void {
    for (const [title, at] of LEDGER_TEXT_TITLES) {
      const found = text.indexOf(title);
      if (found !== at) {
        const where = found < 0 ? 'não encontrado' : `na coluna ${found + 1}`;
        throw new LedgerLayoutError(`Linha ${n}: título "${title}" ${where}; o leiaute documentado o tem na coluna ${at + 1}. Leitura interrompida (seção 5.2).`, n);
      }
    }
    this.titlesOfPage = true;
    this.titlesSeen = true;
  }

  private transport(kind: LedgerTransport['kind'], m: readonly (string | undefined)[] | null, code: string | null, text: string, n: number): void {
    const b = this.b;
    const value = m ? signedBalance(m[kind === 'carried' ? 1 : 0]!, m[kind === 'carried' ? 2 : 1]) : NaN;
    if (!b.account || Number.isNaN(value) || (code !== null && code !== b.account.code)) {
      b.issue('unknown', n, text, b.account ? 'Transporte ilegível ou de outra conta.' : 'Transporte fora de uma conta.');
      return;
    }
    b.transports.push({ kind, account: b.account.code, value, expected: b.running, source: n });
  }

  private entry(text: string, n: number): void {
    const b = this.b;
    if (!this.titlesSeen) throw new LedgerLayoutError(`Linha ${n}: lançamento antes da linha de títulos; as colunas não puderam ser conferidas (seção 5.2).`, n);
    if (!b.account) {
      b.issue('invalid', n, text, 'Lançamento fora de uma conta.');
      return;
    }
    const field = (f: keyof typeof TEXT_FIELDS) => text.slice(TEXT_FIELDS[f][0], TEXT_FIELDS[f][1]).trim();
    const m = ENTRY_AMOUNTS.exec(text.slice(AMOUNTS_FROM));
    const balance = m ? signedBalance(m[3]!, m[4]) : NaN;
    if (!m || Number.isNaN(balance)) {
      b.issue('invalid', n, text, 'Débito, crédito e saldo não estão no formato 1.234,56 a partir da coluna 161.');
      return;
    }
    if (this.date === INVALID_TIME) {
      b.issue('invalid', n, text, 'Lançamento sem data.');
      return;
    }
    b.account.lines.push({
      date: this.date,
      key: field('key'),
      history: field('history'),
      counterpart: field('counterpart'),
      costCenter: field('costCenter'),
      ledgerBranch: field('ledgerBranch'),
      productGroup: field('productGroup'),
      originBranch: null,
      debit: centsFromBrText(m[1]!),
      credit: centsFromBrText(m[2]!),
      balance,
      source: n,
    });
  }
}

const titleKey = (title: string) => normalizeTitle(title).toUpperCase();
const textOf = (cells: SpreadsheetCells, c: number) => cells[c]?.text ?? '';

/**
 * Spreadsheet rows of the XML (5.3), in order, from every worksheet: `row()` for each, then `finish()`. Parameters come
 * from the `Parametros` sheet (column 1 = question, column 2 = answer); the ledger sheet is the one with the row of
 * titles, found by the titles (of the profile, or those the Protheus writes), not by its name.
 */
export class LedgerSheetReader {
  private readonly b = new LedgerBuilder();
  private readonly titles: Record<LedgerField, string>;
  private ledgerSheet: number | null = null;
  private sheetName: string | null = null;
  private column: Record<LedgerField, number> | null = null;
  /** The row after a closing or grand total label holds its amounts. */
  private pending: { kind: 'closing' | 'grand'; text: string; source: number } | null = null;

  constructor(titles?: Partial<Record<LedgerField, string>>) {
    this.titles = { ...LEDGER_DEFAULT_TITLES, ...titles };
  }

  row(sheet: number, sheetName: string, r: number, cells: SpreadsheetCells): void {
    this.b.sourceLines++;
    if (this.ledgerSheet === null || sheet !== this.ledgerSheet) {
      const columns = this.titleColumns(cells);
      if (columns) {
        if (this.ledgerSheet !== null) throw new LedgerLayoutError(`Duas abas com a linha de títulos do razão: "${this.sheetName}" e "${sheetName}".`, r);
        this.ledgerSheet = sheet;
        this.sheetName = sheetName;
        this.column = columns;
        return;
      }
      if (titleKey(sheetName) === 'PARAMETROS') {
        const m = PARAMETER_CELL.exec(textOf(cells, 0));
        if (m) this.b.parameter(m[1]!, m[2]!, textOf(cells, 1), r);
      }
      return;
    }
    this.ledgerRow(r, cells);
  }

  finish(): LedgerReading {
    if (this.ledgerSheet === null) {
      const titles = LEDGER_FIELDS.map((f) => this.titles[f]).join(', ');
      throw new LedgerLayoutError(`Nenhuma aba com a linha de títulos do razão (${titles}).`, 0);
    }
    if (this.pending) this.b.issue('unknown', this.pending.source, this.pending.text, 'Totais sem a linha de valores.');
    return this.b.reading('xml', this.sheetName, null);
  }

  /** Column of each field when the row is the row of titles (every title present once), else null. */
  private titleColumns(cells: SpreadsheetCells): Record<LedgerField, number> | null {
    const at = new Map<string, number>();
    cells.forEach((c, i) => {
      if (c?.kind === 'text') at.set(titleKey(c.text), i);
    });
    const columns = {} as Record<LedgerField, number>;
    for (const f of LEDGER_FIELDS) {
      const i = at.get(titleKey(this.titles[f]));
      if (i === undefined) return null;
      columns[f] = i;
    }
    return columns;
  }

  private ledgerRow(r: number, cells: SpreadsheetCells): void {
    const b = this.b;
    const col = this.column!;
    const text = (f: LedgerField) => textOf(cells, col[f]).trim();
    const joined = cells.map((c) => c?.text ?? '').join(' | ');
    if (cells.every((c) => c === null || c.text.trim() === '')) return;
    if (this.pending) {
      this.totals(r, cells, joined);
      return;
    }
    const titles = this.titleColumns(cells);
    if (titles) {
      if (LEDGER_FIELDS.some((f) => titles[f] !== col[f])) throw new LedgerLayoutError(`Linha ${r}: a linha de títulos repetida tem as colunas em outra ordem.`, r);
      return;
    }
    const first = textOf(cells, 0).trim();
    if (first === 'CONTA' && textOf(cells, 1).trim() === 'DESCRICAO') return;
    if (GROUP.test(`${textOf(cells, 0)} ${textOf(cells, 1)}`) && cells.slice(2).every((c) => c === null || c.text.trim() === '')) return;
    let m: RegExpExecArray | null;
    if ((m = OPENING_CELL.exec(first))) {
      const balance = cells.slice(1).map((c) => OPENING_BALANCE_CELL.exec(c?.text ?? '')).find((x) => x !== null);
      const opening = balance ? signedBalance(balance[1]!, balance[2]) : NaN;
      if (Number.isNaN(opening)) b.issue('unknown', r, joined, 'Abertura de conta sem saldo anterior legível.');
      else b.open(m[1]!, m[2]!, opening, r);
      return;
    }
    if (first.startsWith(CLOSING_LABEL) || first.startsWith(GRAND_LABEL)) {
      this.pending = { kind: first.startsWith(CLOSING_LABEL) ? 'closing' : 'grand', text: joined, source: r };
      return;
    }
    const date = this.dateOf(cells[col.date] ?? null);
    if (date !== INVALID_TIME && text('batchKey') !== '') {
      this.entry(r, cells, date, joined);
      return;
    }
    if (date !== INVALID_TIME && text('history') !== '') {
      b.issue('unknown', r, joined, 'Continuação de histórico (linha com data e sem chave): não observada nas amostras (P-3).');
      return;
    }
    b.issue('unknown', r, joined, 'Tipo de linha não descrito (seção 5.3).');
  }

  /** A DateTime cell (the Excel serial of a whole day) → day number. */
  private dateOf(cell: SpreadsheetCells[number]): number {
    if (cell?.kind !== 'number' || !/^\d+$/.test(cell.text)) return INVALID_TIME;
    return dayFromExcelSerial(Number(cell.text));
  }

  /** A Number cell → cents from its text ("1234.5", "8641568"), never through a float; NaN otherwise. */
  private centsOf(cells: SpreadsheetCells, f: LedgerField): number {
    const cell = cells[this.column![f]];
    if (cell?.kind !== 'number') return NaN;
    const cents = parseCents(cell.text);
    return cents < 0 ? NaN : cents;
  }

  private balanceOf(cells: SpreadsheetCells, f: LedgerField): number {
    const m = BALANCE_CELL.exec(textOf(cells, this.column![f]));
    return m ? signedBalance(m[1]!, m[2]) : NaN;
  }

  private totals(r: number, cells: SpreadsheetCells, joined: string): void {
    const b = this.b;
    const pending = this.pending!;
    this.pending = null;
    const debit = this.centsOf(cells, 'debit');
    const credit = this.centsOf(cells, 'credit');
    if (pending.kind === 'grand') {
      if (Number.isNaN(debit) || Number.isNaN(credit)) b.issue('unknown', r, joined, 'Total geral ilegível.');
      else b.grand(debit, credit, r, joined);
      return;
    }
    const balance = this.balanceOf(cells, 'balance');
    if (!b.account || Number.isNaN(debit) || Number.isNaN(credit) || Number.isNaN(balance)) {
      b.issue('unknown', r, joined, b.account ? 'Totais da conta ilegíveis.' : 'Totais fora de uma conta.');
      return;
    }
    b.close(debit, credit, balance, r);
  }

  private entry(r: number, cells: SpreadsheetCells, date: number, joined: string): void {
    const b = this.b;
    const col = this.column!;
    const text = (f: LedgerField) => textOf(cells, col[f]).trim();
    if (!b.account) {
      b.issue('invalid', r, joined, 'Lançamento fora de uma conta.');
      return;
    }
    const debit = this.centsOf(cells, 'debit');
    const credit = this.centsOf(cells, 'credit');
    const balance = this.balanceOf(cells, 'balance');
    if (!KEY.test(text('batchKey')) || Number.isNaN(debit) || Number.isNaN(credit) || Number.isNaN(balance)) {
      b.issue('invalid', r, joined, 'Chave sem 18 algarismos, ou débito, crédito e saldo ilegíveis.');
      return;
    }
    b.account.lines.push({
      date,
      key: text('batchKey'),
      history: text('history'),
      counterpart: text('counterpart'),
      costCenter: text('costCenter'),
      ledgerBranch: text('ledgerBranch'),
      productGroup: text('productGroup'),
      originBranch: text('originBranch'),
      debit,
      credit,
      balance,
      source: r,
    });
  }
}

/** First and last day of a competence (the month of the payroll). */
export interface CompetenceDays {
  first: number;
  last: number;
}

/** The days of the competence `month`/`year`. */
export function competenceDays(year: number, month: number): CompetenceDays {
  const first = parseDate(`01/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}`);
  if (first === INVALID_TIME) throw new Error(`Competência inválida: ${month}/${year}.`);
  return { first, last: lastDayOfMonth(first) };
}

/** Up to five cases of a failed check, and how many more. */
function cases(list: string[]): string {
  const shown = list.slice(0, 5).join('; ');
  return list.length > 5 ? `${shown}; e mais ${list.length - 5}` : shown;
}

/**
 * Invariants of one ledger reading (5.6): R-1 to R-6 and R-9 (all block), and R-4 against the competence of the
 * session. R-7 and R-8 compare the readings of a session (../ledger.ts). Messages name the line of the file.
 */
export function ledgerReadingChecks(reading: LedgerReading, competence: CompetenceDays): CheckResult[] {
  const where = (source: number) => (reading.format === 'xml' ? `linha ${source} da aba "${reading.sheetName ?? ''}"` : reading.format === 'pdf' ? `linha ${source} do texto do PDF` : `linha ${source}`);
  const check = (id: string, label: string, failures: string[], ok: string): CheckResult => ({
    id,
    label,
    severity: 'error',
    passed: failures.length === 0,
    message: failures.length === 0 ? ok : cases(failures),
  });

  const r1: string[] = [];
  const r2: string[] = [];
  const r3: string[] = reading.invalid.map((i) => `${where(i.source)}: ${i.reason}`);
  for (const a of reading.accounts) {
    let running = a.openingBalance;
    let debit = 0;
    let credit = 0;
    for (const line of a.lines) {
      running += line.credit - line.debit;
      debit += line.debit;
      credit += line.credit;
      if (running !== line.balance) r2.push(`conta ${a.code}, ${where(line.source)}: saldo impresso ${balanceText(line.balance)}, calculado ${balanceText(running)}`);
      if (line.debit > 0 && line.credit > 0) r3.push(`${where(line.source)}: débito e crédito no mesmo lançamento`);
    }
    if (!a.closing) r1.push(`conta ${a.code} (aberta na ${where(a.source)}) sem "Totais da Conta"`);
    else {
      const wrong: string[] = [];
      if (running !== a.closing.balance) wrong.push(`saldo anterior + Σ (crédito − débito) = ${balanceText(running)}, fecho ${balanceText(a.closing.balance)}`);
      if (debit !== a.closing.debit) wrong.push(`Σ débitos ${formatCents(debit)}, fecho ${formatCents(a.closing.debit)}`);
      if (credit !== a.closing.credit) wrong.push(`Σ créditos ${formatCents(credit)}, fecho ${formatCents(a.closing.credit)}`);
      if (wrong.length > 0) r1.push(`conta ${a.code} (fecho na ${where(a.closing.source)}): ${wrong.join(', ')}`);
    }
  }
  const lines = reading.accounts.reduce((n, a) => n + a.lines.length, 0);
  const results = [
    check('R-1', 'Saldo anterior + movimento = saldo final do fecho, por conta', r1, `${reading.accounts.length} conta(s): saldos e totais do fecho conferem.`),
    check('R-2', 'Saldo corrido de cada linha', r2, `${lines} linha(s): saldo corrido confere em todas.`),
    check('R-3', 'Lançamentos com chave, data e um só lado', r3, `${lines} lançamento(s) com chave de 18 algarismos, data válida e um só lado.`),
  ];

  const interval = ledgerInterval(reading);
  const r4: string[] = [];
  if (!interval) r4.push('parâmetros 03/04 (intervalo do relatório) ausentes ou sem data válida');
  else if (interval.from > competence.first || interval.to < competence.last) {
    r4.push(`o relatório vai de ${formatDay(interval.from)} a ${formatDay(interval.to)} e não contém a competência (${formatDay(competence.first)} a ${formatDay(competence.last)})`);
  }
  results.push(check('R-4', 'Intervalo do relatório contém a competência', r4, interval ? `De ${formatDay(interval.from)} a ${formatDay(interval.to)}: contém a competência.` : ''));

  const r5 = reading.transports.filter((t) => t.value !== t.expected).map((t) => `${where(t.source)}: ${t.kind === 'carried' ? 'A TRANSPORTAR' : 'DE TRANSPORTE'} ${balanceText(t.value)}, saldo corrido ${balanceText(t.expected)}`);
  results.push(check('R-5', 'Transportes de página = saldo corrido', r5, reading.format !== 'xml' ? `${reading.transports.length} transporte(s) conferem com o saldo corrido.` : 'Não se aplica ao XML (sem transporte de página).'));

  const r6 = reading.unknown.filter((u) => u.account !== null).map((u) => `${where(u.source)} (conta ${u.account}): ${u.reason}`);
  results.push(check('R-6', 'Nenhuma linha desconhecida dentro de uma conta', r6, 'Nenhuma linha desconhecida entre a abertura e o fecho das contas.'));

  const type = ledgerParameter(reading, '06');
  const r9: string[] = [];
  if (type === null) r9.push('parâmetro 06 (tipo de saldo) ausente');
  else if (ledgerBalanceType(reading) === null) r9.push(`parâmetro 06 = "${type}" (aceitos: 1 real, 9 pré-lançamento)`);
  const t = reading.titles;
  if (t && type !== null) {
    if (type === '9' && (t.withMarker === 0 || t.withoutMarker > 0)) r9.push(`parâmetro 06 = 9, mas ${t.withoutMarker} título(s) de página sem o marcador ${PRE_ENTRY_TITLE_MARKER}`);
    if (type !== '9' && t.withMarker > 0) r9.push(`parâmetro 06 = ${type}, mas ${t.withMarker} título(s) de página com o marcador ${PRE_ENTRY_TITLE_MARKER}`);
  }
  results.push(check('R-9', 'Tipo de saldo do parâmetro 06 (1 ou 9) e marcador do título', r9, `Tipo de saldo ${type ?? ''}${t ? (type === '9' ? `, com o marcador ${PRE_ENTRY_TITLE_MARKER} no título` : ', sem marcador no título') : ''}.`));
  return results;
}
