/**
 * Engine invariants of a scope (docs/REGRAS_CFGR700.md, section 11):
 * 3. discarded + effective alterations = Alteração events;
 * 4. every Alteração event discarded as "efetivação" has only the expected CT2_TPSALD transition (9 → 1),
 *    which holds by construction of the classification;
 * 5. the records of each document are contiguous in the base;
 * 6. a partition of the log into periods (one per day) adds up to the full log.
 */
import { INVALID_TIME, dayOfSeconds } from '../../shared/dates';
import type { ScopeAnalysis } from './analysis';
import { FULL_PERIOD, periodPanel, type CategoryPanel, type PeriodPanel } from './periods';

export interface ScopeCheckResults {
  alterationsReconcile: boolean;
  discardedBalanceTypeExpected: boolean;
  baseContiguous: boolean;
  periodsPartition: boolean;
}

function discardedActivationsExpected(scope: ScopeAnalysis): boolean {
  const { details: d, dict, config, fields } = scope.log;
  const { expectedFrom, expectedTo } = config.balanceType;
  return scope.alterationEvents
    .filter((e) => e.kind === 'activation')
    .every((e) =>
      e.rows.every(
        (i) =>
          d.field[i] !== fields.balanceTypeField ||
          (dict.get(d.oldVal[i]!).trim() === expectedFrom && dict.get(d.newVal[i]!).trim() === expectedTo),
      ),
    );
}

function baseIsContiguous(scope: ScopeAnalysis): boolean {
  const { baseOrder, records } = scope;
  if (baseOrder.length !== records.length) return false;
  const seen = new Uint8Array(records.length);
  const closed = new Set<number>();
  let current = -2;
  for (const index of baseOrder) {
    if (seen[index]) return false;
    seen[index] = 1;
    const doc = records[index]!.documentIndex;
    if (doc !== current) {
      if (closed.has(doc) && doc >= 0) return false;
      if (current >= 0) closed.add(current);
      current = doc;
    }
  }
  return true;
}

const flatten = (c: CategoryPanel) => [
  c.manual.lines,
  c.manual.documents,
  c.manual.debitCents,
  c.automatic.lines,
  c.automatic.documents,
  c.automatic.debitCents,
  c.mixedDocuments,
  c.totalDocuments,
  c.unidentifiedLines,
];
const panelNumbers = (p: PeriodPanel) => [p.deleted, p.changed, p.unbalanced, p.posted].flatMap(flatten);

function periodsAddUp(scope: ScopeAnalysis): boolean {
  const { details, byTime } = scope.log;
  const inScope = new Set(scope.sources);
  let first = Infinity;
  let last = -Infinity;
  for (let k = 0; k < byTime.length; k++) {
    const i = byTime[k]!;
    const t = details.dateTime[i]!;
    if (t === INVALID_TIME || !inScope.has(details.source[i]!)) continue;
    const day = dayOfSeconds(t);
    if (day < first) first = day;
    if (day > last) last = day;
  }
  const full = panelNumbers(periodPanel(scope, FULL_PERIOD));
  const sum = new Array<number>(full.length).fill(0);
  for (let day = first; day <= last; day++) {
    panelNumbers(periodPanel(scope, { startDay: day, endDay: day })).forEach((v, i) => (sum[i]! += v));
  }
  return sum.every((v, i) => v === full[i]);
}

export function scopeChecks(scope: ScopeAnalysis, updateEvents: number): ScopeCheckResults {
  const { alterations } = scope.stats;
  return {
    alterationsReconcile:
      alterations.effective + alterations.activation + alterations.stamp === alterations.total &&
      alterations.total === updateEvents,
    discardedBalanceTypeExpected: discardedActivationsExpected(scope),
    baseContiguous: baseIsContiguous(scope),
    periodsPartition: periodsAddUp(scope),
  };
}
