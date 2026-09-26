/**
 * Several extractions (docs/REGRAS_CFGR700.md, section 3) and the period panel (section 8).
 * Coverage: alert when the event intervals of two files overlap or leave weekdays uncovered.
 */
import type { Alert, Category, CategoryPanel, OriginCell, Period, PeriodPanel } from '../../shared/protocol';
import { INVALID_TIME, dayOfSeconds, formatDay, weekday } from '../../shared/dates';
import type { ScopeAnalysis } from './analysis';
import type { DocumentInfo } from './documents';
import type { RecordInfo } from './records';

export interface FileInterval {
  name: string;
  first: number | null;
  last: number | null;
}

/** Business day: Monday to Friday, not a configured holiday. */
export function isBusinessDay(day: number, holidays: ReadonlySet<number>): boolean {
  const w = weekday(day);
  return w !== 0 && w !== 6 && !holidays.has(day);
}

/** Business days strictly between two days. */
function businessDaysBetween(fromDay: number, toDay: number, holidays: ReadonlySet<number>): number[] {
  const days: number[] = [];
  for (let d = fromDay + 1; d < toDay; d++) if (isBusinessDay(d, holidays)) days.push(d);
  return days;
}

export function coverageAlerts(files: FileInterval[], holidays: ReadonlySet<number> = new Set()): Alert[] {
  const withEvents = files
    .filter((f): f is FileInterval & { first: number; last: number } => f.first !== null && f.last !== null)
    .sort((a, b) => a.first - b.first || a.last - b.last);
  const alerts: Alert[] = [];
  for (let k = 1; k < withEvents.length; k++) {
    const a = withEvents[k - 1]!;
    const b = withEvents[k]!;
    const range = (f: typeof a) => `${formatDay(dayOfSeconds(f.first))} a ${formatDay(dayOfSeconds(f.last))}`;
    if (b.first <= a.last) {
      alerts.push({
        level: 'warning',
        message: `Os intervalos de eventos de "${a.name}" (${range(a)}) e "${b.name}" (${range(b)}) se sobrepõem.`,
      });
      continue;
    }
    const gap = businessDaysBetween(dayOfSeconds(a.last), dayOfSeconds(b.first), holidays);
    if (gap.length > 0) {
      alerts.push({
        level: 'warning',
        message:
          `${gap.length} dia(s) útil(eis) (segunda a sexta) sem extração entre "${a.name}" e "${b.name}": ` +
          `${gap.map(formatDay).join(', ')}.`,
      });
    }
  }
  return alerts;
}

// ── Period panel (docs/REGRAS_CFGR700.md, section 8) ──

/** Event-date interval in day numbers, both ends included. */
export type DayPeriod = Period;
export type { CategoryPanel, OriginCell, PeriodPanel };

export const FULL_PERIOD: DayPeriod = { startDay: -2147483648, endDay: 2147483647 };

/**
 * Receives every line and document counted in a period, per category. `source` is the source file of the
 * change for the "changed" category (a record changed in two files is visited once per file), else -1.
 */
export interface PeriodVisitor {
  line(category: Category, record: RecordInfo, recordIndex: number, source: number): void;
  document(category: Category, document: DocumentInfo, documentIndex: number, source: number): void;
}

/**
 * The allocation rules of the panel. Deletions and postings count each document once, in the period of its
 * first event; changes use the date of each source file, so a record changed in two files appears in both
 * periods and the periods add up to the full log.
 */
export function visitPeriod(scope: ScopeAnalysis, period: DayPeriod, visitor: PeriodVisitor): void {
  const inPeriod = (t: number) => {
    const day = dayOfSeconds(t);
    return day >= period.startDay && day <= period.endDay;
  };
  const { records, documents, sources } = scope;

  records.forEach((r, index) => {
    if (r.deleted && inPeriod(r.deletionTime)) visitor.line('deleted', r, index, -1);
    if (r.included && inPeriod(r.inclusionTime)) visitor.line('posted', r, index, -1);
    for (const s of sources) {
      const t = r.lastChangeBySource[s]!;
      if (t !== INVALID_TIME && inPeriod(t)) visitor.line('changed', r, index, s);
    }
  });
  documents.forEach((d, index) => {
    if (d.deletedLines > 0 && inPeriod(d.firstDeletion)) visitor.document('deleted', d, index, -1);
    const posted = d.firstPosting !== INVALID_TIME && inPeriod(d.firstPosting);
    if (posted) visitor.document('posted', d, index, -1);
    for (const s of sources) {
      const t = d.lastChangeBySource[s]!;
      if (t !== INVALID_TIME && inPeriod(t)) visitor.document('changed', d, index, s);
    }
    if (d.unbalanced === 'yes') {
      for (const recordIndex of d.records) {
        const r = records[recordIndex]!;
        if (r.included && inPeriod(r.inclusionTime)) visitor.line('unbalanced', r, recordIndex, -1);
      }
      if (posted) visitor.document('unbalanced', d, index, -1);
    }
  });
}

export const emptyCategory = (): CategoryPanel => ({
  manual: { lines: 0, documents: 0, debitCents: 0 },
  automatic: { lines: 0, documents: 0, debitCents: 0 },
  mixedDocuments: 0,
  totalDocuments: 0,
  unidentifiedLines: 0,
});

export const emptyPanel = (): PeriodPanel => ({
  deleted: emptyCategory(),
  changed: emptyCategory(),
  unbalanced: emptyCategory(),
  posted: emptyCategory(),
});

/** Categories of a period (event dates), by origin. */
export function periodPanel(scope: ScopeAnalysis, period: DayPeriod): PeriodPanel {
  const panel = emptyPanel();
  visitPeriod(scope, period, {
    line(category, r) {
      const cat = panel[category];
      if (r.origin === 'unidentified') {
        cat.unidentifiedLines++;
        return;
      }
      const cell = r.origin === 'manual' ? cat.manual : cat.automatic;
      cell.lines++;
      cell.debitCents += r.debitCents;
    },
    document(category, d) {
      const cat = panel[category];
      if (d.origin === 'mixed') cat.mixedDocuments++;
      else (d.origin === 'manual' ? cat.manual : cat.automatic).documents++;
      cat.totalDocuments++;
    },
  });
  return panel;
}
