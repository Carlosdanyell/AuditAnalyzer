import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { INVALID_TIME, dayFromExcelSerial, formatDay, parseDate } from '../../src/shared/dates';
import { centsFromBrText, centsFromNumberText } from '../../src/shared/money';
import { CellKind } from '../../src/worker/ingest/sheetStream';
import { codeFromCell, entryTypeLookup, lineOrdinal, otherValue, sidesOf } from '../../src/worker/modules/ct2Integrity/values';

/** Conversions of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2 and 4). */
describe('amounts in cents', () => {
  it('numeric cells: Math.round(v * 100), as the specification says', () => {
    expect(centsFromNumberText('0.29')).toBe(29);
    expect(centsFromNumberText('1234.5599999999999')).toBe(123456);
    expect(centsFromNumberText('100')).toBe(10000);
    expect(centsFromNumberText('-12.5')).toBe(-1250);
    expect(centsFromNumberText('1E-3')).toBe(0);
    expect(Object.is(centsFromNumberText('-0.001'), 0)).toBe(true);
    expect(centsFromNumberText('9007199254740993')).toBeNaN();
    for (const bad of ['', ' ', 'abc', 'Infinity', 'NaN']) expect(centsFromNumberText(bad), bad).toBeNaN();
  });

  it('pt-BR text: optional minus, thousands with dots, up to two decimals after the comma', () => {
    expect(centsFromBrText('1.234,56')).toBe(123456);
    expect(centsFromBrText(' -1.234,5 ')).toBe(-123450);
    expect(centsFromBrText('1234,56')).toBe(123456);
    expect(centsFromBrText('100')).toBe(10000);
    expect(centsFromBrText('1.234.567,00')).toBe(123456700);
    expect(Object.is(centsFromBrText('-0,00'), 0)).toBe(true);
    for (const bad of ['', '1,234', '1234.56', '1.23,45', '12.34', '(1.234,56)', '1.234,56-', 'R$ 10,00', ',5', 'abc']) {
      expect(centsFromBrText(bad), bad).toBeNaN();
    }
  });
});

describe('dates', () => {
  it('Excel serials: whole days of the 1900 or 1904 system, inside 1932-2067', () => {
    expect(formatDay(dayFromExcelSerial(46280))).toBe('15/09/2026');
    expect(dayFromExcelSerial(46280)).toBe(parseDate('15/09/2026'));
    expect(dayFromExcelSerial(46280 - 1462, true)).toBe(parseDate('15/09/2026'));
    expect(dayFromExcelSerial(46280.5)).toBe(INVALID_TIME);
    expect(dayFromExcelSerial(1)).toBe(INVALID_TIME);
    expect(dayFromExcelSerial(80000)).toBe(INVALID_TIME);
  });
});

describe('codes, lines and entry types', () => {
  it('codes: text kept without spaces at the ends; numeric cells padded with zeros to the width', () => {
    expect(codeFromCell(CellKind.Shared, ' 000123 ', 6)).toBe('000123');
    expect(codeFromCell(CellKind.Number, '123', 6)).toBe('000123');
    expect(codeFromCell(CellKind.Number, '1234567', 6)).toBe('1234567');
    expect(codeFromCell(CellKind.Shared, '   ', 6)).toBe('');
    expect(codeFromCell(CellKind.Empty, '', 6)).toBe('');
    expect(codeFromCell(CellKind.Number, '12.5', 6)).toBeNull();
    expect(codeFromCell(CellKind.Number, '', 6)).toBe('');
  });

  it('line ordinal: 001-999 numeric; alphanumeric lines have none (they sort after 999 by their text)', () => {
    expect(lineOrdinal('001')).toBe(1);
    expect(lineOrdinal('999')).toBe(999);
    expect(lineOrdinal('A00')).toBeNull();
    expect(['A01', '999', 'A00', '001', 'B00'].sort()).toEqual(['001', '999', 'A00', 'A01', 'B00']);
  });

  it('entry types from the texts of the extraction or the CT2_DC codes, and the side of the amount', () => {
    const typeOf = entryTypeLookup(ct2DefaultConfig());
    expect(['Partida Dobrada', ' Debito ', 'Credito', 'Cont.Hist', '3', '1', '2', '4', 'Outro', ''].map(typeOf)).toEqual([
      'debitCredit', 'debit', 'credit', 'historyContinuation', 'debitCredit', 'debit', 'credit', 'historyContinuation', null, null,
    ]);
    expect(sidesOf('debitCredit', 500)).toEqual({ debit: 500, credit: 500 });
    expect(sidesOf('debit', 500)).toEqual({ debit: 500, credit: 0 });
    expect(sidesOf('credit', 500)).toEqual({ debit: 0, credit: 500 });
    expect(sidesOf('historyContinuation', 500)).toEqual({ debit: 0, credit: 0 });
    expect(sidesOf(null, 500)).toEqual({ debit: 0, credit: 0 });
  });
});

describe('values of the other columns of the extraction', () => {
  it('keep numbers as numbers and texts as read; an empty cell stays empty, never 0', () => {
    expect(otherValue(CellKind.Number, '12.5')).toBe(12.5);
    expect(otherValue(CellKind.Number, '')).toBeNull();
    expect(otherValue(CellKind.Number, ' ')).toBe(' ');
    expect(otherValue(CellKind.Text, '007 ')).toBe('007 ');
    expect(otherValue(CellKind.Shared, '')).toBeNull();
    expect(otherValue(CellKind.Other, '#N/A')).toBe('#N/A');
  });
});
