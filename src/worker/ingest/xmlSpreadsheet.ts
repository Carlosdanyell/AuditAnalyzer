/**
 * Streaming reader of the XML Spreadsheet 2003 format (the "XML" the Protheus writes without converting it to .xlsx;
 * docs/REGRAS_CT2_INTEGRIDADE.md, section 2.1, and docs/ARQUITETURA.md, 1.2). The file is one XML document,
 * <Workbook> → <Worksheet ss:Name> → <Table> → <Row> → <Cell> → <Data ss:Type>, often several GB, so it is decoded and
 * parsed in pieces: only complete rows are parsed and the incomplete tail of a piece waits for the next one.
 *
 * Each row is delivered in the same ParsedRow as the .xlsx reader, so the modules read both alike: String → text,
 * Number → the number as written, DateTime → the serial number Excel would store, Boolean and Error → other. An empty
 * text is an empty cell. Handled: ss:Index of rows and cells (or the next position), ss:MergeAcross, self-closing
 * rows and cells, CDATA, entities, formatted texts (tags inside <Data>), comments, an optional "ss:" prefix on the
 * element names, ss:ExpandedRowCount, and the end of the document (</Workbook>), without which the file is incomplete.
 */
import { INVALID_TIME, excelSerialOfDay, parseDate } from '../../shared/dates';
import { CellKind, ParsedRow, SheetFormatError } from './sheetStream';
import { decodeXmlEntities } from './xmlText';

export interface XmlSheetInfo {
  /** Position of the worksheet in the file, from 0. */
  index: number;
  name: string;
  /** ss:ExpandedRowCount of its <Table>, when present (the last row, like <dimension> of an .xlsx). */
  expandedRowCount: number | null;
}

export interface XmlSpreadsheetHandlers {
  onSheet?(sheet: XmlSheetInfo): void;
  /** Each row present, in order. `row` is reused: read it during the call. */
  onRow(sheet: number, r: number, row: ParsedRow): void;
}

export interface XmlSpreadsheetOptions {
  /** Reads only the first rows of each worksheet (the others are skipped quickly). */
  headRows?: number;
}

/** A piece of the document that needs more text to be parsed (internal). */
class NeedMore extends Error {}
const NEED_MORE = new NeedMore();

const enum Phase {
  Prolog,
  Workbook,
  Sheet,
  Table,
  AfterTable,
  Done,
}

/** Name, attributes and end of the tag that starts at `at` (the '<'); null for markup that is not an element. */
interface Tag {
  /** Local name (without prefix); '' for comments, CDATA, processing instructions and declarations. */
  name: string;
  /** Qualified name as written ("ss:Table"), to find the end tag. */
  qname: string;
  closing: boolean;
  selfClosing: boolean;
  /** Text between the name and the '>' (or '/>'). */
  attrs: string;
  /** Position after the '>'. */
  end: number;
}

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/;

/**
 * "aaaa-mm-ddThh:mm:ss.fff" → the Excel serial as text (whole for midnight, the time as the fraction of the day), or
 * null when it is not a valid date. Integer arithmetic on the day; no time zone.
 */
export function serialFromXmlDateTime(text: string): string | null {
  const m = DATE_TIME.exec(text.trim());
  if (!m) return null;
  const day = parseDate(`${m[3]}/${m[2]}/${m[1]}`);
  if (day === INVALID_TIME) return null;
  const h = Number(m[4] ?? 0);
  const mi = Number(m[5] ?? 0);
  const s = Number(m[6] ?? 0);
  const ms = Number(((m[7] ?? '') + '000').slice(0, 3));
  if (h > 23 || mi > 59 || s > 59) return null;
  const serial = excelSerialOfDay(day);
  const millis = ((h * 60 + mi) * 60 + s) * 1000 + ms;
  return String(millis === 0 ? serial : serial + millis / 86_400_000);
}

/** Encoding of the XML declaration at the start of the file (a byte order mark wins); UTF-8 when absent. */
export function xmlDeclaredEncoding(head: Uint8Array): string {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  let s = '';
  for (let i = 0; i < Math.min(head.length, 256); i++) s += String.fromCharCode(head[i]!);
  const m = /^\s*<\?xml\b[^>]*?\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(s);
  return m ? m[1]!.toLowerCase() : 'utf-8';
}

/** True if the start of a file looks like an XML document (after an optional byte order mark and spaces). */
export function looksLikeXml(head: Uint8Array): boolean {
  let i = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (i < head.length && head[i]! <= 32) i++;
  return head[i] === 60 /* < */;
}

const ATTRIBUTES = new Map<string, RegExp>();

function attrValue(attrs: string, local: string): string | null {
  if (attrs.indexOf(local) < 0) return null;
  // ss:Name, Name or x:Name: the local name after a space or a ':'.
  let re = ATTRIBUTES.get(local);
  if (!re) {
    re = new RegExp(`(?:^|[\\s:])${local}\\s*=\\s*("([^"]*)"|'([^']*)')`);
    ATTRIBUTES.set(local, re);
  }
  const m = re.exec(attrs);
  return m ? decodeXmlEntities(m[2] ?? m[3] ?? '') : null;
}

function intAttr(attrs: string, local: string): number | null {
  const v = attrValue(attrs, local);
  if (v === null) return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** XML line ends are read as "\n" (as Excel reads the file). */
const normalizeLines = (s: string) => (s.indexOf('\r') < 0 ? s : s.replace(/\r\n?/g, '\n'));

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const scratch = new Uint8Array(16_384);

/**
 * A copy of a cell text that does not hold the piece of the document it was cut from. The engine may cut a longer
 * text as a view of the whole piece (64 KB or more): kept in the dictionary of the Base, each distinct history would
 * keep its piece of the file in memory while the file is read (measured: about 0.9 GB for one year).
 */
function detached(s: string): string {
  if (s.length < 13) return s;
  const { read, written } = encoder.encodeInto(s, scratch);
  return read === s.length ? decoder.decode(scratch.subarray(0, written)) : decoder.decode(encoder.encode(s));
}

export class XmlSpreadsheetParser {
  readonly sheets: XmlSheetInfo[] = [];
  /** True once </Workbook> was read. */
  complete = false;

  private readonly row: ParsedRow;
  private carry = '';
  private phase = Phase.Prolog;
  private sheet = -1;
  private tableQname = 'Table';
  private rowNumber = 0;
  private rowsInSheet = 0;

  constructor(
    private readonly handlers: XmlSpreadsheetHandlers,
    width: number,
    private readonly options: XmlSpreadsheetOptions = {},
  ) {
    this.row = new ParsedRow(width);
  }

  /** True once the <Workbook> element was read (the text is a spreadsheet, even if incomplete). */
  get started(): boolean {
    return this.phase !== Phase.Prolog;
  }

  push(text: string): void {
    if (this.phase === Phase.Done) return;
    const buf = this.carry.length > 0 ? this.carry + text : text;
    const consumed = this.process(buf);
    this.carry = consumed < buf.length ? buf.slice(consumed) : '';
  }

  finish(): void {
    if (this.phase === Phase.Done) return;
    if (this.phase === Phase.Prolog) throw new SheetFormatError('O arquivo não é uma planilha XML (elemento <Workbook> não encontrado).');
    throw new SheetFormatError('O arquivo XML está incompleto: termina antes do fim da planilha (</Workbook> não encontrado).');
  }

  /** Parses what it can; returns how many characters were consumed. */
  private process(buf: string): number {
    let pos = 0;
    try {
      while (this.phase !== Phase.Done) {
        if (this.phase === Phase.Table && this.options.headRows !== undefined && this.rowsInSheet >= this.options.headRows) {
          // Head mode: jump to the end of the table.
          const close = buf.indexOf(`</${this.tableQname}`, pos);
          if (close < 0) return Math.max(pos, buf.length - this.tableQname.length - 3);
          pos = close;
        }
        const lt = buf.indexOf('<', pos);
        if (lt < 0) return buf.length;
        const tag = this.readTag(buf, lt);
        if (this.phase === Phase.Table && !tag.closing && tag.name === 'Row') {
          pos = this.readRow(buf, tag);
          continue;
        }
        pos = tag.end;
        if (tag.name === '') continue;
        this.onTag(tag);
      }
      return buf.length;
    } catch (e) {
      if (e === NEED_MORE) return pos;
      throw e;
    }
  }

  private onTag(tag: Tag): void {
    switch (this.phase) {
      case Phase.Prolog:
        if (tag.name !== 'Workbook' || tag.closing) throw new SheetFormatError('O arquivo não é uma planilha XML (elemento <Workbook> não encontrado).');
        this.phase = tag.selfClosing ? Phase.Done : Phase.Workbook;
        if (tag.selfClosing) this.complete = true;
        return;
      case Phase.Workbook:
        if (tag.name === 'Workbook' && tag.closing) {
          this.phase = Phase.Done;
          this.complete = true;
        } else if (tag.name === 'Worksheet' && !tag.closing) {
          this.sheet = this.sheets.length;
          this.sheets.push({ index: this.sheet, name: attrValue(tag.attrs, 'Name') ?? `Planilha${this.sheet + 1}`, expandedRowCount: null });
          this.rowNumber = 0;
          this.rowsInSheet = 0;
          this.handlers.onSheet?.(this.sheets[this.sheet]!);
          if (!tag.selfClosing) this.phase = Phase.Sheet;
        }
        return;
      case Phase.Sheet:
        if (tag.name === 'Table' && !tag.closing) {
          this.sheets[this.sheet]!.expandedRowCount = intAttr(tag.attrs, 'ExpandedRowCount');
          this.tableQname = tag.qname;
          this.phase = tag.selfClosing ? Phase.AfterTable : Phase.Table;
        } else if (tag.name === 'Worksheet' && tag.closing) {
          this.phase = Phase.Workbook;
        }
        return;
      case Phase.Table:
        if (tag.name === 'Table' && tag.closing) this.phase = Phase.AfterTable;
        else if (tag.name === 'Worksheet' || tag.name === 'Workbook') throw new SheetFormatError(`A tabela da aba "${this.sheets[this.sheet]!.name}" não tem fechamento (</Table>).`);
        return;
      case Phase.AfterTable:
        // Page breaks and options of the worksheet also have <Row> elements: not rows of the table.
        if (tag.name === 'Worksheet' && tag.closing) this.phase = Phase.Workbook;
        return;
    }
  }

  /**
   * Markup starting at `at`. Comments, CDATA, processing instructions and declarations come back with an empty name.
   * Throws NEED_MORE when the markup does not end in `buf`.
   */
  private readTag(buf: string, at: number): Tag {
    const c1 = buf.charCodeAt(at + 1);
    if (Number.isNaN(c1)) throw NEED_MORE;
    if (c1 === 33 /* ! */) {
      if (buf.length < at + 9) throw NEED_MORE;
      const [open, close] = buf.startsWith('<!--', at) ? ['<!--', '-->'] : buf.startsWith('<![CDATA[', at) ? ['<![CDATA[', ']]>'] : ['<!', '>'];
      const end = buf.indexOf(close, at + open.length);
      if (end < 0) throw NEED_MORE;
      return { name: '', qname: '', closing: false, selfClosing: true, attrs: '', end: end + close.length };
    }
    if (c1 === 63 /* ? */) {
      const end = buf.indexOf('?>', at + 2);
      if (end < 0) throw NEED_MORE;
      return { name: '', qname: '', closing: false, selfClosing: true, attrs: '', end: end + 2 };
    }
    const gt = buf.indexOf('>', at + 1);
    if (gt < 0) throw NEED_MORE;
    const closing = c1 === 47; /* / */
    let i = at + (closing ? 2 : 1);
    const nameStart = i;
    while (i < gt) {
      const c = buf.charCodeAt(i);
      if (c <= 32 || c === 47) break;
      i++;
    }
    const qname = buf.slice(nameStart, i);
    const colon = qname.indexOf(':');
    const selfClosing = buf.charCodeAt(gt - 1) === 47;
    return {
      name: colon < 0 ? qname : qname.slice(colon + 1),
      qname,
      closing,
      selfClosing,
      attrs: buf.slice(i, selfClosing ? gt - 1 : gt),
      end: gt + 1,
    };
  }

  /** Parses the row whose start tag is `start`; returns the position after </Row>. NEED_MORE if it is incomplete. */
  private readRow(buf: string, start: Tag): number {
    const row = this.row;
    const r = intAttr(start.attrs, 'Index') ?? this.rowNumber + 1;
    row.reset();
    let pos = start.end;
    if (!start.selfClosing) {
      let next = 0;
      let last = -1;
      for (;;) {
        const lt = buf.indexOf('<', pos);
        if (lt < 0) throw NEED_MORE;
        const tag = this.readTag(buf, lt);
        pos = tag.end;
        if (tag.name === '') continue;
        if (tag.name === 'Row' && tag.closing) break;
        if (tag.name === 'Cell' && !tag.closing) {
          const index = intAttr(tag.attrs, 'Index');
          const column = index !== null ? index - 1 : next;
          if (column <= last) throw new SheetFormatError(`Células fora de ordem na linha ${r} (coluna ${column + 1} depois da coluna ${last + 1}).`);
          last = column;
          next = column + 1 + (intAttr(tag.attrs, 'MergeAcross') ?? 0);
          pos = this.readCell(buf, tag, column, r);
          continue;
        }
        if (tag.name === 'Row' || tag.name === 'Table' || tag.name === 'Worksheet' || tag.name === 'Workbook') {
          throw new SheetFormatError(`Linha ${r} sem fechamento (</Row>).`);
        }
      }
    }
    this.rowNumber = r;
    this.rowsInSheet++;
    this.handlers.onRow(this.sheet, r, row);
    return pos;
  }

  /** Reads the cell whose start tag is `start` into `column` of the row; returns the position after </Cell>. */
  private readCell(buf: string, start: Tag, column: number, r: number): number {
    const row = this.row;
    const extra = column >= row.width;
    if (extra) row.extraCells++;
    if (start.selfClosing) return start.end;
    const slot = extra ? row.width : column;
    row.kind[slot] = CellKind.Empty;
    let pos = start.end;
    let read = false;
    for (;;) {
      const lt = buf.indexOf('<', pos);
      if (lt < 0) throw NEED_MORE;
      const tag = this.readTag(buf, lt);
      pos = tag.end;
      if (tag.name === '') continue;
      if (tag.name === 'Cell' && tag.closing) break;
      if (tag.name === 'Data' && !tag.closing && !read) {
        read = true;
        if (!tag.selfClosing) {
          const { text, end } = this.readData(buf, tag, r);
          pos = end;
          this.setValue(slot, attrValue(tag.attrs, 'Type') ?? 'String', text);
        }
        continue;
      }
      if (!tag.closing && !tag.selfClosing && (tag.name === 'Comment' || tag.name === 'Data')) {
        // A comment (or a second value) is not the value of the cell: skip it whole.
        const close = buf.indexOf(`</${tag.qname}`, pos);
        if (close < 0) throw NEED_MORE;
        pos = close;
        continue;
      }
      if (tag.name === 'Row' || tag.name === 'Cell' || tag.name === 'Table') throw new SheetFormatError(`Célula sem fechamento (</Cell>) na linha ${r}.`);
    }
    if (extra && row.kind[slot] !== CellKind.Empty) row.keepExtra();
    return pos;
  }

  /** Text of a <Data> element: its text and CDATA, the tags of a formatted text left out. */
  private readData(buf: string, start: Tag, r: number): { text: string; end: number } {
    let pos = start.end;
    let text = '';
    for (;;) {
      const lt = buf.indexOf('<', pos);
      if (lt < 0) throw NEED_MORE;
      if (lt > pos) text += decodeXmlEntities(buf.slice(pos, lt));
      if (buf.startsWith('<![CDATA[', lt)) {
        const end = buf.indexOf(']]>', lt + 9);
        if (end < 0) throw NEED_MORE;
        text += buf.slice(lt + 9, end);
        pos = end + 3;
        continue;
      }
      const tag = this.readTag(buf, lt);
      pos = tag.end;
      if (tag.closing && tag.qname === start.qname) return { text, end: pos };
      if (tag.name === 'Cell' || tag.name === 'Row') throw new SheetFormatError(`Valor sem fechamento (</Data>) na linha ${r}.`);
    }
  }

  private setValue(slot: number, type: string, raw: string): void {
    const row = this.row;
    switch (type) {
      case 'Number':
        row.kind[slot] = CellKind.Number;
        row.text[slot] = detached(raw.trim());
        return;
      case 'DateTime': {
        const serial = serialFromXmlDateTime(raw);
        row.kind[slot] = serial === null ? CellKind.Text : CellKind.Number;
        row.text[slot] = serial ?? detached(raw);
        return;
      }
      case 'Boolean':
      case 'Error':
        row.kind[slot] = CellKind.Other;
        row.text[slot] = detached(raw.trim());
        return;
      default: {
        if (raw === '') return;
        row.kind[slot] = CellKind.Text;
        row.text[slot] = detached(normalizeLines(raw));
      }
    }
  }
}
