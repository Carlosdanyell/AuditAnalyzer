import { describe, expect, it } from 'vitest';
import { CellKind, SheetParser, type ParsedRow } from '../../src/worker/ingest/sheetStream';

const SHEET =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:J7"/>' +
  '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>' +
  '<row r="1" spans="1:10" ht="12"><c r="A1" s="2" t="s"><v>26</v></c><c r="E1" t="s"><v>30</v></c></row>' +
  '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t xml:space="preserve">a &amp; b</t></is></c>' +
  '<c r="E2" s="4"><v>1234567</v></c><c r="F2" t="str"><v>ção</v></c><c r="G2"/><c r="J2" t="b"><v>1</v></c></row>' +
  '<row r="5" spans="1:10"/>' +
  '<row r="6"><c t="s"><v>3</v></c><c t="s"><v>4</v></c><c r="L6" t="s"><v>9</v></c></row>' +
  '<row><c r="A7" t="inlineStr"><is><r><t>ri</t></r><r><t>co</t></r><rPh><t>X</t></rPh></is></c></row>' +
  '</sheetData><pageMargins left="0.7"/></worksheet>';

interface Snapshot {
  r: number;
  cells: Record<number, string>;
  extra: number;
}

function snapshot(r: number, row: ParsedRow): Snapshot {
  const cells: Record<number, string> = {};
  for (let c = 0; c < row.width; c++) {
    const kind = row.kind[c];
    if (kind === CellKind.Shared) cells[c] = `s:${row.sharedIndex[c]}`;
    else if (kind !== CellKind.Empty) cells[c] = `${kind}:${row.text[c]}`;
  }
  return { r, cells, extra: row.extraCells };
}

function parse(bytes: Uint8Array, chunk: number, width = 10) {
  const rows: Snapshot[] = [];
  const parser = new SheetParser((r, row) => rows.push(snapshot(r, row)), width);
  for (let i = 0; i < bytes.length; i += chunk) parser.push(bytes.subarray(i, i + chunk));
  parser.finish();
  return { rows, parser };
}

const EXPECTED: Snapshot[] = [
  { r: 1, cells: { 0: 's:26', 4: 's:30' }, extra: 0 },
  {
    r: 2,
    cells: { 0: 's:1', 1: `${CellKind.Text}:a & b`, 4: `${CellKind.Number}:1234567`, 5: `${CellKind.Text}:ção`, 9: `${CellKind.Other}:1` },
    extra: 0,
  },
  { r: 5, cells: {}, extra: 0 },
  { r: 6, cells: { 0: 's:3', 1: 's:4' }, extra: 1 },
  { r: 7, cells: { 0: `${CellKind.Text}:rico` }, extra: 0 },
];

describe('streaming sheet parser', () => {
  const bytes = new TextEncoder().encode(SHEET);

  it('reads rows, cell kinds, gaps, implicit references and the dimension', () => {
    const { rows, parser } = parse(bytes, bytes.length);
    expect(rows).toEqual(EXPECTED);
    expect(parser.dimension).toEqual({ lastRow: 7, lastColumn: 10 });
  });

  it.each([1, 2, 3, 7, 13, 64, 1000])('gives the same result with %i-byte chunks', (size) => {
    expect(parse(bytes, size).rows).toEqual(EXPECTED);
  });

  it('reports a missing dimension as null', () => {
    const noDim = new TextEncoder().encode(SHEET.replace('<dimension ref="A1:J7"/>', ''));
    expect(parse(noDim, 5).parser.dimension).toBeNull();
  });

  it('fails when the XML ends in the middle of the data', () => {
    const cut = bytes.subarray(0, SHEET.indexOf('<row r="6">') + 20);
    expect(() => parse(cut, 8)).toThrow();
  });

  it('accepts an empty sheet', () => {
    const empty = new TextEncoder().encode('<worksheet><dimension ref="A1"/><sheetData/></worksheet>');
    expect(parse(empty, 3).rows).toEqual([]);
  });
});
