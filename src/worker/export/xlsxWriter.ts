/**
 * Streaming XLSX writer over fflate (docs/ARQUITETURA.md, section 5). Sheets are written row by row into
 * deflated ZIP entries: strings inline, formulas without cached values (the workbook recalculates on open),
 * a style registry, defined names, data validation, conditional formats, frozen panes, autofilter, column
 * widths, internal hyperlinks and merges checked against overlap (invariant 10). ZIP timestamps are fixed,
 * so the same content always gives the same bytes.
 */
import { Zip, ZipDeflate } from 'fflate';
import { INVALID_TIME } from '../../shared/dates';

export type CellValue = string | number | boolean | null | undefined;
export interface Cell {
  v?: CellValue;
  /** Formula without the leading "=" (English function names, "," separators). */
  f?: string;
  /** Style id from the registry. */
  s?: number;
}
export type CellInput = CellValue | Cell;

const EXCEL_SERIAL_2000 = 36526;
/** Marker for date cells: the writer applies the date format and tracks the smallest date (invariant 9). */
const DATE = Symbol('date');
interface DateCell extends Cell {
  [DATE]: 'date' | 'datetime';
}

/** Day number (days since 2000-01-01) → date cell; INVALID_TIME → empty cell, never zero. */
export function dateCell(day: number, s?: number): Cell | null {
  if (day === INVALID_TIME || !Number.isFinite(day)) return null;
  return { v: day + EXCEL_SERIAL_2000, [DATE]: 'date', ...(s !== undefined && { s }) } as DateCell;
}

/** Seconds since 2000-01-01 → date-time cell; INVALID_TIME → empty cell. */
export function dateTimeCell(seconds: number, s?: number): Cell | null {
  if (seconds === INVALID_TIME || !Number.isFinite(seconds)) return null;
  return { v: EXCEL_SERIAL_2000 + seconds / 86400, [DATE]: 'datetime', ...(s !== undefined && { s }) } as DateCell;
}

export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const escapeText = (s: string) =>
  s
    // A literal "_xHHHH_" would be read as an escape: protect it first.
    .replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ── Styles ──

export interface StyleSpec {
  font?: { bold?: boolean; italic?: boolean; underline?: boolean; size?: number; color?: string; name?: 'Aptos' | 'Aptos Display' };
  /** ARGB, e.g. "FFFFF2CC". */
  fill?: string;
  border?: 'none' | 'bottom' | 'top' | 'box' | 'thinBottom';
  borderColor?: string;
  numFmt?: string;
  align?: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'center' | 'bottom'; wrap?: boolean; indent?: number };
}

export interface DxfSpec {
  fill?: string;
  font?: { bold?: boolean; color?: string };
}

class StyleRegistry {
  private readonly fonts: string[] = ['<font><sz val="11"/><name val="Aptos"/></font>'];
  private readonly fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private readonly borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private readonly numFmts: string[] = [];
  private readonly xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private readonly byKey = new Map<string, number>([['{}', 0]]);
  private readonly dxfs: string[] = [];
  private readonly dxfByKey = new Map<string, number>();

  private index(list: string[], xml: string): number {
    const i = list.indexOf(xml);
    if (i >= 0) return i;
    list.push(xml);
    return list.length - 1;
  }

  private fontXml(f: NonNullable<StyleSpec['font']>): string {
    return (
      '<font>' +
      (f.bold ? '<b/>' : '') +
      (f.italic ? '<i/>' : '') +
      (f.underline ? '<u/>' : '') +
      `<sz val="${f.size ?? 11}"/>` +
      (f.color ? `<color rgb="${f.color}"/>` : '') +
      `<name val="${f.name ?? 'Aptos'}"/></font>`
    );
  }

  style(spec: StyleSpec): number {
    const key = JSON.stringify(spec);
    const known = this.byKey.get(key);
    if (known !== undefined) return known;
    const fontId = spec.font ? this.index(this.fonts, this.fontXml(spec.font)) : 0;
    const fillId = spec.fill
      ? this.index(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${spec.fill}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const color = spec.borderColor ?? 'FFBFBFBF';
    const side = (name: string, on: boolean, weight = 'thin') => (on ? `<${name} style="${weight}"><color rgb="${color}"/></${name}>` : `<${name}/>`);
    const b = spec.border ?? 'none';
    const borderId =
      b === 'none'
        ? 0
        : this.index(
            this.borders,
            '<border>' +
              side('left', b === 'box') +
              side('right', b === 'box') +
              side('top', b === 'box' || b === 'top') +
              side('bottom', b === 'box' || b === 'bottom' || b === 'thinBottom', b === 'bottom' ? 'medium' : 'thin') +
              '<diagonal/></border>',
          );
    let numFmtId = 0;
    if (spec.numFmt) {
      const i = this.numFmts.indexOf(spec.numFmt);
      numFmtId = 164 + (i >= 0 ? i : this.numFmts.push(spec.numFmt) - 1);
    }
    const a = spec.align;
    const align = a
      ? `<alignment${a.h ? ` horizontal="${a.h}"` : ''}${a.v ? ` vertical="${a.v}"` : ''}${a.wrap ? ' wrapText="1"' : ''}${a.indent ? ` indent="${a.indent}"` : ''}/>`
      : '';
    const xf =
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      (numFmtId ? ' applyNumberFormat="1"' : '') +
      (fontId ? ' applyFont="1"' : '') +
      (fillId ? ' applyFill="1"' : '') +
      (borderId ? ' applyBorder="1"' : '') +
      (align ? ` applyAlignment="1">${align}</xf>` : '/>');
    this.xfs.push(xf);
    const id = this.xfs.length - 1;
    this.byKey.set(key, id);
    return id;
  }

  dxf(spec: DxfSpec): number {
    const key = JSON.stringify(spec);
    const known = this.dxfByKey.get(key);
    if (known !== undefined) return known;
    const font = spec.font ? `<font>${spec.font.bold ? '<b/>' : ''}${spec.font.color ? `<color rgb="${spec.font.color}"/>` : ''}</font>` : '';
    const fill = spec.fill ? `<fill><patternFill patternType="solid"><bgColor rgb="${spec.fill}"/></patternFill></fill>` : '';
    this.dxfs.push(`<dxf>${font}${fill}</dxf>`);
    this.dxfByKey.set(key, this.dxfs.length - 1);
    return this.dxfs.length - 1;
  }

  xml(): string {
    const numFmts = this.numFmts.length
      ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${escapeAttr(f)}"/>`).join('')}</numFmts>`
      : '';
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      numFmts +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs>` +
      '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>'
    );
  }
}

// ── Sheets ──

export interface SheetOptions {
  columns?: { width: number; hidden?: boolean }[];
  freeze?: { rows: number; cols: number };
  autoFilter?: string;
  showGridLines?: boolean;
  tabColor?: string;
  zoom?: number;
}

export interface Validation {
  sqref: string;
  type: 'list' | 'date';
  formula1: string;
  formula2?: string;
  prompt?: string;
}

type Range = [r1: number, c1: number, r2: number, c2: number];

function parseRange(ref: string): Range {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
  if (!m) throw new Error(`Intervalo inválido: ${ref}`);
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const r1 = Number(m[2]);
  const c1 = col(m[1]!);
  const r2 = m[4] ? Number(m[4]) : r1;
  const c2 = m[3] ? col(m[3]) : c1;
  return [Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)];
}

const FLUSH_AT = 1 << 16;

/** Rows per worksheet in Excel. */
const MAX_ROWS = 1048576;

export class SheetWriter {
  private rowNumber = 0;
  private buffer = '';
  private readonly merges: Range[] = [];
  private readonly mergeRefs: string[] = [];
  private readonly validations: Validation[] = [];
  private readonly conditionals: string[] = [];
  private readonly links: string[] = [];
  private ended = false;

  constructor(
    private readonly writer: XlsxWriter,
    private readonly entry: ZipDeflate,
    private readonly options: SheetOptions,
  ) {
    const views =
      `<sheetViews><sheetView workbookViewId="0"${options.showGridLines === false ? ' showGridLines="0"' : ''}${options.zoom ? ` zoomScale="${options.zoom}"` : ''}>` +
      this.paneXml() +
      '</sheetView></sheetViews>';
    const cols = options.columns?.length
      ? `<cols>${options.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"${c.hidden ? ' hidden="1"' : ''}/>`).join('')}</cols>`
      : '';
    this.write(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        (options.tabColor ? `<sheetPr><tabColor rgb="${options.tabColor}"/></sheetPr>` : '') +
        views +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        cols +
        '<sheetData>',
    );
  }

  private paneXml(): string {
    const f = this.options.freeze;
    if (!f || (f.rows === 0 && f.cols === 0)) return '';
    const topLeft = `${colName(f.cols)}${f.rows + 1}`;
    const pane = f.rows && f.cols ? 'bottomRight' : f.rows ? 'bottomLeft' : 'topRight';
    return `<pane${f.cols ? ` xSplit="${f.cols}"` : ''}${f.rows ? ` ySplit="${f.rows}"` : ''} topLeftCell="${topLeft}" activePane="${pane}" state="frozen"/>`;
  }

  private write(s: string): void {
    this.buffer += s;
    if (this.buffer.length >= FLUSH_AT) this.flush(false);
  }

  private flush(final: boolean): void {
    this.entry.push(this.writer.encoder.encode(this.buffer), final);
    this.buffer = '';
  }

  /** Next row number (1-based) that row() will write. */
  get nextRow(): number {
    return this.rowNumber + 1;
  }

  /** Writes a row; returns its number. Null/undefined cells are skipped. */
  row(cells: CellInput[], opts: { height?: number; style?: number } = {}): number {
    const r = ++this.rowNumber;
    if (r > MAX_ROWS) throw new RangeError('Uma aba da planilha passaria do limite de 1.048.576 linhas do Excel.');
    let xml = `<row r="${r}"${opts.height ? ` ht="${opts.height}" customHeight="1"` : ''}>`;
    for (let c = 0; c < cells.length; c++) {
      const input = cells[c];
      if (input === null || input === undefined) continue;
      const cell: Cell = typeof input === 'object' ? input : { v: input };
      const ref = `${colName(c)}${r}`;
      let s = cell.s ?? opts.style;
      const kind = (cell as Partial<DateCell>)[DATE];
      if (kind) {
        s ??= kind === 'date' ? this.writer.dateStyle : this.writer.dateTimeStyle;
        this.writer.noteDate(cell.v as number);
      }
      const sAttr = s ? ` s="${s}"` : '';
      if (cell.f !== undefined) {
        xml += `<c r="${ref}"${sAttr}><f>${escapeText(cell.f)}</f></c>`;
      } else if (typeof cell.v === 'number') {
        if (Number.isFinite(cell.v)) xml += `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`;
        else if (sAttr) xml += `<c r="${ref}"${sAttr}/>`;
      } else if (typeof cell.v === 'boolean') {
        xml += `<c r="${ref}"${sAttr} t="b"><v>${cell.v ? 1 : 0}</v></c>`;
      } else if (typeof cell.v === 'string' && cell.v !== '') {
        xml += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escapeText(cell.v)}</t></is></c>`;
      } else if (sAttr) {
        xml += `<c r="${ref}"${sAttr}/>`;
      }
    }
    this.write(xml + '</row>');
    return r;
  }

  /** Leaves empty rows. */
  skip(n = 1): void {
    this.rowNumber += n;
  }

  merge(ref: string): void {
    const range = parseRange(ref);
    for (const m of this.merges) {
      if (range[0] <= m[2] && m[0] <= range[2] && range[1] <= m[3] && m[1] <= range[3]) {
        throw new Error(`Mesclagem sobreposta: ${ref} cruza outra mesclagem na mesma aba.`);
      }
    }
    this.merges.push(range);
    this.mergeRefs.push(ref);
  }

  validation(v: Validation): void {
    this.validations.push(v);
  }

  conditional(rule: { sqref: string; formula: string; style: DxfSpec }): void {
    const dxfId = this.writer.styles.dxf(rule.style);
    this.conditionals.push(
      `<conditionalFormatting sqref="${rule.sqref}"><cfRule type="expression" dxfId="${dxfId}" priority="${this.writer.nextPriority()}">` +
        `<formula>${escapeText(rule.formula)}</formula></cfRule></conditionalFormatting>`,
    );
  }

  link(l: { ref: string; location: string; display?: string }): void {
    this.links.push(`<hyperlink ref="${l.ref}" location="${escapeAttr(l.location)}" display="${escapeAttr(l.display ?? l.location)}"/>`);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    let tail = '</sheetData>';
    if (this.options.autoFilter) tail += `<autoFilter ref="${this.options.autoFilter}"/>`;
    if (this.mergeRefs.length) tail += `<mergeCells count="${this.mergeRefs.length}">${this.mergeRefs.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>`;
    tail += this.conditionals.join('');
    if (this.validations.length) {
      tail +=
        `<dataValidations count="${this.validations.length}">` +
        this.validations
          .map(
            (v) =>
              `<dataValidation type="${v.type}"${v.type === 'date' ? ' operator="between"' : ''} allowBlank="1" showInputMessage="1" showErrorMessage="1"` +
              `${v.prompt ? ` promptTitle="" prompt="${escapeAttr(v.prompt)}"` : ''} sqref="${v.sqref}">` +
              `<formula1>${escapeText(v.formula1)}</formula1>${v.formula2 ? `<formula2>${escapeText(v.formula2)}</formula2>` : ''}</dataValidation>`,
          )
          .join('') +
        '</dataValidations>';
    }
    if (this.links.length) tail += `<hyperlinks>${this.links.join('')}</hyperlinks>`;
    tail += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>';
    this.buffer += tail;
    this.flush(true);
    this.writer.sheetEnded();
  }
}

// ── Workbook ──

const ZIP_MTIME = new Date(2000, 0, 1, 12, 0, 0);

export class XlsxWriter {
  readonly styles = new StyleRegistry();
  readonly encoder = new TextEncoder();
  readonly dateStyle: number;
  readonly dateTimeStyle: number;
  /** Smallest date serial written (invariant 9); null when no date was written. */
  minDateSerial: number | null = null;

  private readonly chunks: Uint8Array[] = [];
  private readonly zip: Zip;
  private readonly sheets: string[] = [];
  private readonly names: { name: string; ref: string; hidden?: boolean }[] = [];
  private open: SheetWriter | null = null;
  private priority = 0;
  private done: Promise<Blob>;
  private resolveDone!: (b: Blob) => void;
  private rejectDone!: (e: Error) => void;

  constructor() {
    this.done = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.zip = new Zip((err, chunk, final) => {
      if (err) return this.rejectDone(err);
      this.chunks.push(chunk);
      if (final) this.resolveDone(new Blob(this.chunks as Uint8Array<ArrayBuffer>[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    });
    this.dateStyle = this.styles.style({ numFmt: 'dd/mm/yyyy', align: { h: 'center' } });
    this.dateTimeStyle = this.styles.style({ numFmt: 'dd/mm/yyyy hh:mm:ss', align: { h: 'center' } });
  }

  noteDate(serial: number): void {
    if (this.minDateSerial === null || serial < this.minDateSerial) this.minDateSerial = serial;
  }

  nextPriority(): number {
    return ++this.priority;
  }

  private entry(name: string): ZipDeflate {
    const file = new ZipDeflate(name, { level: 6 });
    file.mtime = ZIP_MTIME;
    this.zip.add(file);
    return file;
  }

  private text(name: string, content: string): void {
    this.entry(name).push(this.encoder.encode(content), true);
  }

  addSheet(name: string, options: SheetOptions = {}): SheetWriter {
    if (this.open) throw new Error('Feche a aba anterior antes de abrir outra.');
    if (name.length > 31 || /[\\/?*[\]:]/.test(name)) throw new Error(`Nome de aba inválido para o Excel: ${name}`);
    this.sheets.push(name);
    this.open = new SheetWriter(this, this.entry(`xl/worksheets/sheet${this.sheets.length}.xml`), options);
    return this.open;
  }

  sheetEnded(): void {
    this.open = null;
  }

  defineName(name: string, ref: string, hidden = false): void {
    this.names.push({ name, ref, hidden });
  }

  async finish(): Promise<Blob> {
    this.open?.end();
    const n = this.sheets.length;
    this.text(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        Array.from(
          { length: n },
          (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        ).join('') +
        '</Types>',
    );
    this.text(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    );
    this.text(
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
        this.sheets.map((s, i) => `<sheet name="${escapeAttr(s)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        (this.names.length
          ? `<definedNames>${this.names.map((d) => `<definedName name="${d.name}"${d.hidden ? ' hidden="1"' : ''}>${escapeText(d.ref)}</definedName>`).join('')}</definedNames>`
          : '') +
        '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
    );
    this.text(
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        Array.from(
          { length: n },
          (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        ).join('') +
        `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    );
    this.text('xl/styles.xml', this.styles.xml());
    this.zip.end();
    return this.done;
  }
}
