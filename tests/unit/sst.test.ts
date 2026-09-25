import { describe, expect, it } from 'vitest';
import { SharedStringsParser } from '../../src/worker/ingest/sst';
import { decodeOoxmlEscapes, decodeXmlEntities } from '../../src/worker/ingest/xmlText';

const XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="9" uniqueCount="7">' +
  '<si><t>Campo</t></si>' +
  '<si><t/></si>' +
  '<si><t xml:space="preserve"> com espaços </t></si>' +
  '<si><r><rPr><b/></rPr><t>Ri</t></r><r><t xml:space="preserve">co</t></r><rPh sb="0" eb="1"><t>FON</t></rPh></si>' +
  '<si><t>A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos; &#65;&#x42;</t></si>' +
  '<si><t>linha_x000D_quebra _x005F_x0041_ literal</t></si>' +
  '<si/>' +
  '</sst>';

const EXPECTED = ['Campo', '', ' com espaços ', 'Rico', 'A & B <C> "D" \'E\' AB', 'linha\rquebra _x0041_ literal', ''];

function parseInChunks(xml: string, size: number): string[] {
  const parser = new SharedStringsParser();
  for (let i = 0; i < xml.length; i += size) parser.push(xml.slice(i, i + size));
  return parser.finish();
}

describe('shared strings parser', () => {
  it('parses plain, rich (ignoring phonetic runs), empty and escaped strings', () => {
    const parser = new SharedStringsParser();
    parser.push(XML);
    expect(parser.finish()).toEqual(EXPECTED);
    expect(parser.declaredUniqueCount).toBe(7);
  });

  it.each([1, 2, 3, 5, 17, 64])('gives the same result when fed in %i-character chunks', (size) => {
    expect(parseInChunks(XML, size)).toEqual(EXPECTED);
  });

  it('fails on a truncated file', () => {
    const parser = new SharedStringsParser();
    parser.push(XML.slice(0, XML.indexOf('<si><r>') + 10));
    expect(() => parser.finish()).toThrow();
  });
});

describe('XML text decoding', () => {
  it('decodes entities and leaves unknown ones untouched', () => {
    expect(decodeXmlEntities('a&amp;b&#x1F600;&unknown;')).toBe('a&b😀&unknown;');
  });

  it('decodes _xHHHH_ escapes and the _x005F_ escape of a literal', () => {
    expect(decodeOoxmlEscapes('_x0009_tab_x005F_x0009_')).toBe('\ttab_x0009_');
  });
});
