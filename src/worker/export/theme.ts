/**
 * Visual standard of the exported workpaper, after the reference workpaper used by the audit team: navy headers
 * with 9-pt white text, thin grid, negative numbers in parentheses and zero as a dash, 10-pt Summary with section
 * bars, totals on light blue and notes in grey. Column kinds give each data cell its style.
 */
import type { StyleSpec } from './xlsxWriter';

interface Registry {
  style(spec: StyleSpec): number;
}

export const COLORS = {
  navy: 'FF1F3864',
  section: 'FF2E5C8A',
  light: 'FFD9E2F3',
  grid: 'FFBFBFBF',
  gridLight: 'FFD9D9D9',
  white: 'FFFFFFFF',
  muted: 'FF595959',
  faint: 'FF8C8C8C',
  inputFill: 'FFFFF9E3',
  inputFont: 'FF7F6000',
  inputBorder: 'FFBF8F00',
  edit: 'FFBF8F00',
  helper: 'FF7F7F7F',
  okFill: 'FFE2EFDA',
  okFont: 'FF375623',
  badFill: 'FFFCE4D6',
  badFont: 'FFC00000',
  warnFill: 'FFFFF2CC',
  warnFont: 'FF7F6000',
  orange: 'FFC65911',
  weekend: 'FFF2F2F2',
};

export const FORMATS = {
  int: '#,##0;\\(#,##0\\);\\-',
  intSummary: '#,##0;\\(#,##0\\);\\—',
  money: '#,##0.00;\\(#,##0.00\\);\\-',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm:ss',
  moneySummary: '#,##0.00;\\(#,##0.00\\);\\—',
  pct: '0.0%',
  id: '0',
};

/** Content of a data column: gives the cell style (alignment, number format, wrapping). */
export type ColKind = 'text' | 'wrap' | 'int' | 'id' | 'money' | 'date' | 'datetime' | 'center';
/** data = values from the log; edit = typed by the user; helper = computed for the Summary filter. */
export type ColGroup = 'data' | 'edit' | 'helper';

export function createTheme(S: Registry) {
  const grid = { border: 'box' as const, borderColor: COLORS.gridLight };
  const cell9 = (align: StyleSpec['align'], numFmt?: string) =>
    S.style({ font: { size: 9 }, ...grid, align: { v: 'center', ...align }, ...(numFmt && { numFmt }) });
  const head = (fill: string) =>
    S.style({ fill, font: { bold: true, size: 9, color: COLORS.white }, border: 'box', borderColor: COLORS.white, align: { h: 'center', v: 'center', wrap: true } });

  const summaryGrid = { border: 'box' as const, borderColor: COLORS.grid };
  const cell10 = (spec: StyleSpec) => S.style({ ...summaryGrid, ...spec, font: { size: 10, ...spec.font }, align: { v: 'center', ...spec.align } });
  const total = (spec: StyleSpec) => cell10({ ...spec, fill: COLORS.light, font: { bold: true, ...spec.font } });

  return {
    /** Data sheets, by column kind. */
    kind: {
      text: cell9({}),
      wrap: cell9({ v: 'top', wrap: true }),
      int: cell9({ h: 'right' }, FORMATS.int),
      id: cell9({ h: 'center' }, FORMATS.id),
      money: cell9({ h: 'right' }, FORMATS.money),
      date: cell9({ h: 'center' }, FORMATS.date),
      datetime: cell9({ h: 'center' }, FORMATS.datetime),
      center: cell9({ h: 'center' }),
    } satisfies Record<ColKind, number>,
    head: { data: head(COLORS.navy), edit: head(COLORS.edit), helper: head(COLORS.helper) } satisfies Record<ColGroup, number>,
    headSummary: head(COLORS.navy),

    // Summary and small tables (10 pt).
    title: S.style({ font: { name: 'Aptos Display', size: 18, bold: true, color: COLORS.navy }, align: { v: 'center' } }),
    subtitle: S.style({ font: { size: 9, color: COLORS.muted } }),
    meta: S.style({ font: { size: 9, italic: true, color: COLORS.muted } }),
    ok: S.style({ fill: COLORS.okFill, font: { bold: true, size: 10, color: COLORS.okFont }, align: { v: 'center', wrap: true, indent: 1 } }),
    fail: S.style({ fill: COLORS.badFill, font: { bold: true, size: 10, color: COLORS.badFont }, align: { v: 'center', wrap: true, indent: 1 } }),
    section: S.style({ fill: COLORS.section, font: { name: 'Aptos Display', size: 11, bold: true, color: COLORS.white }, align: { v: 'center', indent: 1 } }),
    h2: S.style({ font: { name: 'Aptos Display', size: 12, bold: true, color: COLORS.navy }, align: { v: 'center' } }),
    note: S.style({ font: { size: 9, color: COLORS.muted }, align: { v: 'top', wrap: true } }),
    label: cell10({ align: { h: 'left', wrap: true, indent: 1 } }),
    int: cell10({ numFmt: FORMATS.intSummary, align: { h: 'right' } }),
    money: cell10({ numFmt: FORMATS.moneySummary, align: { h: 'right' } }),
    pct: cell10({ numFmt: FORMATS.pct, align: { h: 'right' } }),
    text: cell10({ align: { h: 'left', wrap: true, indent: 1 } }),
    center: cell10({ align: { h: 'center' } }),
    count: cell10({ numFmt: FORMATS.intSummary, font: { bold: true }, align: { h: 'center' } }),
    date: cell10({ numFmt: FORMATS.date, align: { h: 'center' } }),
    datetime: cell10({ numFmt: FORMATS.datetime, align: { h: 'center' } }),
    totalLabel: total({ align: { h: 'left', indent: 1 } }),
    totalInt: total({ numFmt: FORMATS.intSummary, align: { h: 'right' } }),
    totalPct: total({ numFmt: FORMATS.pct, align: { h: 'right' } }),
    totalBlank: total({}),
    kvLabel: cell10({ fill: COLORS.light, font: { bold: true }, align: { h: 'left', indent: 1 } }),
    kvValue: cell10({ align: { h: 'left', wrap: true, indent: 1 } }),
    input: S.style({ fill: COLORS.inputFill, font: { bold: true, size: 11, color: COLORS.inputFont }, border: 'box', borderColor: COLORS.inputBorder, align: { h: 'center', v: 'center' } }),
    inputDate: S.style({
      fill: COLORS.inputFill,
      font: { bold: true, size: 11, color: COLORS.inputFont },
      border: 'box',
      borderColor: COLORS.inputBorder,
      numFmt: FORMATS.date,
      align: { h: 'center', v: 'center' },
    }),
    applied: cell10({ numFmt: FORMATS.date, font: { bold: true, color: COLORS.navy }, align: { h: 'center' } }),
    appliedInt: cell10({ numFmt: FORMATS.intSummary, font: { bold: true, color: COLORS.navy }, align: { h: 'center' } }),
    link: S.style({ font: { bold: true, size: 10, underline: true, color: COLORS.navy }, align: { v: 'center', indent: 1 } }),
    desc: S.style({ font: { size: 10 }, align: { v: 'center', wrap: true } }),
    paragraph: S.style({ font: { size: 10 }, align: { v: 'top', wrap: true } }),
    plain10: S.style({ font: { size: 10 } }),
  };
}

export type Theme = ReturnType<typeof createTheme>;

/** Excel column width (characters of the default font) so the longest word of the header fits on one line. */
export function fitWidth(header: string, width: number): number {
  const longest = Math.max(...header.split(/\s+/).map((w) => w.length), 1);
  return Math.max(width, Math.ceil(longest * 0.95 + 2));
}

/** Lines needed by a text in a width, breaking at spaces (approximate: ~1.15 characters of 9–10 pt per unit). */
export function lineCount(text: string, width: number, charsPerUnit = 1.15): number {
  const capacity = Math.max(4, Math.floor((width - 1) * charsPerUnit));
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let used = 0;
    lines++;
    for (const word of paragraph.split(' ')) {
      const len = word.length + (used ? 1 : 0);
      if (used + len > capacity && used > 0) {
        lines++;
        used = word.length;
      } else used += len;
    }
  }
  return lines;
}

/** Height (points) of a header row: 9-pt bold lines of ~11.5 points, plus padding. */
export function headerHeight(cols: { header: string; width: number }[]): number {
  const lines = Math.max(1, ...cols.map((c) => lineCount(c.header, c.width, 1.05)));
  return Math.min(64, Math.max(24, lines * 11.5 + 8));
}

/** Height (points) of a wrapped text row of the given font size over a total width. */
export function textHeight(text: string, width: number, size = 9): number {
  const perLine = size <= 9 ? 12 : 13.5;
  return Math.max(15, lineCount(text, width, size <= 9 ? 1.3 : 1.15) * perLine + 4);
}
