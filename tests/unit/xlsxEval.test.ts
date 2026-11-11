import { describe, expect, it } from 'vitest';
import { Workbook } from '../support/xlsxEval';

/** The functions the CT2 workpaper adds to the test evaluator (docs/REGRAS_CT2_INTEGRIDADE.md, section 7.1), as Excel computes them. */
function book(cells: Record<string, number | string | null | { f: string }>, names: Record<string, string> = {}): Workbook {
  const wb = new Workbook();
  const sheet = new Map<string, { v: number | string | boolean | null; f?: string }>();
  for (const [ref, c] of Object.entries(cells)) sheet.set(ref, c !== null && typeof c === 'object' ? { v: null, f: c.f } : { v: c });
  wb.sheets.set('S', sheet);
  for (const [n, ref] of Object.entries(names)) wb.names.set(n, ref);
  return wb;
}

describe('test evaluator: functions of the CT2 workpaper', () => {
  it('ROWS counts the rows of a range without reading it, also through a name', () => {
    const wb = book({ A1: { f: 'ROWS(S!$A$5:$A$9)' }, A2: { f: 'ROWS(B3)' }, A3: { f: 'ROWS(BLOCO)' } }, { BLOCO: 'S!$C$2:$D$11' });
    expect(wb.value('S', 'A1')).toBe(5);
    expect(wb.value('S', 'A2')).toBe(1);
    expect(wb.value('S', 'A3')).toBe(10);
  });

  it('COUNTA counts the cells that are not empty (a formula giving "" counts, as in Excel)', () => {
    const wb = book({ A1: 'x', A2: null, A3: 0, A4: { f: '""' }, B1: { f: 'COUNTA(A1:A5)' } });
    expect(wb.value('S', 'B1')).toBe(3);
  });

  it('WEEKDAY with type 2 gives 1 for Monday to 7 for Sunday (serials of the 1900 system)', () => {
    // 46280 = 15/09/2026 (Tuesday); 46284 = 19/09/2026 (Saturday); 46285 = Sunday.
    const wb = book({ A1: { f: 'WEEKDAY(46280,2)' }, A2: { f: 'WEEKDAY(46284,2)' }, A3: { f: 'WEEKDAY(46285,2)' }, A4: { f: 'WEEKDAY(46279,2)' } });
    expect([1, 2, 3, 4].map((r) => wb.value('S', `A${r}`))).toEqual([2, 6, 7, 1]);
  });

  it('COUNTIF and SUMIF follow the criteria of COUNTIFS and SUMIFS', () => {
    const wb = book({
      A1: 'Sim', A2: 'Não', A3: 'Sim', A4: null,
      B1: 10, B2: 20, B3: 30, B4: 40,
      C1: { f: 'COUNTIF(A1:A4,"Sim")' },
      C2: { f: 'COUNTIF(B1:B4,">15")' },
      C3: { f: 'SUMIF(A1:A4,"Sim",B1:B4)' },
      C4: { f: 'SUMIF(B1:B4,">=30")' },
      C5: { f: 'COUNTIF(FERIADOS,46280)' },
      D1: 46280, D2: 46301,
    }, { FERIADOS: 'S!$D$1:$D$2' });
    expect(['C1', 'C2', 'C3', 'C4', 'C5'].map((r) => wb.value('S', r))).toEqual([2, 3, 40, 70, 1]);
  });

  it('EXACT compares texts with case, unlike "="', () => {
    const wb = book({ A1: 'abc', A2: 'ABC', B1: { f: 'EXACT(A1,A2)' }, B2: { f: 'A1=A2' }, B3: { f: 'EXACT(A1,"abc")' } });
    expect(['B1', 'B2', 'B3'].map((r) => wb.value('S', r))).toEqual([false, true, true]);
  });

  it('a numeric equality criterion also matches the texts that read as that number, as in Excel', () => {
    const wb = book({ A1: '610', A2: 610, A3: '0610', A4: 'x', B1: { f: 'COUNTIF(A1:A4,"=610")' }, B2: { f: 'COUNTIF(A1:A4,"<>610")' }, B3: { f: 'COUNTIF(A1:A4,">600")' } });
    expect(['B1', 'B2', 'B3'].map((r) => wb.value('S', r))).toEqual([3, 1, 1]);
  });

  it('SUMPRODUCT of COUNTIF with an array of criteria counts the cells that are any of them (document origin)', () => {
    const wb = book(
      { A1: '1', A2: '2', A3: 'X', A4: null, A5: '1', B1: { f: 'SUMPRODUCT(COUNTIF(A1:A5,MANUAL))' }, B2: { f: 'SUMPRODUCT(COUNTIF(A1:A5,AUTO))' }, B3: { f: 'SUMPRODUCT(COUNTIF(A3:A4,MANUAL))>0' }, C1: '1', C2: 'M', D1: '2' },
      { MANUAL: 'S!$C$1:$C$2', AUTO: 'S!$D$1:$D$1' },
    );
    expect(['B1', 'B2', 'B3'].map((r) => wb.value('S', r))).toEqual([2, 1, false]);
  });

  it('FIXED formats with the separators of the language of Excel: pt-BR by default, en-US for the English workpaper', () => {
    const cells = { A1: { f: 'FIXED(1234567.5,2)' }, A2: { f: 'FIXED(-0.005,2)' }, A3: { f: 'FIXED(-1234.565,2)' }, A4: { f: 'FIXED(1234,0)' }, A5: { f: 'FIXED(999.999,2)' }, A6: { f: 'FIXED(B1,2)' }, B1: 8 };
    const pt = book(cells);
    expect(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((r) => pt.value('S', r))).toEqual(['1.234.567,50', '-0,01', '-1.234,57', '1.234', '1.000,00', '8,00']);
    const en = book(cells);
    en.locale = 'en-US';
    expect(['A1', 'A3', 'A4', 'A6'].map((r) => en.value('S', r))).toEqual(['1,234,567.50', '-1,234.57', '1,234', '8.00']);
  });

  it('a number joined to a text takes the decimal separator of the language', () => {
    const cells = { A1: { f: '"x "&1.5' }, A2: { f: '"n "&12' } };
    const pt = book(cells);
    expect([pt.value('S', 'A1'), pt.value('S', 'A2')]).toEqual(['x 1,5', 'n 12']);
    const en = book(cells);
    en.locale = 'en-US';
    expect(en.value('S', 'A1')).toBe('x 1.5');
  });

  it('DAY, MONTH and YEAR read a serial of the 1900 system; a date text is composed without TEXT()', () => {
    // 46280 = 15/09/2026; 36526 = 01/01/2000; 59 = 28/02/1900; 61 = 01/03/1900.
    const wb = book({
      A1: { f: 'DAY(46280)' }, A2: { f: 'MONTH(46280)' }, A3: { f: 'YEAR(46280)' },
      A4: { f: 'RIGHT("0"&DAY(B1),2)&"/"&RIGHT("0"&MONTH(B1),2)&"/"&YEAR(B1)' }, B1: 36526,
      A5: { f: 'DAY(59)&"/"&MONTH(59)&" "&DAY(61)&"/"&MONTH(61)' },
    });
    expect(['A1', 'A2', 'A3', 'A4', 'A5'].map((r) => wb.value('S', r))).toEqual([15, 9, 2026, '01/01/2000', '28/2 1/3']);
  });

  it('LEFT, RIGHT, MID and LOWER work on texts', () => {
    const wb = book({ A1: 'Compensa doc 000011', B1: { f: 'LOWER(LEFT(A1,1))&MID(A1,2,1000)' }, B2: { f: 'RIGHT(A1,6)' }, B3: { f: 'LEFT(A1)' }, B4: { f: 'MID(A1,10,3)' } });
    expect(['B1', 'B2', 'B3', 'B4'].map((r) => wb.value('S', r))).toEqual(['compensa doc 000011', '000011', 'C', 'doc']);
  });
});
