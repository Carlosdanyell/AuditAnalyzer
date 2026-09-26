/**
 * Panel data of a scope for a period (docs/REGRAS_CFGR700.md, section 8): categories by origin,
 * period × other days × full log, composition by entry date against a cutoff, signals and daily movement.
 * Every number comes from visitPeriod, the same allocation used by the tables.
 */
import { SIGNAL_IDS, type SignalId } from '../../config/schema';
import { INVALID_TIME, dayOfSeconds, formatDay, lastDayOfMonth } from '../../shared/dates';
import type {
  CategoryComposition,
  CategoryPanel,
  Composition,
  CompositionCell,
  DailyRow,
  PanelData,
  Period,
  PeriodPanel,
  PeriodPreset,
  Signal,
} from '../../shared/protocol';
import { EMPTY_ID } from '../store/dictionary';
import type { ScopeAnalysis } from './analysis';
import { sameEvent } from './events';
import { FULL_PERIOD, emptyPanel, isBusinessDay, periodPanel, visitPeriod } from './periods';

export interface PanelContext {
  /** File name of each source (global index). */
  sourceNames: string[];
  /** Event-date interval requested in the parameters of each source (global index); null when unknown. */
  requestedIntervals: (Period | null)[];
  /** Document keys with a justification (phase 4). */
  justifiedDocuments: Set<string>;
  /** False until justifications are loaded (phase 4). */
  justificationsLoaded: boolean;
  /** Day numbers of the configured holidays. */
  holidays: ReadonlySet<number>;
  /** Presets saved by the user. */
  userPresets: { label: string; period: Period }[];
}

const CATEGORIES = ['deleted', 'changed', 'unbalanced', 'posted'] as const;

// ── Period × other days × full log ──

function mapCategory(a: CategoryPanel, b: CategoryPanel, op: (x: number, y: number) => number): CategoryPanel {
  const cell = (x: CategoryPanel['manual'], y: CategoryPanel['manual']) => ({
    lines: op(x.lines, y.lines),
    documents: op(x.documents, y.documents),
    debitCents: op(x.debitCents, y.debitCents),
  });
  return {
    manual: cell(a.manual, b.manual),
    automatic: cell(a.automatic, b.automatic),
    mixedDocuments: op(a.mixedDocuments, b.mixedDocuments),
    totalDocuments: op(a.totalDocuments, b.totalDocuments),
    unidentifiedLines: op(a.unidentifiedLines, b.unidentifiedLines),
  };
}

/** a − b, category by category. */
export function subtractPanels(a: PeriodPanel, b: PeriodPanel): PeriodPanel {
  const out = emptyPanel();
  for (const c of CATEGORIES) out[c] = mapCategory(a[c], b[c], (x, y) => x - y);
  return out;
}

// ── Composition by entry date ──

const emptyCell = (): CompositionCell => ({ lines: 0, documents: 0, debitCents: 0 });
const emptyComposition = (): CategoryComposition => ({
  upToCutoff: emptyCell(),
  afterCutoff: emptyCell(),
  unreadableDate: emptyCell(),
  unidentifiedLines: 0,
});

export function composition(scope: ScopeAnalysis, period: Period, cutoffDay: number): Composition {
  const out: Composition = {
    deleted: emptyComposition(),
    changed: emptyComposition(),
    unbalanced: emptyComposition(),
    posted: emptyComposition(),
  };
  const bucket = (c: CategoryComposition, day: number) =>
    day === INVALID_TIME ? c.unreadableDate : day <= cutoffDay ? c.upToCutoff : c.afterCutoff;
  visitPeriod(scope, period, {
    line(category, r) {
      const c = out[category];
      if (r.origin === 'unidentified') {
        c.unidentifiedLines++;
        return;
      }
      const cell = bucket(c, r.entryDay);
      cell.lines++;
      cell.debitCents += r.debitCents;
    },
    document(category, d) {
      bucket(out[category], d.entryDay).documents++;
    },
  });
  return out;
}

/** Invariant 7: composition totals = category totals + unidentified lines. */
export function compositionMatches(panel: PeriodPanel, comp: Composition): boolean {
  return CATEGORIES.every((c) => {
    const p = panel[c];
    const k = comp[c];
    const sum = (f: keyof CompositionCell) => k.upToCutoff[f] + k.afterCutoff[f] + k.unreadableDate[f];
    return (
      sum('lines') === p.manual.lines + p.automatic.lines &&
      sum('documents') === p.totalDocuments &&
      sum('debitCents') === p.manual.debitCents + p.automatic.debitCents &&
      k.unidentifiedLines === p.unidentifiedLines
    );
  });
}

// ── Events per day ──

const eventsPerDayCache = new WeakMap<ScopeAnalysis, Map<number, number>>();

/** Distinct events (any operation) per event day, for the scope. */
export function eventsPerDay(scope: ScopeAnalysis): Map<number, number> {
  const cached = eventsPerDayCache.get(scope);
  if (cached) return cached;
  const { details: d, byEvent } = scope.log;
  const inScope = new Set(scope.sources);
  const counts = new Map<number, number>();
  let prev = -1;
  for (let k = 0; k < byEvent.length; k++) {
    const i = byEvent[k]!;
    if (!inScope.has(d.source[i]!)) continue;
    if (prev < 0 || !sameEvent(d, prev, i)) {
      const t = d.dateTime[i]!;
      if (t !== INVALID_TIME) {
        const day = dayOfSeconds(t);
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
    }
    prev = i;
  }
  eventsPerDayCache.set(scope, counts);
  return counts;
}

export function scopeBounds(scope: ScopeAnalysis): Period | null {
  const days = [...eventsPerDay(scope).keys()];
  if (days.length === 0) return null;
  return { startDay: Math.min(...days), endDay: Math.max(...days) };
}

export function dailyMovement(scope: ScopeAnalysis): DailyRow[] {
  const bounds = scopeBounds(scope);
  if (!bounds) return [];
  const events = eventsPerDay(scope);
  const rows: DailyRow[] = [];
  for (let day = bounds.startDay; day <= bounds.endDay; day++) {
    const p = periodPanel(scope, { startDay: day, endDay: day });
    const lines = (c: CategoryPanel) => c.manual.lines + c.automatic.lines + c.unidentifiedLines;
    rows.push({ day, posted: lines(p.posted), deleted: lines(p.deleted), changed: lines(p.changed), events: events.get(day) ?? 0 });
  }
  return rows;
}

// ── Signals ──

/** Consecutive days as ranges: "15/08/2026 a 16/08/2026, 05/09/2026". */
function formatDayRanges(days: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < days.length; ) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j++;
    parts.push(i === j ? formatDay(days[i]!) : `${formatDay(days[i]!)} a ${formatDay(days[j]!)}`);
    i = j + 1;
  }
  return parts.join(', ');
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}

export function periodSignals(scope: ScopeAnalysis, period: Period, context: PanelContext): Signal[] {
  const config = scope.log.config.panel.signals;
  const panel = periodPanel(scope, period);

  const pendingDocs = new Set<string>();
  const unidentifiedChanged = new Set<number>();
  let pending = 0;
  let corrected = 0;
  let noUser = 0;
  visitPeriod(scope, period, {
    line(category, r, index) {
      if (category === 'changed' && r.origin === 'unidentified') unidentifiedChanged.add(index);
      if (category === 'posted') {
        if (r.inconsistency === 'pending') pending++;
        else if (r.inconsistency === 'corrected') corrected++;
        if (r.inclusionUser === EMPTY_ID) noUser++;
      }
    },
    document(category, d) {
      if ((category === 'deleted' || category === 'changed') && !context.justifiedDocuments.has(d.key)) pendingDocs.add(d.key);
    },
  });

  // Days of the period outside every extraction (any day of the week), and business days inside an extraction
  // without any event. An unbounded end of the period (full log) is replaced by the first/last day known to the
  // scope (requested intervals and events); a bounded period is examined entirely.
  const requested = scope.sources.map((s) => context.requestedIntervals[s]).filter((p): p is Period => !!p);
  const bounds = scopeBounds(scope);
  const known = [...requested, ...(bounds ? [bounds] : [])];
  const events = eventsPerDay(scope);
  const quietDays: number[] = [];
  const uncovered: number[] = [];
  if (known.length > 0) {
    const start = period.startDay === FULL_PERIOD.startDay ? Math.min(...known.map((p) => p.startDay)) : period.startDay;
    const end = period.endDay === FULL_PERIOD.endDay ? Math.max(...known.map((p) => p.endDay)) : period.endDay;
    for (let day = start; day <= end; day++) {
      const covered = requested.some((p) => day >= p.startDay && day <= p.endDay);
      if (!covered) uncovered.push(day);
      else if (isBusinessDay(day, context.holidays) && !events.get(day)) quietDays.push(day);
    }
  }

  const counts: Record<SignalId, { n: number; action: boolean; values?: Record<string, string | number> }> = {
    unbalancedDocuments: { n: panel.unbalanced.totalDocuments, action: true },
    unjustifiedDocuments: { n: pendingDocs.size, action: true },
    unidentifiedChanges: { n: unidentifiedChanged.size, action: true },
    inconsistentEntries: { n: pending + corrected, action: pending > 0, values: { pendentes: pending, corrigidos: corrected } },
    noUserInclusions: { n: noUser, action: true },
    uncoveredDays: { n: uncovered.length, action: true, values: { dias: formatDayRanges(uncovered) } },
    daysWithoutEvents: { n: quietDays.length, action: true, values: { dias: quietDays.map(formatDay).join(', ') } },
  };

  return SIGNAL_IDS.map((id) => {
    const def = config[id];
    const { n, action, values } = counts[id];
    const requiresAction = n > 0 && (def.requiresAction === 'always' || (def.requiresAction === 'ifPending' && action));
    return {
      id,
      label: def.label,
      requiresAction,
      count: n,
      text: n === 0 ? def.none : fill(def.text, { n, ...values }),
    };
  });
}

// ── Presets and panel ──

export function defaultCutoffDay(bounds: Period | null): number {
  return bounds ? lastDayOfMonth(bounds.startDay) : INVALID_TIME;
}

export function periodPresets(scope: ScopeAnalysis, bounds: Period | null, context: PanelContext): PeriodPreset[] {
  const presets: PeriodPreset[] = [];
  if (bounds) presets.push({ id: 'full', label: 'Log completo', period: bounds });
  for (const s of scope.sources) {
    const interval = context.requestedIntervals[s];
    if (interval) presets.push({ id: `file-${s}`, label: `Arquivo ${s + 1} — ${context.sourceNames[s] ?? ''}`, period: interval });
  }
  context.userPresets.forEach((p, i) => presets.push({ id: `user-${i}`, label: p.label, period: p.period }));
  return presets;
}

export function buildPanel(
  scope: ScopeAnalysis,
  scopeIndex: number,
  request: { period: Period | null; cutoffDay: number | null },
  context: PanelContext,
): Omit<PanelData, 'settings'> {
  const bounds = scopeBounds(scope);
  const period = request.period ?? bounds ?? FULL_PERIOD;
  const cutoffDay = request.cutoffDay ?? defaultCutoffDay(bounds);
  const panel = periodPanel(scope, period);
  const full = periodPanel(scope, FULL_PERIOD);
  const comp = composition(scope, period, cutoffDay);
  return {
    scope: scopeIndex,
    period,
    cutoffDay,
    bounds,
    presets: periodPresets(scope, bounds, context),
    panel,
    otherDays: subtractPanels(full, panel),
    full,
    composition: comp,
    compositionMatches: compositionMatches(panel, comp),
    signals: periodSignals(scope, period, context),
    daily: dailyMovement(scope),
    justificationsLoaded: context.justificationsLoaded,
  };
}
