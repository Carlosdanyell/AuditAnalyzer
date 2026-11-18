import { describe, expect, it } from 'vitest';
import { CellKind, SheetFormatError, type ParsedRow } from '../../src/worker/ingest/sheetStream';
import { XmlSpreadsheetParser, serialFromXmlDateTime, xmlDeclaredEncoding, type XmlSheetInfo } from '../../src/worker/ingest/xmlSpreadsheet';

/** Streaming reader of the XML Spreadsheet 2003 format (docs/REGRAS_CT2_INTEGRIDADE.md, section 2.1). */
type Cell = [kind: number, text: string];
interface Seen {
  sheets: XmlSheetInfo[];
  rows: { sheet: number; r: number; cells: Record<number, Cell>; extraCells: number; extras: string[] }[];
}

const KIND = Object.fromEntries(Object.entries(CellKind).map(([k, v]) => [v, k]));

function parse(xml: string, o: { width?: number; chunk?: number; headRows?: number } = {}): Seen & { parser: XmlSpreadsheetParser } {
  const seen: Seen = { sheets: [], rows: [] };
  const parser = new XmlSpreadsheetParser(
    {
      onSheet: (s) => seen.sheets.push({ ...s }),
      onRow: (sheet: number, r: number, row: ParsedRow) => {
        const cells: Record<number, Cell> = {};
        for (let c = 0; c < row.width; c++) if (row.kind[c] !== CellKind.Empty) cells[c] = [row.kind[c]!, row.text[c]!];
        seen.rows.push({ sheet, r, cells, extraCells: row.extraCells, extras: row.extraText.slice(0, row.extras) });
      },
    },
    o.width ?? 8,
    o.headRows === undefined ? {} : { headRows: o.headRows },
  );
  const size = o.chunk ?? xml.length;
  for (let i = 0; i < xml.length; i += size) parser.push(xml.slice(i, i + size));
  parser.finish();
  // ss:ExpandedRowCount comes with the <Table>, after the start of the worksheet.
  return { ...seen, sheets: parser.sheets, parser };
}

const book = (sheets: string) =>
  '<?xml version="1.0" encoding="UTF-8" ?>\r\n<?mso-application progid="Excel.Sheet"?>\r\n' +
  '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\r\n' +
  '<Styles><Style ss:ID="Default"><Font ss:FontName="Courier New"/></Style></Styles>\r\n' +
  sheets +
  '\r\n</Workbook>\r\n';
const sheet = (name: string, rows: string, table = '<Table>') => `<Worksheet ss:Name="${name}">${table}${rows}</Table></Worksheet>`;

describe('XML Spreadsheet 2003: rows and cells', () => {
  const xml = book(
    sheet(
      'SCADYFW0.XML',
      '<Row ss:Index="1"><Cell><Data ss:Type="String"><![CDATA[CT2]]></Data></Cell></Row>\r\n' +
        '<Row ss:Index="3"><Cell ss:StyleID="s00"><Data ss:Type="String"><![CDATA[Data Lcto ]]></Data></Cell>' +
        '<Cell><Data ss:Type="String"><![CDATA[Valor ]]></Data></Cell><Cell ss:Index="4"><Data ss:Type="String">Hist &amp; &lt;x&gt; &#225;</Data></Cell></Row>\r\n' +
        '<Row ss:Index="4"><Cell ss:Index="1" ss:StyleID="s1"><Data ss:Type="DateTime">2026-09-15T00:00:00.000</Data></Cell>' +
        '<Cell ss:Index="2"><Data ss:Type="Number">1234.5</Data></Cell>' +
        '<Cell ss:Index="3"><Data ss:Type="String"><![CDATA[]]></Data></Cell>' +
        '<Cell ss:Index="4"><Data ss:Type="String"><![CDATA[a <b> ]] c]]></Data></Cell></Row>\r\n' +
        '<Row/>\r\n' +
        '<Row><Cell ss:MergeAcross="1"><Data ss:Type="String">dois</Data></Cell><Cell><Data ss:Type="Boolean">1</Data></Cell></Row>',
    ),
  );

  it('reads the row and cell positions (ss:Index or implied), the types and the texts', () => {
    const { sheets, rows } = parse(xml);
    expect(sheets).toEqual([{ index: 0, name: 'SCADYFW0.XML', expandedRowCount: null }]);
    expect(rows.map((r) => r.r)).toEqual([1, 3, 4, 5, 6]);
    expect(rows[0]!.cells).toEqual({ 0: [CellKind.Text, 'CT2'] });
    expect(rows[1]!.cells).toEqual({ 0: [CellKind.Text, 'Data Lcto '], 1: [CellKind.Text, 'Valor '], 3: [CellKind.Text, 'Hist & <x> á'] });
    // The date becomes the serial number Excel would store; an empty text is an empty cell.
    expect(rows[2]!.cells).toEqual({ 0: [CellKind.Number, '46280'], 1: [CellKind.Number, '1234.5'], 3: [CellKind.Text, 'a <b> ]] c'] });
    expect(rows[3]!.cells).toEqual({});
    // A merged cell takes its columns: the next cell is the third.
    expect(rows[4]!.cells).toEqual({ 0: [CellKind.Text, 'dois'], 2: [CellKind.Other, '1'] });
    expect(KIND[rows[4]!.cells[2]![0]]).toBe('Other');
  });

  it('gives the same rows whatever the size of the pieces of text', () => {
    const whole = parse(xml).rows;
    for (const chunk of [1, 2, 3, 7, 64]) expect(parse(xml, { chunk }).rows).toEqual(whole);
  });

  it('keeps the cells beyond the width as extra cells', () => {
    const wide = book(sheet('A', '<Row><Cell ss:Index="2"><Data ss:Type="String">b</Data></Cell><Cell ss:Index="5"><Data ss:Type="String">e</Data></Cell><Cell ss:Index="6"/></Row>'));
    const { rows } = parse(wide, { width: 3 });
    expect(rows[0]).toMatchObject({ cells: { 1: [CellKind.Text, 'b'] }, extraCells: 2, extras: ['e'] });
  });

  it('reads the text of formatted cells and of the ss: prefix, and ignores comments and page breaks', () => {
    const rich = book(
      '<ss:Worksheet ss:Name="R"><ss:Table ss:ExpandedRowCount="2"><ss:Row><ss:Cell><ss:Data ss:Type="String" xmlns="http://www.w3.org/TR/REC-html40"><B>neg</B>rito</ss:Data>' +
        '<Comment><Data>nota</Data></Comment></ss:Cell></ss:Row><!-- <Row><Cell><Data ss:Type="String">x</Data></Cell></Row> --></ss:Table>' +
        '<WorksheetOptions><PageBreaks><RowBreaks><RowBreak><Row>5</Row></RowBreak></RowBreaks></PageBreaks></WorksheetOptions></ss:Worksheet>',
    );
    const { rows, sheets } = parse(rich);
    expect(sheets).toEqual([{ index: 0, name: 'R', expandedRowCount: 2 }]);
    expect(rows).toEqual([{ sheet: 0, r: 1, cells: { 0: [CellKind.Text, 'negrito'] }, extraCells: 0, extras: [] }]);
  });

  it('reads every worksheet, with its index', () => {
    const two = book(sheet('Parametros', '<Row><Cell><Data ss:Type="String">p</Data></Cell></Row>') + sheet('Dados', '<Row ss:Index="2"><Cell><Data ss:Type="Number">7</Data></Cell></Row>'));
    const { rows, sheets } = parse(two);
    expect(sheets.map((s) => s.name)).toEqual(['Parametros', 'Dados']);
    expect(rows.map((r) => [r.sheet, r.r])).toEqual([[0, 1], [1, 2]]);
  });

  it('in head mode reads only the first rows of each worksheet and still finds the next ones', () => {
    const rowsXml = Array.from({ length: 50 }, (_, i) => `<Row><Cell><Data ss:Type="Number">${i}</Data></Cell></Row>`).join('');
    const { rows, sheets } = parse(book(sheet('A', rowsXml) + sheet('B', rowsXml)), { headRows: 3 });
    expect(sheets.map((s) => s.name)).toEqual(['A', 'B']);
    expect(rows.map((r) => [r.sheet, r.r])).toEqual([[0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 3]]);
  });
});

describe('XML Spreadsheet 2003: a file that is not whole', () => {
  it('fails when the file ends before </Workbook> (a transfer that stopped)', () => {
    const xml = book(sheet('A', '<Row><Cell><Data ss:Type="String">a</Data></Cell></Row>'));
    for (const cut of [xml.indexOf('</Table>'), xml.indexOf('</Workbook>'), xml.indexOf('<Data') + 3]) {
      expect(() => parse(xml.slice(0, cut))).toThrow(SheetFormatError);
    }
    expect(() => parse('<html><body>não é planilha</body></html>')).toThrow(/Workbook/);
  });

  it('fails on a cell or a row without its end, and on cells out of order', () => {
    expect(() => parse(book(sheet('A', '<Row><Cell><Data ss:Type="String">a</Data></Row>')))).toThrow(SheetFormatError);
    expect(() => parse(book(sheet('A', '<Row><Cell ss:Index="3"/><Cell ss:Index="2"/></Row>')))).toThrow(/ordem/);
  });
});

describe('XML Spreadsheet 2003: values', () => {
  it('turns DateTime into the Excel serial (time as the fraction of the day)', () => {
    expect(serialFromXmlDateTime('2026-09-15T00:00:00.000')).toBe('46280');
    expect(serialFromXmlDateTime('2000-01-01T00:00:00')).toBe('36526');
    expect(serialFromXmlDateTime('2026-09-15T12:00:00.000')).toBe('46280.5');
    expect(serialFromXmlDateTime('2026-02-30T00:00:00.000')).toBeNull();
    expect(serialFromXmlDateTime('15/09/2026')).toBeNull();
  });

  it('reads the encoding of the XML declaration (UTF-8 when absent or with a byte order mark)', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(xmlDeclaredEncoding(enc('<?xml version="1.0" encoding="ISO-8859-1" ?><Workbook>'))).toBe('iso-8859-1');
    expect(xmlDeclaredEncoding(enc("<?xml version='1.0' encoding='windows-1252'?>"))).toBe('windows-1252');
    expect(xmlDeclaredEncoding(enc('<?xml version="1.0"?><Workbook>'))).toBe('utf-8');
    expect(xmlDeclaredEncoding(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('<?xml version="1.0" encoding="ISO-8859-1"?>')]))).toBe('utf-8');
    expect(xmlDeclaredEncoding(enc('<Workbook>'))).toBe('utf-8');
  });
});
