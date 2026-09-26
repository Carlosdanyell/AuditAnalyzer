/**
 * Compares the Resumo of an exported workbook (evaluated by xlsxEval) with the tool's panel for a period.
 * Returns only the names of the diverging cells, never the values, so the output of the local tests
 * (real files) can be shared without exposing data.
 */
import { SIGNAL_IDS } from '../../src/config/schema';
import type { CategoryPanel, Period } from '../../src/shared/protocol';
import { coverageCounts } from '../../src/worker/engine/justifications';
import { composition, periodSignals, subtractPanels } from '../../src/worker/engine/panel';
import { FULL_PERIOD, periodPanel } from '../../src/worker/engine/periods';
import { LABELS, type Language } from '../../src/worker/export/labels';
import type { Session } from '../../src/worker/session';
import type { Value, Workbook } from './xlsxEval';

const CATEGORIES = ['deleted', 'changed', 'unbalanced', 'posted'] as const;
const COLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export function rowOf(book: Workbook, sheet: string, text: string): number {
  for (const [ref, cell] of book.sheets.get(sheet)!) {
    const m = /^A(\d+)$/.exec(ref);
    if (m && cell.v === text) return Number(m[1]);
  }
  throw new Error(`"${text}" não encontrado em ${sheet}`);
}

export function resumoMismatches(
  book: Workbook,
  language: Language,
  session: Session,
  scopeIndex: number,
  period: Period,
  cutoffDay: number,
): string[] {
  const L = LABELS[language];
  const S = L.sheets.summary;
  const scope = session.result.analyses[scopeIndex]!;
  const out: string[] = [];
  /** money: compare in cents. */
  const check = (label: string, ref: string, expected: number, money = false) => {
    const v: Value = book.value(S, ref);
    const got = typeof v === 'number' ? (money ? Math.round(v * 100) : v) : Number.NaN;
    if (got !== expected) out.push(`${label} (${ref})`);
  };
  const panel = periodPanel(scope, period);
  const full = periodPanel(scope, FULL_PERIOD);
  const other = subtractPanels(full, panel);
  const comp = composition(scope, period, cutoffDay);
  const lines = (c: CategoryPanel) => c.manual.lines + c.automatic.lines + c.unidentifiedLines;

  const s1 = rowOf(book, S, L.summary.s1) + 2;
  const s2 = rowOf(book, S, L.summary.s2) + 2;
  const s3 = rowOf(book, S, L.summary.s3) + 2;
  CATEGORIES.forEach((cat, i) => {
    const c = panel[cat];
    [c.manual.lines, c.manual.documents, c.manual.debitCents, c.automatic.lines, c.automatic.documents, c.automatic.debitCents, c.mixedDocuments, c.totalDocuments, c.unidentifiedLines].forEach(
      (expected, k) => check(`quadro 1 ${cat} coluna ${k + 1}`, `${COLS[k]}${s1 + i}`, expected, k === 2 || k === 5),
    );
    const triple = (p: CategoryPanel) => [lines(p), p.totalDocuments, p.manual.debitCents + p.automatic.debitCents];
    [...triple(panel[cat]), ...triple(other[cat]), ...triple(full[cat])].forEach((expected, k) =>
      check(`quadro 2 ${cat} coluna ${k + 1}`, `${COLS[k]}${s2 + i}`, expected, k % 3 === 2),
    );
    const x = comp[cat];
    [x.upToCutoff.lines, x.upToCutoff.documents, x.upToCutoff.debitCents, x.afterCutoff.lines, x.afterCutoff.documents, x.afterCutoff.debitCents, x.unreadableDate.lines, x.unreadableDate.documents, x.unidentifiedLines].forEach(
      (expected, k) => check(`quadro 3 ${cat} coluna ${k + 1}`, `${COLS[k]}${s3 + i}`, expected, k === 2 || k === 5),
    );
  });

  const s4 = rowOf(book, S, L.summary.s4) + 2;
  const signals = periodSignals(scope, period, session.context);
  SIGNAL_IDS.forEach((id, i) => {
    const s = signals.find((x) => x.id === id)!;
    check(`sinal ${id}`, `B${s4 + i}`, s.count);
    if ((book.value(S, `J${s4 + i}`) === L.values.action) !== s.requiresAction) out.push(`ação do sinal ${id} (J${s4 + i})`);
  });

  const s5 = rowOf(book, S, L.summary.s5) + 2;
  const coverage = coverageCounts(scope, period, session.context.justifications, session.context.sourceNames);
  [coverage.deleted, coverage.changed].forEach((c, i) =>
    [c.total, c.justified, c.moved, c.pending].forEach((expected, k) => check(`quadro 5 linha ${i + 1} coluna ${k + 1}`, `${COLS[k]}${s5 + i}`, expected)),
  );
  return out;
}
