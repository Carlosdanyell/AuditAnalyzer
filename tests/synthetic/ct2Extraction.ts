/**
 * Synthetic extraction of the CT2 table (accounting entries) with the layout of the real one (docs/REGRAS_CT2_INTEGRIDADE.md,
 * section 2): one sheet, the table title in row 1, a blank row, the column titles in row 3 (with spaces at the right)
 * and ~80 columns. Codes can be text or numbers, amounts numbers or pt-BR text, dates Excel serials or dd/mm/aaaa.
 * Independent of the CFGR700 generators (their bytes are recorded in tests/synthetic/expected). No real data.
 */
import { zipSync } from 'fflate';
import { CT2_FIELDS, ct2DefaultConfig, type Ct2Field } from '../../src/config/ct2IntegritySchema';
import { normalizeTitle } from '../../src/shared/titles';

export type Ct2Value = string | number | null;

/** One row of the extraction: the mapped fields (by logical name) and, optionally, other columns (by title). */
export interface Ct2LineRow {
  fields: Partial<Record<Ct2Field, Ct2Value>>;
  extra?: Record<string, Ct2Value>;
}
export type Ct2Row = Ct2LineRow | { gap: number } | { empty: true };

const config = ct2DefaultConfig();

/** Titles of the other columns of a CT2 extraction (generic field names of the table, no data). */
const OTHER_TITLES = [
  'Filial',
  'C Custo Deb',
  'C Custo Crd',
  'Item Debito',
  'Item Credito',
  'Cl Vlr Deb',
  'Cl Vlr Crd',
  'Valor Moeda2',
  'Valor Moeda3',
  'Valor Moeda4',
  'Valor Moeda5',
  'Crit Conv',
  'Dt Conversao',
  'Seq Lancto',
  'Seq Hist',
  'Hist Aglut',
  'Lote Origem',
  'Doc Origem',
  'Data Digit',
  'Conferido',
  ...Array.from({ length: 40 }, (_, i) => `Campo Livre ${String(i + 1).padStart(2, '0')}`),
];

/** Titles as written in row 3: padded with spaces to 12 characters, as the system writes them. */
export const CT2_COLUMNS: readonly string[] = [...CT2_FIELDS.map((f) => config.columns[f].title), ...OTHER_TITLES].map((t) => t.padEnd(12));

/** Field of a column title (title or alias of the default configuration). */
const FIELD_OF = new Map<string, Ct2Field>(
  CT2_FIELDS.flatMap((f) => [config.columns[f].title, ...config.columns[f].aliases].map((t) => [normalizeTitle(t), f] as const)),
);

/** A balanced, ordinary line; `fields` and `extra` override (null = empty cell). */
export function ct2Line(fields: Partial<Record<Ct2Field, Ct2Value>> = {}, extra: Record<string, Ct2Value> = {}): Ct2LineRow {
  return {
    fields: {
      date: '15/09/2026',
      batch: '000001',
      subBatch: '001',
      document: '000001',
      line: '001',
      balanceType: '1',
      currency: '01',
      entryType: 'Partida Dobrada',
      debitAccount: '11101001',
      creditAccount: '21101001',
      amount: 100,
      history: 'LANCAMENTO SINTETICO',
      amountCurrency1: 100,
      routine: 'CTBA102',
      standardEntry: '',
      ctkSequence: '',
      manual: '1',
      origin: '',
      companyOrigin: '01',
      branchOrigin: '01',
      ...fields,
    },
    extra: { Filial: '01', ...extra },
  };
}

export interface Ct2ExtractionOptions {
  rows: Ct2Row[];
  sheetName?: string;
  /** Row 1; null leaves it out (the header then still sits in `headerRow`). */
  title?: string | null;
  /** Row of the column titles (3 in the real extraction). */
  headerRow?: number;
  /** Column titles, in order (default: CT2_COLUMNS). Titles not mapped to a field take values from `extra`. */
  columns?: readonly string[];
  inlineStrings?: boolean;
  omitDimension?: boolean;
  date1904?: boolean;
  /** Other sheets, written before the extraction sheet: raw rows from row 1. */
  extraSheets?: Record<string, Ct2Value[][]>;
  /** Store the entries without compression (method 0). */
  stored?: boolean;
}

/** Spreadsheet column name of a 0-based index (0 = A, 26 = AA). */
export function columnRef(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class Strings {
  readonly list: string[] = [];
  private readonly index = new Map<string, number>();
  constructor(private readonly inline: boolean) {}
  cell(ref: string, value: Ct2Value): string {
    if (value === null || value === '') return '';
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
    if (this.inline) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    let i = this.index.get(value);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(value);
      this.index.set(value, i);
    }
    return `<c r="${ref}" t="s"><v>${i}</v></c>`;
  }
}

function sheetXml(rows: { r: number; cells: Ct2Value[] | null }[], width: number, strings: Strings, omitDimension: boolean): string {
  const last = rows.length > 0 ? rows[rows.length - 1]!.r : 1;
  const body = rows
    .map(({ r, cells }) =>
      cells === null ? `<row r="${r}"/>` : `<row r="${r}">${cells.map((v, c) => strings.cell(`${columnRef(c)}${r}`, v)).join('')}</row>`,
    )
    .join('');
  const dimension = omitDimension ? '' : `<dimension ref="A1:${columnRef(width - 1)}${last}"/>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension}<sheetData>${body}</sheetData></worksheet>`
  );
}

export function buildCt2Extraction(o: Ct2ExtractionOptions): Uint8Array {
  const columns = o.columns ?? CT2_COLUMNS;
  const headerRow = o.headerRow ?? 3;
  const strings = new Strings(o.inlineStrings ?? false);
  const enc = (s: string) => new TextEncoder().encode(s);

  const rows: { r: number; cells: Ct2Value[] | null }[] = [];
  const title = o.title === undefined ? 'CT2 - Lancamentos Contabeis' : o.title;
  if (title !== null && headerRow > 1) rows.push({ r: 1, cells: [title] });
  rows.push({ r: headerRow, cells: [...columns] });
  let r = headerRow;
  for (const row of o.rows) {
    if ('gap' in row) {
      r += row.gap;
      continue;
    }
    r++;
    if ('empty' in row) {
      rows.push({ r, cells: null });
      continue;
    }
    rows.push({
      r,
      cells: columns.map((t) => {
        const field = FIELD_OF.get(normalizeTitle(t));
        const value = field !== undefined ? row.fields[field] : row.extra?.[normalizeTitle(t)];
        return value ?? null;
      }),
    });
  }

  const extra = Object.entries(o.extraSheets ?? {});
  const sheets = [...extra.map(([name]) => name), o.sheetName ?? 'SCACKST0.XML'];
  const sheetFiles = [
    ...extra.map(([, cells]) => sheetXml(cells.map((c, i) => ({ r: i + 1, cells: c })), Math.max(1, ...cells.map((c) => c.length)), strings, false)),
    sheetXml(rows, columns.length, strings, o.omitDimension ?? false),
  ];

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    (o.date1904 ? '<workbookPr date1904="1"/>' : '') +
    '<sheets>' +
    sheets.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';
  const sst = strings.list.length > 0;
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    (sst ? `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` : '') +
    '</Relationships>';
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': enc('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': enc(workbook),
    'xl/_rels/workbook.xml.rels': enc(rels),
  };
  sheetFiles.forEach((xml, i) => (entries[`xl/worksheets/sheet${i + 1}.xml`] = enc(xml)));
  if (sst) {
    entries['xl/sharedStrings.xml'] = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.list.length}" uniqueCount="${strings.list.length}">` +
        strings.list.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('') +
        '</sst>',
    );
  }
  return zipSync(entries, { mtime: new Date(2026, 0, 1), ...(o.stored && { level: 0 as const }) });
}

export const ct2Blob = (o: Ct2ExtractionOptions) => new Blob([buildCt2Extraction(o) as Uint8Array<ArrayBuffer>]);
