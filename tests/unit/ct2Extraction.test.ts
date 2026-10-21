import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { CT2_COLUMNS, buildCt2Extraction, columnRef, ct2Line } from '../synthetic/ct2Extraction';

/** The synthetic CT2 extraction has the layout of the real one (docs/REGRAS_CT2_INTEGRIDADE.md, section 2). */
const parts = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
};

describe('synthetic CT2 extraction', () => {
  const rows = [
    ct2Line({ document: '000001', line: '001', amount: 10.5 }),
    { gap: 2 },
    ct2Line({ document: 1, line: 2, batch: 1, amount: '1.234,56' }),
    { empty: true as const },
  ];

  it('is deterministic', () => {
    expect(buildCt2Extraction({ rows })).toEqual(buildCt2Extraction({ rows }));
  });

  it('has one sheet with the table title, a blank row and the header in row 3, with trailing spaces', () => {
    const p = parts(buildCt2Extraction({ rows }));
    expect(p['xl/workbook.xml']).toContain('<sheet name="SCACKST0.XML"');
    expect(CT2_COLUMNS).toHaveLength(80);
    expect(CT2_COLUMNS[0]).toMatch(/^Data Lcto +$/);
    const sheet = p['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<row r="1">');
    expect(sheet).not.toContain('<row r="2"');
    expect(sheet).toContain('<row r="3">');
    expect(sheet).toContain(`<c r="${columnRef(79)}3" t="s">`);
    expect(columnRef(0)).toBe('A');
    expect(columnRef(26)).toBe('AA');
    expect(columnRef(79)).toBe('CB');
    expect(sheet).toContain('<dimension ref="A1:CB8"/>');
  });

  it('writes codes as text or as numbers, amounts as numbers or pt-BR text, and leaves gaps and empty rows', () => {
    const sheet = parts(buildCt2Extraction({ rows }))['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<row r="4">');
    expect(sheet).not.toContain('<row r="5"');
    expect(sheet).not.toContain('<row r="6"');
    expect(sheet).toContain('<row r="8"/>');
    // Row 4: text codes and a numeric amount; rows 5-6 are a gap; row 7: numeric codes and a pt-BR text amount.
    expect(sheet).toMatch(/<c r="B4" t="s"><v>\d+<\/v><\/c>/);
    expect(sheet).toContain('<c r="K4"><v>10.5</v></c>');
    expect(sheet).toContain('<c r="B7"><v>1</v></c>');
    expect(sheet).toMatch(/<c r="K7" t="s"><v>\d+<\/v><\/c>/);
  });

  it('can write inline strings, omit the dimension and use the 1904 date system', () => {
    const p = parts(buildCt2Extraction({ rows, inlineStrings: true, omitDimension: true, date1904: true }));
    expect(p['xl/sharedStrings.xml']).toBeUndefined();
    expect(p['xl/worksheets/sheet1.xml']).toContain('t="inlineStr"');
    expect(p['xl/worksheets/sheet1.xml']).not.toContain('<dimension');
    expect(p['xl/workbook.xml']).toContain('<workbookPr date1904="1"/>');
  });
});
