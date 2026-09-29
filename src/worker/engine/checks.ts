/**
 * Engine invariants of a scope (docs/REGRAS_CFGR700.md, section 11):
 * 3. discarded + effective alterations = Alteração events;
 * 4. every Alteração event discarded as "efetivação" has only the expected CT2_TPSALD transition (9 → 1),
 *    which holds by construction of the classification;
 * 5. the records of each document are contiguous in the base;
 * 6. a partition of the log into periods (one per day) adds up to the full log;
 * 7. the composition by entry date of the full log (default cutoff) adds up to the categories + unidentified.
 * Segregated analysis by balance type (section 13):
 * 12. the phases add up to the events, per operation;
 * 13. every event of the posting phase has the transition 9 → 1;
 * 14. no balance type is presumed: every event outside "Não determinado" has it read from the log or rebuilt;
 * 15. (alert) exceptions to the premise, counted by type.
 */
import { INVALID_TIME, dayOfSeconds } from '../../shared/dates';
import type { ExceptionId } from '../../shared/segregation';
import type { ScopeAnalysis } from './analysis';
import {
  EXCEPTION_MASK,
  PHASE_ACTIVATION,
  PHASE_UNDETERMINED,
  SOURCE_DIRECT,
  SOURCE_UNDETERMINED,
  eventsByPhase,
  primaryException,
} from './balancePhases';
import { OP_INSERT, OP_UPDATE } from './events';
import { composition, compositionMatches, defaultCutoffDay, scopeBounds } from './panel';
import { FULL_PERIOD, periodPanel, type CategoryPanel, type PeriodPanel } from './periods';

export interface ScopeCheckResults {
  alterationsReconcile: boolean;
  discardedBalanceTypeExpected: boolean;
  baseContiguous: boolean;
  periodsPartition: boolean;
  competenceMatches: boolean;
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
    competenceMatches: compositionMatches(
      periodPanel(scope, FULL_PERIOD),
      composition(scope, FULL_PERIOD, defaultCutoffDay(scopeBounds(scope))),
    ),
  };
}

export interface SegregationCheckResults {
  /** Invariant 12. */
  phasesAddUp: boolean;
  /** Invariant 13. */
  activationsHaveTransition: boolean;
  /** Invariant 14. */
  noPresumedBalance: boolean;
  /** Invariant 15: exception events of the scope, by type (only the types found). */
  exceptions: Partial<Record<ExceptionId, number>>;
  exceptionEvents: number;
}

/** `events` = distinct events of the scope per operation code, counted by the ingestion (section 4). */
export function segregationChecks(scope: ScopeAnalysis, events: number[]): SegregationCheckResults {
  const { log, phases: p } = scope;
  const { details: d, byEvent, dict, config, fields } = log;
  const t = p.timeline;
  const FROM = config.balanceType.expectedFrom.trim();
  const TO = config.balanceType.expectedTo.trim();

  const byPhase = eventsByPhase(log, p);
  const phasesAddUp = events.every((n, op) => byPhase.reduce((sum, row) => sum + row[op]!, 0) === n);

  /** Trimmed old/new values of the CT2_TPSALD rows of a timeline event. */
  const balanceRows = (g: number) => {
    const out: [string, string][] = [];
    for (let k = t.start[g]!; k < t.start[g + 1]!; k++) {
      const i = byEvent[k]!;
      if (d.field[i] === fields.balanceTypeField) out.push([dict.get(d.oldVal[i]!).trim(), dict.get(d.newVal[i]!).trim()]);
    }
    return out;
  };

  let activationsHaveTransition = true;
  let noPresumedBalance = true;
  const exceptions: Partial<Record<ExceptionId, number>> = {};
  let exceptionEvents = 0;
  for (let e = 0; e < p.count; e++) {
    const g = p.global[e]!;
    const op = d.op[byEvent[p.pos[e]!]!]!;
    const phase = t.phase[g]!;
    if (phase === PHASE_ACTIVATION && !(op === OP_UPDATE && balanceRows(g).some(([o, n]) => o === FROM && n === TO))) activationsHaveTransition = false;
    if (phase !== PHASE_UNDETERMINED) {
      if (t.source[g] === SOURCE_UNDETERMINED || t.balance[g]! < 0) noPresumedBalance = false;
      // Read from the log: the event itself carries the value (the insert, the one written by the first insert).
      else if (t.source[g] === SOURCE_DIRECT && op !== OP_INSERT && !balanceRows(g).some(([o]) => o === t.balanceValues[t.balance[g]!])) noPresumedBalance = false;
    }
    const flags = t.flags[g]!;
    if (flags & EXCEPTION_MASK) {
      exceptionEvents++;
      const id = primaryException(flags)!;
      exceptions[id] = (exceptions[id] ?? 0) + 1;
    }
  }
  return { phasesAddUp, activationsHaveTransition, noPresumedBalance, exceptions, exceptionEvents };
}
