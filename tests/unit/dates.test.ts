import { describe, expect, it } from 'vitest';
import {
  INVALID_TIME,
  dayOfSeconds,
  formatIsoDateTime,
  parseDate,
  parseDateTime,
  weekday,
} from '../../src/shared/dates';

describe('date parsing without time zone', () => {
  it('epoch is 2000-01-01 00:00:00', () => {
    expect(parseDateTime('01/01/2000 00:00:00')).toBe(0);
    expect(parseDate('01/01/2000')).toBe(0);
  });

  it('parses dd/mm/aaaa hh:mm:ss to seconds and back', () => {
    const s = parseDateTime('04/09/2026 13:14:15');
    expect(formatIsoDateTime(s)).toBe('2026-09-04 13:14:15');
    expect(parseDateTime('05/09/2026 00:00:00') - parseDateTime('04/09/2026 00:00:00')).toBe(86_400);
  });

  it('handles leap years', () => {
    expect(parseDate('29/02/2024')).not.toBe(INVALID_TIME);
    expect(parseDate('29/02/2026')).toBe(INVALID_TIME);
    expect(parseDate('01/03/2024') - parseDate('28/02/2024')).toBe(2);
  });

  it.each([
    '',
    '4/9/2026 13:14:15',
    '31/04/2026 10:00:00',
    '10/13/2026 10:00:00',
    '10/10/2026 24:00:00',
    '10/10/2026 10:60:00',
    '10/10/2026',
    '2026-09-04 10:00:00',
    '10/10/1900 10:00:00',
  ])('rejects %j', (text) => {
    expect(parseDateTime(text)).toBe(INVALID_TIME);
  });

  it('tolerates surrounding spaces', () => {
    expect(parseDateTime(' 04/09/2026 13:14:15 ')).toBe(parseDateTime('04/09/2026 13:14:15'));
  });

  it('computes weekday (0 = Sunday) and day of a timestamp', () => {
    expect(weekday(parseDate('01/01/2000'))).toBe(6); // Saturday
    expect(weekday(parseDate('01/09/2026'))).toBe(2); // Tuesday
    expect(dayOfSeconds(parseDateTime('01/09/2026 23:59:59'))).toBe(parseDate('01/09/2026'));
  });
});
