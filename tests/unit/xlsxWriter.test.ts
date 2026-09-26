import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseDate, parseDateTime } from '../../src/shared/dates';
import { XlsxWriter, colName, dateCell, dateTimeCell } from '../../src/worker/export/xlsxWriter';

async function build(fill: (w: XlsxWriter) => void) {
  const w = new XlsxWriter();
  fill(w);
  const blob = await w.finish();
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const text = (name: string) => strFromU8(files[name]!);
  return { w, files, text, blob };
}

describe('xlsx writer', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('writes the package parts, sheets in order and recalculation on open', async () => {
    const { files, text } = await build((w) => {
      w.addSheet('Resumo').end();
      w.addSheet("Justificativa da Alteração").end();
    });
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(text('xl/workbook.xml')).toContain('<sheet name="Resumo" sheetId="1" r:id="rId1"/>');
    expect(text('xl/workbook.xml')).toContain('<sheet name="Justificativa da Alteração" sheetId="2" r:id="rId2"/>');
    expect(text('xl/workbook.xml')).toContain('<calcPr calcId="191029" fullCalcOnLoad="1"/>');
  });

  it('writes inline strings (escaped), numbers, booleans, formulas without cached values and styles', async () => {
    let bold = 0;
    const { text, w } = await build((wr) => {
      bold = wr.styles.style({ font: { bold: true } });
      const s = wr.addSheet('Dados', { columns: [{ width: 20 }, { width: 10 }] });
      s.row([{ v: 'A & B <c> "d"', s: bold }, 12.5, true, null, { f: 'SUM(B1:B2)' }]);
      s.row(['linha\u0007com controle', 'texto _x0041_ literal']);
      s.end();
      expect(bold).toBeGreaterThan(0);
    });
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain(`<c r="A1" s="${bold}" t="inlineStr"><is><t xml:space="preserve">A &amp; B &lt;c&gt; &quot;d&quot;</t></is></c>`);
    expect(sheet).toContain('<c r="B1"><v>12.5</v></c>');
    expect(sheet).toContain('<c r="C1" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="E1"><f>SUM(B1:B2)</f></c>');
    expect(sheet).toContain('linha_x0007_com controle');
    expect(sheet).toContain('texto _x005F_x0041_ literal');
    expect(sheet).toContain('<cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="10" customWidth="1"/></cols>');
    expect(text('xl/styles.xml')).toContain('<font><b/><sz val="11"/><name val="Aptos"/></font>');
    expect(w.minDateSerial).toBeNull();
  });

  it('writes dates as serial numbers with a date format, never empty dates as zero', async () => {
    const { text, w } = await build((wr) => {
      const s = wr.addSheet('Datas');
      s.row([dateCell(parseDate('01/09/2026')), dateTimeCell(parseDateTime('01/09/2026 12:00:00')), dateCell(-2147483648)]);
      s.end();
    });
    const sheet = text('xl/worksheets/sheet1.xml');
    // 01/09/2026 = day 9740 since 01/01/2000 → Excel serial 36526 + 9740.
    expect(sheet).toMatch(/<c r="A1" s="\d+"><v>46266<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="B1" s="\d+"><v>46266.5<\/v><\/c>/);
    expect(sheet).not.toContain('r="C1"');
    expect(text('xl/styles.xml')).toContain('formatCode="dd/mm/yyyy"');
    expect(w.minDateSerial).toBe(46266);
  });

  it('writes freeze panes, autofilter, merges, validations, conditional formats, hyperlinks and defined names', async () => {
    const { text } = await build((w) => {
      const s = w.addSheet('Painel', { freeze: { rows: 1, cols: 1 }, autoFilter: 'A1:C10', showGridLines: false });
      s.row(['a', 'b', 'c']);
      s.merge('A3:C3');
      s.validation({ sqref: 'B2', type: 'list', formula1: 'Auxiliar!$A$2:$A$5' });
      s.validation({ sqref: 'C2', type: 'date', formula1: 'DATE(1990,1,1)', formula2: 'DATE(2100,12,31)' });
      s.conditional({ sqref: 'A2:A10', formula: 'LEN(TRIM($A2))=0', style: { fill: 'FFFFF2CC' } });
      s.link({ ref: 'A5', location: "'Documentos'!A1" });
      s.end();
      w.defineName('DT_INI', "Auxiliar!$B$3");
    });
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>');
    expect(sheet).toContain('showGridLines="0"');
    expect(sheet).toContain('<autoFilter ref="A1:C10"/>');
    expect(sheet).toContain('<mergeCells count="1"><mergeCell ref="A3:C3"/></mergeCells>');
    expect(sheet).toContain('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="B2"><formula1>Auxiliar!$A$2:$A$5</formula1></dataValidation>');
    expect(sheet).toContain('<formula1>DATE(1990,1,1)</formula1><formula2>DATE(2100,12,31)</formula2>');
    expect(sheet).toContain('<conditionalFormatting sqref="A2:A10"><cfRule type="expression" dxfId="0" priority="1"><formula>LEN(TRIM($A2))=0</formula></cfRule></conditionalFormatting>');
    expect(sheet).toContain('<hyperlinks><hyperlink ref="A5" location="\'Documentos\'!A1" display="\'Documentos\'!A1"/></hyperlinks>');
    // Element order required by Excel: sheetData, autoFilter, mergeCells, conditionalFormatting, dataValidations, hyperlinks.
    const order = ['</sheetData>', '<autoFilter', '<mergeCells', '<conditionalFormatting', '<dataValidations', '<hyperlinks', '<pageMargins'];
    const positions = order.map((tag) => sheet.indexOf(tag));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text('xl/workbook.xml')).toContain('<definedName name="DT_INI">Auxiliar!$B$3</definedName>');
    expect(text('xl/styles.xml')).toContain('<dxfs count="1"><dxf><fill><patternFill patternType="solid"><bgColor rgb="FFFFF2CC"/></patternFill></fill></dxf></dxfs>');
  });

  it('refuses overlapping merges (invariant 10)', () => {
    const w = new XlsxWriter();
    const s = w.addSheet('X');
    s.merge('A1:C2');
    expect(() => s.merge('B2:D3')).toThrow(/sobrepost/);
  });

  it('is deterministic: the same content gives the same bytes', async () => {
    const make = () =>
      build((w) => {
        const s = w.addSheet('X');
        for (let i = 0; i < 2000; i++) s.row([`linha ${i}`, i, { f: `B${i + 1}*2` }]);
        s.end();
      });
    const [a, b] = await Promise.all([make(), make()]);
    expect(new Uint8Array(await a.blob.arrayBuffer())).toEqual(new Uint8Array(await b.blob.arrayBuffer()));
  });
});
