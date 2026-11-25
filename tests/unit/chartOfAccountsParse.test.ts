/** Reading of the CSV of the chart of accounts (docs/REGRAS_PLANO_DE_CONTAS.md, section 3). */
import { describe, expect, it } from 'vitest';
import { CsvTokenizer, decodeChartBytes, parseChartBytes } from '../../src/worker/modules/chartOfAccounts/parse';
import { BASE_ACCOUNTS, CT1_COLUMNS, chartCsv, encodeWindows1252 } from '../synthetic/chartOfAccountsFixture';

const tokens = (text: string, chunks = [text]) => {
  const out: { line: number; fields: string[] }[] = [];
  const t = new CsvTokenizer((fields, line) => out.push({ line, fields }));
  for (const c of chunks) t.push(c);
  t.end();
  return out;
};

describe('chart of accounts: CSV tokenizer', () => {
  it('splits by ";" with CRLF or LF, keeping the physical line of each record', () => {
    expect(tokens('a;b\r\nc;d\n\ne;f')).toEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: ['c', 'd'] },
      { line: 3, fields: [''] },
      { line: 4, fields: ['e', 'f'] },
    ]);
  });

  it('reads fields between quotes: separator, doubled quote and line break inside', () => {
    expect(tokens('1;"A;B";"diz ""sim""";x\r\n2;"duas\r\nlinhas";y\r\n3;z')).toEqual([
      { line: 1, fields: ['1', 'A;B', 'diz "sim"', 'x'] },
      { line: 2, fields: ['2', 'duas\r\nlinhas', 'y'] },
      { line: 4, fields: ['3', 'z'] },
    ]);
  });

  it('gives the same records whatever the chunks (a CRLF or a quote split between two)', () => {
    const text = '1;"a;b"\r\n2;c\r\n3;"d""e"\r\n';
    const whole = tokens(text);
    for (let at = 1; at < text.length; at++) expect(tokens(text, [text.slice(0, at), text.slice(at)])).toEqual(whole);
  });
});

describe('chart of accounts: decoding', () => {
  it('falls back to windows-1252 when the bytes are not UTF-8 (–, Ç, º kept)', () => {
    const decoded = decodeChartBytes(encodeWindows1252('FUNDO FIXO – FILIAL;PRODUÇÃO;Nº 1'));
    expect(decoded).toEqual({ encoding: 'windows-1252', text: 'FUNDO FIXO – FILIAL;PRODUÇÃO;Nº 1' });
  });

  it('keeps UTF-8 when the strict decoding succeeds (BOM removed)', () => {
    const decoded = decodeChartBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Nº;–')]));
    expect(decoded).toEqual({ encoding: 'utf-8', text: 'Nº;–' });
  });
});

describe('chart of accounts: tables of the file', () => {
  it('finds the headers by content, maps the fields by name and trims every value', () => {
    const parsed = parseChartBytes(encodeWindows1252(chartCsv()));
    expect(parsed.encoding).toBe('windows-1252');
    expect(parsed.controlTables).toEqual(['CT1', 'CVD']);
    expect(parsed.ct1Header).toMatchObject({ line: 2, columns: CT1_COLUMNS.length + 1, missing: [] });
    expect(parsed.cvdHeader).toMatchObject({ line: 2 + BASE_ACCOUNTS.length + 1, columns: 12, missing: [] });
    expect(parsed.ct1).toHaveLength(39);
    expect(parsed.cvd).toHaveLength(12);
    const caixa = parsed.ct1.find((r) => r.fields.CT1_CONTA === '11101001')!;
    expect(caixa.line).toBe(7);
    expect(caixa.fields).toMatchObject({ CT1_DESC01: 'CAIXA GERAL', CT1_RES: '0000000001', CT1_CTASUP: '11101', CT1_DTEXIS: '20030101', CT1_DESC02: '', CT1_DC: '7' });
    expect(parsed.ct1.find((r) => r.fields.CT1_CONTA === '11101002')!.fields.CT1_DESC01).toBe('FUNDO FIXO – FILIAL');
    expect(parsed.cvd[0]).toMatchObject({ line: 43, fields: { CVD_CONTA: '11101001', CVD_CTAREF: '1.01.01.01.01', CVD_CTASUP: '1.01.01.01', CVD_CODPLA: '006' } });
    expect(parsed.lines).toBe(2 + 39 + 1 + 12);
    expect(parsed.ignored).toEqual([]);
    expect(parsed.widthMismatch).toEqual([]);
  });

  it('reads a header in another column order the same way, and LF line ends', () => {
    // CT1_FILIAL stays in the second column: it is what marks the header.
    const reordered = [CT1_COLUMNS[0], ...CT1_COLUMNS.slice(1).reverse()];
    const a = parseChartBytes(encodeWindows1252(chartCsv()));
    const b = parseChartBytes(encodeWindows1252(chartCsv({ ct1Columns: reordered, eol: '\n' })));
    expect(b.ct1.map((r) => r.fields)).toEqual(a.ct1.map((r) => r.fields));
  });

  it('ignores blank lines, counting them, and keeps the numbering of the file', () => {
    const parsed = parseChartBytes(encodeWindows1252(chartCsv({ blankLines: 2 })));
    expect(parsed.blankLines).toBe(2);
    expect(parsed.cvdHeader!.line).toBe(2 + 39 + 2 + 1);
    expect(parsed.cvd).toHaveLength(12);
  });

  it('lists a missing used field of each header', () => {
    const parsed = parseChartBytes(encodeWindows1252(chartCsv({ ct1Columns: CT1_COLUMNS.filter((c) => c !== 'CT1_NTSPED' && c !== 'CT1_DTEXIS') })));
    expect(parsed.ct1Header!.missing).toEqual(['CT1_NTSPED', 'CT1_DTEXIS']);
  });

  it('notes records of an unknown type, before their header and with another number of fields', () => {
    const text = ['0;CT1;CVD', '1;01;99', '1;' + CT1_COLUMNS.join(';'), '1;01;11', '7;x', '2;01;11101001;10'].join('\r\n');
    const parsed = parseChartBytes(new TextEncoder().encode(text));
    expect(parsed.ct1Header!.line).toBe(3);
    expect(parsed.cvdHeader).toBeNull();
    expect(parsed.ignored).toEqual([
      { line: 2, reason: 'beforeHeader' },
      { line: 5, reason: 'unknownType' },
      { line: 6, reason: 'beforeHeader' },
    ]);
    expect(parsed.widthMismatch).toEqual([{ table: 'CT1', line: 4, fields: 3, expected: CT1_COLUMNS.length + 1 }]);
    expect(parsed.ct1[0]!.fields.CT1_CONTA).toBe('11');
  });
});
