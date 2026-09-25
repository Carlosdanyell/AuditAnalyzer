/**
 * Dates as integers, without time zone (CLAUDE.md, Convenções).
 * Day numbers count days since 2000-01-01; timestamps count seconds since 2000-01-01 00:00:00.
 * The Int32 range covers 1932–2067; texts outside 1932–2067 are treated as invalid.
 */

export const INVALID_TIME = -2147483648;

const MIN_YEAR = 1932;
const MAX_YEAR = 2067;
const DAYS_1970_TO_2000 = 10957;

/** Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant's algorithm). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z1970: number): [year: number, month: number, day: number] {
  const z = z1970 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function digits(s: string, at: number, n: number): number {
  let v = 0;
  for (let i = at; i < at + n; i++) {
    const c = s.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return -1;
    v = v * 10 + c;
  }
  return v;
}

function dayFromParts(s: string, at: number): number {
  if (s.charCodeAt(at + 2) !== 47 || s.charCodeAt(at + 5) !== 47) return INVALID_TIME;
  const d = digits(s, at, 2);
  const m = digits(s, at + 3, 2);
  const y = digits(s, at + 6, 4);
  if (d < 1 || m < 1 || m > 12 || y < MIN_YEAR || y > MAX_YEAR || d > daysInMonth(y, m)) return INVALID_TIME;
  return daysFromCivil(y, m, d) - DAYS_1970_TO_2000;
}

/** "dd/mm/aaaa" → day number, or INVALID_TIME. */
export function parseDate(text: string): number {
  const s = text.trim();
  return s.length === 10 ? dayFromParts(s, 0) : INVALID_TIME;
}

/** "dd/mm/aaaa hh:mm:ss" → seconds, or INVALID_TIME. */
export function parseDateTime(text: string): number {
  const s = text.trim();
  if (s.length !== 19 || s.charCodeAt(10) !== 32 || s.charCodeAt(13) !== 58 || s.charCodeAt(16) !== 58) {
    return INVALID_TIME;
  }
  const day = dayFromParts(s, 0);
  const h = digits(s, 11, 2);
  const mi = digits(s, 14, 2);
  const se = digits(s, 17, 2);
  if (day === INVALID_TIME || h < 0 || h > 23 || mi < 0 || mi > 59 || se < 0 || se > 59) return INVALID_TIME;
  return day * 86400 + h * 3600 + mi * 60 + se;
}

export function dayOfSeconds(seconds: number): number {
  return Math.floor(seconds / 86400);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: number): number {
  return (((day + 6) % 7) + 7) % 7;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function dateParts(day: number): [year: number, month: number, day: number] {
  return civilFromDays(day + DAYS_1970_TO_2000);
}

/** "aaaa-mm-dd hh:mm:ss" (neutral format used in comparisons and file names). */
export function formatIsoDateTime(seconds: number): string {
  const day = dayOfSeconds(seconds);
  const [y, m, d] = dateParts(day);
  const rest = seconds - day * 86400;
  return `${pad(y, 4)}-${pad(m)}-${pad(d)} ${pad(Math.floor(rest / 3600))}:${pad(Math.floor(rest / 60) % 60)}:${pad(rest % 60)}`;
}

/** "dd/mm/aaaa" of a day number. */
export function formatDay(day: number): string {
  const [y, m, d] = dateParts(day);
  return `${pad(d)}/${pad(m)}/${pad(y, 4)}`;
}

/** "dd/mm/aaaa hh:mm:ss" of a timestamp. */
export function formatDateTime(seconds: number): string {
  const day = dayOfSeconds(seconds);
  const rest = seconds - day * 86400;
  return `${formatDay(day)} ${pad(Math.floor(rest / 3600))}:${pad(Math.floor(rest / 60) % 60)}:${pad(rest % 60)}`;
}
