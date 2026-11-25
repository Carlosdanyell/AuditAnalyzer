/**
 * The workbook of the chart of accounts (docs/REGRAS_PLANO_DE_CONTAS.md, section 6): one sheet, "Doc-01-Plano de
 * Contas", with the title rows, the header and one row per account, styled by type and level (synthetic accounts
 * filled and bold, the description indented by the level, blocked accounts in red), the rows grouped by level with the
 * +/- button on the synthetic row above each group (summaryBelow = false), A4 landscape fitted to the width. Written
 * with the platform's streaming writer (src/worker/export/xlsxWriter.ts); values only, no formulas.
 */
import { XlsxWriter, dateCell, type Cell, type StyleSpec } from '../../export/xlsxWriter';
import {
  CHART_COLORS,
  CHART_COLUMNS,
  CHART_FONT_SIZE,
  CHART_HEIGHTS,
  CHART_MARGINS,
  CHART_MAX_OUTLINE,
  CHART_SITUATION_COLUMN,
  CHART_TITLE,
  chartFileName,
  chartNote,
  chartSheetName,
  type ChartColumnKind,
} from './layout';
import type { PlanRow } from './transform';

export interface ChartWorkbookOptions {
  /** Name of the CSV read (title of row 2 and name of the file). */
  sourceName: string;
  /** MM.AAAA or null (name of the sheet and of the file). */
  period: string | null;
}

/** Style of a data row: synthetic of level 1, synthetic deeper, or analytic (also a class outside the domain). */
type RowClass = 'synthetic1' | 'synthetic' | 'analytic';

const rowClass = (r: PlanRow): RowClass => (r.kind === 'synthetic' ? (r.level === 1 ? 'synthetic1' : 'synthetic') : 'analytic');

function cellSpec(kind: ChartColumnKind, cls: RowClass, indent: number, blocked: boolean): StyleSpec {
  const spec: StyleSpec = { font: { size: CHART_FONT_SIZE, ...(cls !== 'analytic' && { bold: true }), ...(blocked && { color: CHART_COLORS.blocked }) } };
  if (cls === 'synthetic1') spec.fill = CHART_COLORS.syntheticLevel1;
  if (cls === 'synthetic') spec.fill = CHART_COLORS.syntheticDeeper;
  if (kind === 'text' || kind === 'textCenter') spec.numFmt = '@';
  if (kind === 'date') spec.numFmt = 'dd/mm/yyyy';
  if (kind === 'center' || kind === 'date') spec.align = { h: 'center', v: 'center' };
  if (kind === 'textCenter') spec.align = { h: 'center' };
  // Excel shows an indent only with the text aligned left (with the general alignment it is ignored).
  if (kind === 'indent' && indent > 0) spec.align = { h: 'left', indent };
  return spec;
}

export async function buildChartWorkbook(
  rows: readonly PlanRow[],
  options: ChartWorkbookOptions,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<{ blob: Blob; fileName: string; minDateSerial: number | null }> {
  const steps = 3;
  onProgress(0, steps);
  const xw = new XlsxWriter({ defaultFontSize: CHART_FONT_SIZE });
  const S = xw.styles;
  const cache = new Map<string, number>();
  const style = (kind: ChartColumnKind, cls: RowClass, indent: number, blocked: boolean) => {
    const key = `${kind}|${cls}|${indent}|${blocked ? 1 : 0}`;
    let id = cache.get(key);
    if (id === undefined) {
      id = S.style(cellSpec(kind, cls, indent, blocked));
      cache.set(key, id);
    }
    return id;
  };

  const deepest = rows.reduce((max, r) => Math.max(max, r.level ?? 1), 1);
  const ws = xw.addSheet(chartSheetName(options.period), {
    columns: CHART_COLUMNS.map((c) => ({ width: c.width })),
    outline: { maxLevel: Math.min(deepest - 1, CHART_MAX_OUTLINE), summaryBelow: false },
    margins: CHART_MARGINS,
    fitToWidth: true,
  });

  ws.row([{ v: CHART_TITLE, s: S.style({ font: { size: 14, bold: true, color: CHART_COLORS.navy } }) }], { height: CHART_HEIGHTS.title });
  ws.row([{ v: chartNote(options.sourceName), s: S.style({ font: { size: 9, italic: true, color: CHART_COLORS.note } }) }], { height: CHART_HEIGHTS.note });
  ws.skip(1);
  const head = S.style({ font: { size: CHART_FONT_SIZE, bold: true, color: CHART_COLORS.white }, fill: CHART_COLORS.navy, align: { h: 'center', v: 'center', wrap: true } });
  ws.row(
    CHART_COLUMNS.map((c) => ({ v: c.header, s: head })),
    { height: CHART_HEIGHTS.header },
  );
  onProgress(1, steps);

  for (const r of rows) {
    const cls = rowClass(r);
    const indent = Math.max(0, (r.level ?? 1) - 1);
    const styles = CHART_COLUMNS.map((c, i) => style(c.kind, cls, c.kind === 'indent' ? indent : 0, i === CHART_SITUATION_COLUMN && r.blocked));
    const cells = CHART_COLUMNS.map((c, i): Cell | null => {
      const v = c.value(r);
      if (v === null || v === '') return null;
      const s = styles[i]!;
      if (c.kind === 'date') return dateCell(v as number, s);
      return { v, s };
    });
    ws.row(cells, { height: CHART_HEIGHTS.data, styles, outlineLevel: Math.min(indent, CHART_MAX_OUTLINE) });
  }
  ws.end();
  onProgress(2, steps);
  const blob = await xw.finish();
  onProgress(3, steps);
  return { blob, fileName: chartFileName(options.sourceName, options.period), minDateSerial: xw.minDateSerial };
}
