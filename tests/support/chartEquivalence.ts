/**
 * Equivalence of the workbook of the chart of accounts with a reference workbook (docs/REGRAS_PLANO_DE_CONTAS.md,
 * section 9.4): values of the 22 columns, and per cell bold, font colour, fill, number format, horizontal alignment and
 * indent; outline level and height of each row; column widths. The only difference accepted is the date format: the
 * built-in short date of Excel (id 14) in the reference and dd/mm/yyyy in the module. Divergences are reported by
 * category and cell reference only, never with the values, so the output of a test on real files can be shared.
 */
import type { ResolvedStyle, SheetData, WorkbookData } from './xlsxStyles';
import { defaultStyleOf } from './xlsxStyles';

export const EQUIVALENCE_COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUV'.split('');

export type DivergenceCategory = 'valor' | 'negrito' | 'corFonte' | 'preenchimento' | 'formatoNumero' | 'alinhamento' | 'recuo' | 'agrupamento' | 'altura' | 'largura' | 'linhas';

export interface EquivalenceReport {
  /** Divergences by category. */
  counts: Record<DivergenceCategory, number>;
  /** Up to `examples` cell references (or row/column numbers) of each category. */
  examples: Record<DivergenceCategory, string[]>;
  /** Divergences by category and column letter (cells only). */
  byColumn: Record<string, Record<string, number>>;
  total: number;
}

const CATEGORIES: DivergenceCategory[] = ['valor', 'negrito', 'corFonte', 'preenchimento', 'formatoNumero', 'alinhamento', 'recuo', 'agrupamento', 'altura', 'largura', 'linhas'];

/** Number formats that show the same thing: the short date of Excel (id 14) and dd/mm/yyyy (accepted, 9.4). */
function sameFormat(a: string, b: string): boolean {
  const norm = (f: string) => (f.startsWith('builtin:14') ? 'dd/mm/yyyy' : f.toLowerCase());
  return norm(a) === norm(b);
}

const sameValue = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

export function compareChartSheets(generated: WorkbookData, reference: WorkbookData, options: { examples?: number; sheet?: number } = {}): EquivalenceReport {
  const max = options.examples ?? 10;
  const a = generated.sheets[options.sheet ?? 0]!;
  const b = reference.sheets[options.sheet ?? 0]!;
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<DivergenceCategory, number>;
  const examples = Object.fromEntries(CATEGORIES.map((c) => [c, [] as string[]])) as Record<DivergenceCategory, string[]>;
  const byColumn: Record<string, Record<string, number>> = {};
  const note = (category: DivergenceCategory, where: string, column?: string) => {
    counts[category]++;
    if (examples[category].length < max) examples[category].push(where);
    if (column) {
      byColumn[category] ??= {};
      byColumn[category][column] = (byColumn[category][column] ?? 0) + 1;
    }
  };
  const emptyA = defaultStyleOf(generated);
  const emptyB = defaultStyleOf(reference);
  const styleIn = (sheet: SheetData, ref: string, empty: ResolvedStyle) => sheet.cells.get(ref)?.style ?? empty;

  if (a.maxRow !== b.maxRow) note('linhas', `${a.maxRow} × ${b.maxRow}`);
  const rows = Math.max(a.maxRow, b.maxRow);
  for (let r = 1; r <= rows; r++) {
    for (const col of EQUIVALENCE_COLUMNS) {
      const ref = `${col}${r}`;
      if (!sameValue(a.cells.get(ref)?.value ?? null, b.cells.get(ref)?.value ?? null)) note('valor', ref, col);
      const sa = styleIn(a, ref, emptyA);
      const sb = styleIn(b, ref, emptyB);
      if (sa.bold !== sb.bold) note('negrito', ref, col);
      if (sa.color !== sb.color) note('corFonte', ref, col);
      if (sa.fill !== sb.fill) note('preenchimento', ref, col);
      if (!sameFormat(sa.numFmt, sb.numFmt)) note('formatoNumero', ref, col);
      if (sa.horizontal !== sb.horizontal) note('alinhamento', ref, col);
      if (sa.indent !== sb.indent) note('recuo', ref, col);
    }
    const ra = a.rows.get(r);
    const rb = b.rows.get(r);
    if ((ra?.outlineLevel ?? 0) !== (rb?.outlineLevel ?? 0)) note('agrupamento', `linha ${r}`);
    // Heights of rows 1, 2, 4 and the data rows (row 3 keeps the default of each file).
    if (r !== 3 && !sameValue(ra?.height ?? null, rb?.height ?? null)) note('altura', `linha ${r}`);
  }
  EQUIVALENCE_COLUMNS.forEach((col, i) => {
    if (!sameValue(a.widths.get(i + 1) ?? null, b.widths.get(i + 1) ?? null)) note('largura', col);
  });
  return { counts, examples, byColumn, total: CATEGORIES.reduce((n, c) => n + counts[c], 0) };
}
