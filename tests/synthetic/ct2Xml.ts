/**
 * Synthetic CT2 extraction in the XML Spreadsheet 2003 format, as the Protheus writes it without the conversion to .xlsx
 * (docs/REGRAS_CT2_INTEGRIDADE.md, section 2.1): one <Worksheet> named after the temporary file, every cell with
 * ss:Index and a style, texts in CDATA (empty texts as empty CDATA), amounts as Number and the date column as DateTime
 * "aaaa-mm-ddT00:00:00.000". The rows are the same as those of the .xlsx builder, so both files must read alike.
 * No real data.
 */
import { zipSync } from 'fflate';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { normalizeTitle } from '../../src/shared/titles';
import { CT2_COLUMNS, ct2SheetRows, type Ct2ExtractionOptions, type Ct2Value } from './ct2Extraction';

export interface Ct2XmlOptions extends Ct2ExtractionOptions {
  /** Declared encoding; ISO-8859-1 writes one byte per character. */
  encoding?: 'UTF-8' | 'ISO-8859-1';
  /** Texts escaped with entities instead of CDATA. */
  entities?: boolean;
  /** Cells and rows without ss:Index (their position is implied by the previous one). */
  implicitIndex?: boolean;
  /** Dates of the date column as written: DateTime (the system) or the dd/mm/aaaa text. */
  dates?: 'dateTime' | 'text';
  /** Cuts the file after this many characters (a transfer that stopped). */
  truncateAt?: number;
}

const config = ct2DefaultConfig();
const DATE_TITLES = new Set([config.columns.date.title, ...config.columns.date.aliases].map(normalizeTitle));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "dd/mm/aaaa" → "aaaa-mm-ddT00:00:00.000"; anything else stays a text. */
function dateTime(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}T00:00:00.000` : null;
}

function cellXml(index: number, value: Ct2Value, isDate: boolean, o: Ct2XmlOptions): string {
  const at = o.implicitIndex ? '' : ` ss:Index="${index}"`;
  const open = `<Cell${at} ss:StyleID="s${index}">`;
  if (typeof value === 'number') return `${open}\r\n<Data ss:Type="Number">${value}</Data>\r\n</Cell>`;
  const text = value ?? '';
  const iso = isDate && (o.dates ?? 'dateTime') === 'dateTime' ? dateTime(text) : null;
  if (iso) return `${open}\r\n<Data ss:Type="DateTime">${iso}</Data>\r\n</Cell>`;
  const body = o.entities ? esc(text) : `<![CDATA[${text}]]>`;
  return `${open}\r\n<Data ss:Type="String">${body}</Data>\r\n</Cell>`;
}

function worksheetXml(name: string, rows: { r: number; cells: Ct2Value[] | null }[], dateColumns: Set<number>, o: Ct2XmlOptions): string {
  const body = rows
    .map(({ r, cells }) => {
      const at = o.implicitIndex ? '' : ` ss:Index="${r}"`;
      if (cells === null) return `<Row${at}/>`;
      return `<Row${at}>\r\n${cells.map((v, c) => cellXml(c + 1, v, dateColumns.has(c), o)).join('\r\n')}\r\n</Row>`;
    })
    .join('\r\n');
  return `<Worksheet ss:Name="${esc(name)}">\r\n<Table>\r\n${body}\r\n</Table>\r\n</Worksheet>`;
}

/** Text of the XML file (before the encoding). */
export function ct2XmlText(o: Ct2XmlOptions): string {
  const columns = o.columns ?? CT2_COLUMNS;
  const dateColumns = new Set(columns.flatMap((t, i) => (DATE_TITLES.has(normalizeTitle(t)) ? [i] : [])));
  const rows = ct2SheetRows(o);
  if (o.implicitIndex && rows.some((row, i) => row.r !== i + 1)) throw new Error('implicitIndex needs rows without gaps.');
  const extra = Object.entries(o.extraSheets ?? {}).map(([name, cells]) => worksheetXml(name, cells.map((c, i) => ({ r: i + 1, cells: c })), new Set(), o));
  const text =
    `<?xml version="1.0" encoding="${o.encoding ?? 'UTF-8'}" ?>\r\n<?mso-application progid="Excel.Sheet"?>\r\n` +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\r\n' +
    '<Styles>\r\n<Style ss:ID="Default" ss:Name="Normal">\r\n<Font ss:FontName="Courier New" ss:Size="8">\r\n</Font>\r\n</Style>\r\n</Styles>\r\n' +
    [...extra, worksheetXml(o.sheetName ?? 'SCACKST0.XML', rows, dateColumns, o)].join('\r\n') +
    '\r\n</Workbook>\r\n';
  return o.truncateAt === undefined ? text : text.slice(0, o.truncateAt);
}

/** Bytes of the XML file in its declared encoding. */
export function buildCt2Xml(o: Ct2XmlOptions): Uint8Array {
  const text = ct2XmlText(o);
  if (o.encoding !== 'ISO-8859-1') return new TextEncoder().encode(text);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error(`Character outside ISO-8859-1 at ${i}.`);
    bytes[i] = code;
  }
  return bytes;
}

/** An XML Spreadsheet 2003 workbook with raw sheets (rows from row 1; an empty row is written without cells), in UTF-8. */
export function buildXmlWorkbook(sheets: Record<string, Ct2Value[][]>, o: Ct2XmlOptions = { rows: [] }): Uint8Array {
  const body = Object.entries(sheets).map(([name, rows]) => worksheetXml(name, rows.map((cells, i) => ({ r: i + 1, cells: cells.length > 0 ? cells : null })), new Set(), o));
  return new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" ?>\r\n<?mso-application progid="Excel.Sheet"?>\r\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\r\n' +
      `${body.join('\r\n')}\r\n</Workbook>\r\n`,
  );
}

/** A .zip with the given entries (e.g. the XML of the extraction), as the user would compress it. */
export function zipFiles(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { mtime: new Date(2026, 0, 1) });
}
