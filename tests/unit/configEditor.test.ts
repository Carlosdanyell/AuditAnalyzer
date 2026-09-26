import { describe, expect, it } from 'vitest';
import { centsFromReais, formatList, getIn, issuesAt, parseList, reaisFromCents, setIn } from '../../src/app/configEditor';

describe('configuration screen helpers', () => {
  it('reads and writes by path without mutating', () => {
    const draft = { fields: { date: 'CT2_DATA', keep: ['A'] }, table: 'CT2' };
    const next = setIn(draft, ['fields', 'date'], 'CT2_X');
    expect(getIn(next, ['fields', 'date'])).toBe('CT2_X');
    expect(draft.fields.date).toBe('CT2_DATA');
    expect(next.fields).not.toBe(draft.fields);
    expect(getIn(next, ['fields', 'keep'])).toEqual(['A']);
    expect(getIn(next, ['missing', 'x'])).toBeUndefined();
    expect(setIn({}, ['a', 'b'], 1)).toEqual({ a: { b: 1 } });
  });

  it('turns typed lists into items and back', () => {
    expect(parseList(' CT2_DATA, CT2_LOTE\nCT2_DOC;CT2_DATA\n\n')).toEqual(['CT2_DATA', 'CT2_LOTE', 'CT2_DOC']);
    expect(formatList(['a', 'b'])).toBe('a\nb');
  });

  it('converts reais typed in Brazilian format to cents', () => {
    expect(centsFromReais('0,01')).toBe(1);
    expect(centsFromReais('1.234,56')).toBe(123456);
    expect(centsFromReais('10')).toBe(1000);
    expect(centsFromReais('1,234')).toBeNull();
    expect(centsFromReais('abc')).toBeNull();
    expect(reaisFromCents(1)).toBe('0,01');
  });

  it('finds the errors of a field and below it', () => {
    const issues = [
      { path: 'fields.keep', message: 'a' },
      { path: 'fields', message: 'b' },
      { path: 'fieldLabels.X', message: 'c' },
    ];
    expect(issuesAt(issues, 'fields').map((i) => i.message)).toEqual(['a', 'b']);
    expect(issuesAt(issues, 'fields.keep').map((i) => i.message)).toEqual(['a']);
  });
});
