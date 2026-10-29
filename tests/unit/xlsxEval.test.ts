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
});
