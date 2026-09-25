// Presentation-layer formatting (pt-BR). Engine code must not import this module.
import { INVALID_TIME, dateParts, parseDate, weekday } from './dates';

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatInteger(value: number): string {
  return integer.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${integer.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${oneDecimal.format(bytes / 1024)} KB`;
  return `${oneDecimal.format(bytes / (1024 * 1024))} MB`;
}

/** Duration as m:ss or h:mm:ss. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatCrc(crc: number): string {
  return crc.toString(16).toUpperCase().padStart(8, '0');
}

export { formatDateTime } from './dates';

/** Short durations: "850 ms", "4,5 s", or m:ss from one minute on. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${integer.format(Math.round(ms))} ms`;
  if (ms < 60_000) return `${oneDecimal.format(ms / 1000)} s`;
  return formatDuration(ms);
}

const money = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Integer cents → "1.234,56". */
export function formatCents(cents: number): string {
  return money.format(cents / 100);
}

export { formatDay } from './dates';

/** Day number ↔ value of an <input type="date"> ("aaaa-mm-dd"), without Date objects. */
export function dayToInput(day: number): string {
  const [y, m, d] = dateParts(day);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function inputToDay(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const day = parseDate(`${m[3]}/${m[2]}/${m[1]}`);
  return day === INVALID_TIME ? null : day;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function weekdayName(day: number): string {
  return WEEKDAYS[weekday(day)]!;
}
