/**
 * Generic synthetic .xlsx with arbitrary sheets (inline strings and numbers), for tests of workbooks other
 * than the CFGR700 report — e.g. a previous export with justification tabs. No real data.
 */
import { zipSync } from 'fflate';

export type SheetCell = string | number | null;

const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sheetXml(rows: SheetCell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${COLS[c]}${r + 1}`;
          if (v === null || v === '') return '';
          if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

export function buildWorkbook(sheets: Record<string, SheetCell[][]>): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const names = Object.keys(sheets);
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    '</Relationships>';
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': enc('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': enc(workbook),
    'xl/_rels/workbook.xml.rels': enc(rels),
  };
  names.forEach((n, i) => (entries[`xl/worksheets/sheet${i + 1}.xml`] = enc(sheetXml(sheets[n]!))));
  return zipSync(entries, { mtime: new Date(2026, 0, 1) });
}

export const workbookBlob = (sheets: Record<string, SheetCell[][]>) =>
  new Blob([buildWorkbook(sheets) as Uint8Array<ArrayBuffer>]);
