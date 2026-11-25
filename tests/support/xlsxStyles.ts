/**
 * Test-only reader of the cells, styles and sheet settings of a workbook: values (shared or inline strings, numbers,
 * booleans), the resolved style of each cell (font, fill, number format, alignment), row heights and outline levels,
 * column widths, outline, margins and page setup. Reads workbooks written by the tool and by Excel or other libraries
 * (attributes in any order, shared strings with rich text), so it can compare a generated workbook with a reference
 * one (docs/REGRAS_PLANO_DE_CONTAS.md, section 9.4).
 */
import { strFromU8, unzipSync } from 'fflate';

export interface ResolvedStyle {
  bold: boolean;
  italic: boolean;
  size: number | null;
  fontName: string | null;
  /** RRGGBB, or null for the automatic colour (absent, theme 1 or black). */
  color: string | null;
  /** RRGGBB of a solid fill, or null. */
  fill: string | null;
  numFmt: string;
  horizontal: string | null;
  vertical: string | null;
  indent: number;
  wrap: boolean;
}

export type CellValue = string | number | boolean | null;

export interface SheetData {
  name: string;
  cells: Map<string, { value: CellValue; style: ResolvedStyle }>;
  rows: Map<number, { height: number | null; outlineLevel: number }>;
  /** Width of each column (1-based index). */
  widths: Map<number, number>;
  summaryBelow: boolean;
  outlineLevelRow: number;
  margins: Record<string, number>;
  pageSetup: Record<string, string>;
  fitToPage: boolean;
  frozen: boolean;
  autoFilter: boolean;
  maxRow: number;
}

export interface WorkbookData {
  sheets: SheetData[];
  /** Font of the Normal style (font 0). */
  defaultFont: { name: string | null; size: number | null };
}

const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  14: 'builtin:14 (data curta)',
  22: 'm/d/yy h:mm',
  49: '@',
};

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** Attributes of the first tag of `xml` (prefixes kept: "r:id"). */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const head = /^<[^>]*>/.exec(tag)?.[0] ?? tag;
  for (const m of head.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = decode(m[2]!);
  return out;
}

/** Elements `<name ...>...</name>` or `<name .../>` (without the namespace prefix of the name). */
function elements(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${name}(?=[\\s/>])[^>]*?(?:/>|>[\\s\\S]*?</(?:\\w+:)?${name}>)`, 'g');
  return [...xml.matchAll(re)].map((m) => m[0]);
}

const first = (xml: string, name: string) => elements(xml, name)[0];

function color(xml: string | undefined): string | null {
  if (!xml) return null;
  const a = attrs(xml);
  if (a.rgb) {
    const rgb = a.rgb.toUpperCase().slice(-6);
    return rgb === '000000' ? null : rgb;
  }
  if (a.theme !== undefined) return a.theme === '1' ? null : `theme:${a.theme}`;
  if (a.indexed !== undefined) return a.indexed === '64' || a.indexed === '8' ? null : `indexed:${a.indexed}`;
  return null;
}

const colIndex = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

export function readWorkbookData(bytes: Uint8Array): WorkbookData {
  const files = unzipSync(bytes);
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');

  // Styles.
  const stylesXml = text('xl/styles.xml');
  const numFmts = new Map<number, string>(Object.entries(BUILTIN_FORMATS).map(([k, v]) => [Number(k), v]));
  for (const f of elements(first(stylesXml, 'numFmts') ?? '', 'numFmt')) {
    const a = attrs(f);
    numFmts.set(Number(a.numFmtId), a.formatCode ?? '');
  }
  const fonts = elements(first(stylesXml, 'fonts') ?? '', 'font').map((f) => {
    const flag = (n: string) => {
      const el = first(f, n);
      return el !== undefined && attrs(el).val !== '0' && attrs(el).val !== 'false';
    };
    const sz = first(f, 'sz');
    const name = first(f, 'name');
    return { bold: flag('b'), italic: flag('i'), size: sz ? Number(attrs(sz).val) : null, name: name ? (attrs(name).val ?? null) : null, color: color(first(f, 'color')) };
  });
  const fills = elements(first(stylesXml, 'fills') ?? '', 'fill').map((f) => {
    const p = first(f, 'patternFill');
    if (!p || attrs(p).patternType !== 'solid') return null;
    return color(first(p, 'fgColor')) ?? '000000';
  });
  const xfs = elements(first(stylesXml, 'cellXfs') ?? '', 'xf').map((x) => {
    const a = attrs(x);
    const al = first(x, 'alignment');
    const g = al ? attrs(al) : {};
    const font = fonts[Number(a.fontId ?? 0)] ?? fonts[0]!;
    return {
      bold: font.bold,
      italic: font.italic,
      size: font.size,
      fontName: font.name,
      color: font.color,
      fill: fills[Number(a.fillId ?? 0)] ?? null,
      numFmt: numFmts.get(Number(a.numFmtId ?? 0)) ?? `id:${a.numFmtId}`,
      horizontal: g.horizontal && g.horizontal !== 'general' ? g.horizontal : null,
      vertical: g.vertical && g.vertical !== 'bottom' ? g.vertical : null,
      indent: Number(g.indent ?? 0),
      wrap: g.wrapText === '1' || g.wrapText === 'true',
    } satisfies ResolvedStyle;
  });

  // Shared strings (rich text: the runs joined).
  const shared = elements(text('xl/sharedStrings.xml'), 'si').map((si) => elements(si, 't').map((t) => decode(t.replace(/^<[^>]*>/, '').replace(/<\/(?:\w+:)?t>$/, ''))).join(''));

  // Sheets, through the relationships of the workbook.
  const workbookXml = text('xl/workbook.xml');
  const rels = new Map(elements(text('xl/_rels/workbook.xml.rels'), 'Relationship').map((r) => [attrs(r).Id!, attrs(r).Target!]));
  const sheets = elements(workbookXml, 'sheet').map((s): SheetData => {
    const a = attrs(s);
    const target = rels.get(a['r:id']!) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = text(path);
    const widths = new Map<number, number>();
    for (const c of elements(first(xml, 'cols') ?? '', 'col')) {
      const ca = attrs(c);
      for (let i = Number(ca.min); i <= Number(ca.max); i++) widths.set(i, Number(ca.width));
    }
    const colStyle = new Map<number, number>();
    for (const c of elements(first(xml, 'cols') ?? '', 'col')) {
      const ca = attrs(c);
      if (ca.style !== undefined) for (let i = Number(ca.min); i <= Number(ca.max); i++) colStyle.set(i, Number(ca.style));
    }
    const rows = new Map<number, { height: number | null; outlineLevel: number }>();
    const cells = new Map<string, { value: CellValue; style: ResolvedStyle }>();
    let maxRow = 0;
    for (const row of elements(xml, 'row')) {
      const ra = attrs(row);
      const r = Number(ra.r);
      maxRow = Math.max(maxRow, r);
      rows.set(r, { height: ra.ht !== undefined ? Number(ra.ht) : null, outlineLevel: Number(ra.outlineLevel ?? 0) });
      const rowStyle = ra.customFormat === '1' && ra.s !== undefined ? Number(ra.s) : null;
      const body = row.replace(/^<[^>]*>/, '');
      for (const c of elements(body, 'c')) {
        const ca = attrs(c);
        const ref = ca.r!;
        const col = colIndex(/^[A-Z]+/.exec(ref)![0]);
        const s = ca.s !== undefined ? Number(ca.s) : (rowStyle ?? colStyle.get(col) ?? 0);
        const v = first(c, 'v');
        const raw = v ? decode(v.replace(/^<[^>]*>/, '').replace(/<\/(?:\w+:)?v>$/, '')) : null;
        let value: CellValue = null;
        if (ca.t === 's') value = raw === null ? null : (shared[Number(raw)] ?? null);
        else if (ca.t === 'inlineStr') value = elements(first(c, 'is') ?? '', 't').map((t) => decode(t.replace(/^<[^>]*>/, '').replace(/<\/(?:\w+:)?t>$/, ''))).join('');
        else if (ca.t === 'str') value = raw;
        else if (ca.t === 'b') value = raw === '1';
        else if (raw !== null) value = Number(raw);
        cells.set(ref, { value, style: xfs[s] ?? xfs[0]! });
      }
    }
    const outlinePr = first(first(xml, 'sheetPr') ?? '', 'outlinePr');
    const format = first(xml, 'sheetFormatPr');
    const margins = Object.fromEntries(Object.entries(attrs(first(xml, 'pageMargins') ?? '<x/>')).map(([k, v]) => [k, Number(v)]));
    return {
      name: a.name!,
      cells,
      rows,
      widths,
      summaryBelow: outlinePr ? attrs(outlinePr).summaryBelow !== '0' && attrs(outlinePr).summaryBelow !== 'false' : true,
      outlineLevelRow: format ? Number(attrs(format).outlineLevelRow ?? 0) : 0,
      margins,
      pageSetup: attrs(first(xml, 'pageSetup') ?? '<x/>'),
      fitToPage: (() => {
        const p = first(first(xml, 'sheetPr') ?? '', 'pageSetUpPr');
        return p !== undefined && (attrs(p).fitToPage === '1' || attrs(p).fitToPage === 'true');
      })(),
      frozen: /<pane[^>]*state="frozen"/.test(xml),
      autoFilter: /<autoFilter\b/.test(xml),
      maxRow,
    };
  });

  const font0 = fonts[0];
  return { sheets, defaultFont: { name: font0?.name ?? null, size: font0?.size ?? null } };
}

/** The resolved style of an empty cell (the Normal style). */
export function defaultStyleOf(data: WorkbookData): ResolvedStyle {
  return {
    bold: false,
    italic: false,
    size: data.defaultFont.size,
    fontName: data.defaultFont.name,
    color: null,
    fill: null,
    numFmt: 'General',
    horizontal: null,
    vertical: null,
    indent: 0,
    wrap: false,
  };
}
