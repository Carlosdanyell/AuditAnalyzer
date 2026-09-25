/**
 * Coverage of several extractions (docs/REGRAS_CFGR700.md, section 3): alert when the event intervals
 * of two files overlap or when weekdays between them are not covered by any file.
 */
import type { Alert } from '../../shared/protocol';
import { dayOfSeconds, formatDay, weekday } from '../../shared/dates';

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
