/**
 * The codes of finding of the Conciliador in the Análise (flow revision of 25/11/2026), pure: one item per code with its
 * occurrences (the rows of Tabelas › Achados filtered by the code), by the severity the engine gave; the known codes
 * without occurrence go to the folded group.
 */
import type { AnalysisTest, TestLevel } from '../../../components/AnalysisLayout';
import { formatInteger } from '../../../shared/format';
import type { ReconciliationSeverity, ReconciliationSummary } from '../../../shared/modules/reconciliation';
import { FINDING_RULES, FINDING_TITLES, findingTitle } from './labels';

const LEVEL: Record<ReconciliationSeverity, TestLevel> = { error: 'error', warning: 'warning', info: 'info' };
const ORDER: Record<ReconciliationSeverity, number> = { error: 0, warning: 1, info: 2 };

const occurrences = (n: number) => `${formatInteger(n)} ${n === 1 ? 'ocorrência' : 'ocorrências'}`;

export function concAnalysisTests(summary: Pick<ReconciliationSummary, 'findings'>): AnalysisTest[] {
  const found = new Map<string, { severity: ReconciliationSeverity; count: number }>();
  for (const f of summary.findings) {
    const x = found.get(f.code);
    if (x) {
      x.count++;
      if (ORDER[f.severity] < ORDER[x.severity]) x.severity = f.severity;
    } else found.set(f.code, { severity: f.severity, count: 1 });
  }
  const item = (code: string, severity: ReconciliationSeverity, count: number): AnalysisTest => ({
    key: code,
    code,
    label: findingTitle(code),
    level: LEVEL[severity],
    count,
    countText: occurrences(count),
    description: FINDING_RULES[code] ?? findingTitle(code),
    opens: true,
  });
  const tests = [...found].map(([code, x]) => item(code, x.severity, x.count));
  for (const code of Object.keys(FINDING_TITLES)) if (!found.has(code)) tests.push({ ...item(code, 'info', 0), note: 'sem ocorrência' });
  return tests;
}
