/**
 * Parts of the Rastreabilidade tab common to every module (docs/MODULOS.md, section 2): cells spanning columns,
 * headings, key-value rows, the differences of the configuration from its default and the checks of the run. The
 * module writes its own sections (files, parameters, justifications) between them. Layout and styles are the ones of
 * the CFGR700 workpaper, which keeps the same bytes.
 */
import type { ConfigDifference } from '../../../shared/configTools';
import type { CheckResult } from '../../../shared/protocol';
import { COLORS, headerHeight, textHeight, type Theme } from '../theme';
import { colName, type Cell, type CellInput, type SheetWriter } from '../xlsxWriter';

const str = (s: string) => `"${s.replace(/"/g, '""')}"`;

export interface ChecksLabels {
  cols: readonly string[];
  blocking: string;
  warning: string;
  passed: string;
  failed: string;
}

export class TraceSheet {
  constructor(
    readonly sheet: SheetWriter,
    private readonly T: Theme,
    /** Widths of the columns of the tab (for the heights of wrapped texts). */
    readonly widths: readonly number[],
  ) {}

  /** One row of cells, each spanning `span` columns (merged). */
  cellsSpan(parts: { cell: Cell & { s: number }; span?: number }[], height?: number): number {
    const row: CellInput[] = [];
    const merges: string[] = [];
    for (const { cell, span = 1 } of parts) {
      const start = row.length;
      row.push(cell, ...Array.from({ length: span - 1 }, () => ({ v: null, s: cell.s })));
      if (span > 1) merges.push(`${colName(start)}:${colName(start + span - 1)}`);
    }
    const r = this.sheet.row(row, height ? { height } : {});
    for (const m of merges) {
      const [a, b] = m.split(':');
      this.sheet.merge(`${a}${r}:${b}${r}`);
    }
    return r;
  }

  headRow(titles: readonly string[]): number {
    return this.sheet.row(
      titles.map((v) => ({ v, s: this.T.headSummary })),
      { height: headerHeight(titles.map((h, i) => ({ header: h, width: this.widths[i]! }))) },
    );
  }

  heading(text: string): void {
    this.sheet.skip(1);
    this.sheet.row([{ v: text, s: this.T.h2 }], { height: 22 });
  }

  /** A label and its value over the next `span` columns. */
  kv(label: string, value: string, span = 7): void {
    this.cellsSpan([{ cell: { v: label, s: this.T.kvLabel } }, { cell: { v: value, s: this.T.kvValue }, span }], 18);
  }

  /** The blocking checks that failed and were confirmed when exporting. */
  confirmed(text: string, span = 8): void {
    this.sheet.skip(1);
    this.cellsSpan([{ cell: { v: text, s: this.T.fail }, span }], 22);
  }

  /** Differences of the configuration from its default: item, default, used (columns 1-2, 3-5 and 6-8). */
  configDifferences(differences: readonly ConfigDifference[], labels: { none: string; cols: readonly string[] }): void {
    const T = this.T;
    if (differences.length === 0) {
      this.cellsSpan([{ cell: { v: labels.none, s: T.kvValue }, span: 8 }], 18);
      return;
    }
    this.cellsSpan(
      [
        { cell: { v: labels.cols[0]!, s: T.headSummary }, span: 2 },
        { cell: { v: labels.cols[1]!, s: T.headSummary }, span: 3 },
        { cell: { v: labels.cols[2]!, s: T.headSummary }, span: 3 },
      ],
      20,
    );
    const shownValue = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
    const diffWidth = this.widths.slice(2, 5).reduce((a, b) => a + b, 0);
    for (const d of differences) {
      const base = shownValue(d.base);
      const used = shownValue(d.value);
      this.cellsSpan(
        [
          { cell: { v: d.path, s: T.text }, span: 2 },
          { cell: { v: base, s: T.text }, span: 3 },
          { cell: { v: used, s: T.text }, span: 3 },
        ],
        Math.max(18, textHeight(base, diffWidth, 10), textHeight(used, diffWidth, 10)),
      );
    }
  }

  /** The checks of the run: label, kind, result and message over `detailSpan` columns; failures in red. */
  checks(checks: readonly CheckResult[], labels: ChecksLabels, detailSpan: number): void {
    const T = this.T;
    const detailWidth = this.widths.slice(3, 3 + detailSpan).reduce((a, b) => a + b, 0);
    this.cellsSpan(
      [
        { cell: { v: labels.cols[0]!, s: T.headSummary } },
        { cell: { v: labels.cols[1]!, s: T.headSummary } },
        { cell: { v: labels.cols[2]!, s: T.headSummary } },
        { cell: { v: labels.cols[3]!, s: T.headSummary }, span: detailSpan },
      ],
      20,
    );
    const first = this.sheet.nextRow;
    for (const c of checks) {
      this.cellsSpan(
        [
          { cell: { v: c.label, s: T.label } },
          { cell: { v: c.severity === 'error' ? labels.blocking : labels.warning, s: T.center } },
          { cell: { v: c.passed ? labels.passed : labels.failed, s: T.center } },
          { cell: { v: c.message, s: T.text }, span: detailSpan },
        ],
        Math.max(20, textHeight(c.message, detailWidth, 10), textHeight(c.label, this.widths[0]!, 10)),
      );
    }
    const last = this.sheet.nextRow - 1;
    if (last >= first) {
      this.sheet.conditional({ sqref: `C${first}:C${last}`, formula: `C${first}=${str(labels.failed)}`, style: { fill: COLORS.badFill, font: { bold: true, color: COLORS.badFont } } });
      this.sheet.conditional({ sqref: `C${first}:C${last}`, formula: `C${first}=${str(labels.passed)}`, style: { font: { color: COLORS.okFont } } });
    }
  }
}
