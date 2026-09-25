/**
 * Several extractions (docs/REGRAS_CFGR700.md, section 3) and the period panel (section 8).
 * Coverage: alert when the event intervals of two files overlap or leave weekdays uncovered.
 */
import type { Alert } from '../../shared/protocol';
import { INVALID_TIME, dayOfSeconds, formatDay, weekday } from '../../shared/dates';
import type { ScopeAnalysis } from './analysis';
import type { DocumentInfo } from './documents';
import type { RecordInfo } from './records';

export interface FileInterval {
  name: string;
  first: number | null;
  last: number | null;
}

/** Weekdays (Monday to Friday) strictly between two days. Holidays are not considered. */
function weekdaysBetween(fromDay: number, toDay: number): number[] {
  const days: number[] = [];
  for (let d = fromDay + 1; d < toDay; d++) {
    const w = weekday(d);
    if (w !== 0 && w !== 6) days.push(d);
  }
  return days;
}

export function coverageAlerts(files: FileInterval[]): Alert[] {
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
    const gap = weekdaysBetween(dayOfSeconds(a.last), dayOfSeconds(b.first));
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
export interface DayPeriod {
  startDay: number;
  endDay: number;
}

export const FULL_PERIOD: DayPeriod = { startDay: -2147483648, endDay: 2147483647 };

export interface OriginCell {
  lines: number;
  documents: number;
  /** Sum of the debits of the lines counted. */
  debitCents: number;
}

export interface CategoryPanel {
  manual: OriginCell;
  automatic: OriginCell;
  mixedDocuments: number;
  totalDocuments: number;
  /** Lines of unidentified records: outside the Manual/Automático columns. */
  unidentifiedLines: number;
}

export interface PeriodPanel {
  deleted: CategoryPanel;
  changed: CategoryPanel;
  unbalanced: CategoryPanel;
  posted: CategoryPanel;
}

const emptyCategory = (): CategoryPanel => ({
  manual: { lines: 0, documents: 0, debitCents: 0 },
  automatic: { lines: 0, documents: 0, debitCents: 0 },
  mixedDocuments: 0,
  totalDocuments: 0,
  unidentifiedLines: 0,
});

function addLine(cat: CategoryPanel, r: RecordInfo): void {
  if (r.origin === 'unidentified') {
    cat.unidentifiedLines++;
    return;
  }
  const cell = r.origin === 'manual' ? cat.manual : cat.automatic;
  cell.lines++;
  cell.debitCents += r.debitCents;
}

function addDocument(cat: CategoryPanel, d: DocumentInfo): void {
  if (d.origin === 'mixed') cat.mixedDocuments++;
  else (d.origin === 'manual' ? cat.manual : cat.automatic).documents++;
  cat.totalDocuments++;
}

/**
 * Categories of a period (event dates). Deletions and postings count each document once, in the period
 * of its first event; changes use the date of each source file, so a record changed in two files
 * appears in both periods and the periods add up to the full log.
 */
export function periodPanel(scope: ScopeAnalysis, period: DayPeriod): PeriodPanel {
  const inPeriod = (t: number) => {
    const day = dayOfSeconds(t);
    return day >= period.startDay && day <= period.endDay;
  };
  const panel: PeriodPanel = {
    deleted: emptyCategory(),
    changed: emptyCategory(),
    unbalanced: emptyCategory(),
    posted: emptyCategory(),
  };
  const { records, documents, sources } = scope;

  for (const r of records) {
    if (r.deleted && inPeriod(r.deletionTime)) addLine(panel.deleted, r);
    if (r.included && inPeriod(r.inclusionTime)) addLine(panel.posted, r);
    for (const s of sources) {
      const t = r.lastChangeBySource[s]!;
      if (t !== INVALID_TIME && inPeriod(t)) addLine(panel.changed, r);
    }
  }
  for (const d of documents) {
    if (d.deletedLines > 0 && inPeriod(d.firstDeletion)) addDocument(panel.deleted, d);
    const posted = d.firstPosting !== INVALID_TIME && inPeriod(d.firstPosting);
    if (posted) addDocument(panel.posted, d);
    for (const s of sources) {
      const t = d.lastChangeBySource[s]!;
      if (t !== INVALID_TIME && inPeriod(t)) addDocument(panel.changed, d);
    }
    if (d.unbalanced === 'yes') {
      for (const index of d.records) {
        const r = records[index]!;
        if (r.included && inPeriod(r.inclusionTime)) addLine(panel.unbalanced, r);
      }
      if (posted) addDocument(panel.unbalanced, d);
    }
  }
  return panel;
}
