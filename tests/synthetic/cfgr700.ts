/**
 * Synthetic CFGR700 workbook generator. Produces small .xlsx files with the same structure as the
 * real report (Parametros sheet + report sheet, shared strings, repeated headers, missing rows),
 * plus switches for the edge cases the reader must handle. No real data.
 */
import { zipSync, type Zippable } from 'fflate';

export type SynthRow =
  | { kind: 'header' }
  | { kind: 'blank'; withContent?: boolean }
  | { kind: 'gap'; count: number }
  | {
      kind: 'detail';
      field: string;
      oldValue?: string;
      newValue?: string;
      dataType?: string;
      recno: number | string;
      user?: string;
      operation: string;
      dateTime: string;
      status?: string;
      protectedType?: string;
    };

export interface SynthOptions {
  rows: SynthRow[];
  /** Parameter answers, keyed by question label (without "Pergunta NN :" and "?"). */
  parameters?: Record<string, string>;
  reportSheetName?: string;
  /** File name of the report sheet inside xl/worksheets/. */
  reportSheetFile?: string;
  /** Put xl/sharedStrings.xml after the worksheets in the ZIP. */
  sharedStringsLast?: boolean;
  omitDimension?: boolean;
  /** Store entries without compression (method 0). */
  stored?: boolean;
  /** Write text cells of detail rows as inline strings instead of shared strings. */
  inlineStrings?: boolean;
  /** Write every shared string as rich text runs with a phonetic run that must be ignored. */
  richText?: boolean;
  /** Write Recno as a shared string instead of a number. */
  recnoAsText?: boolean;
}

export const HEADER = [
  'Campo',
  'Vlr Antigo',
  'Vlr Atualizado',
  'Tipo Dados',
  'Recno',
  'Usuario',
  'Operacao',
  'Data Hora',
  'Situacao',
  'Tipo Dado Protegido',
];

export const DEFAULT_PARAMETERS: Record<string, string> = {
  'Tabela início': 'CT2',
  'Tabela fim': 'CT2',
  Campo: '',
  'Usuário': '',
  Rotina: '',
  'Data inicial': '01/09/2026',
  'Data final': '30/09/2026',
  'Operação de inclusão': 'Sim',
  'Operação de alteração': 'Sim',
  'Operação de exclusão': 'Sim',
  Registro: '',
  'Situação': 'Todas',
  'Operação de Recuperação': 'Sim',
  'Exclui campos não alterados': 'Sim',
  'Dados Protegidos': 'Sem restrição',
  'Destacar Dados Protegidos': 'Não',
};

const COLS = 'ABCDEFGHIJ';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** OOXML escaping of control characters (_xHHHH_) and of literal "_xHHHH_" sequences. */
function escapeOoxml(s: string): string {
  return escapeXml(
    s
      .replace(/_x[0-9A-Fa-f]{4}_/g, (m) => `_x005F${m}`)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]|\r/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`),
  );
}

class SharedStrings {
  private readonly index = new Map<string, number>();
  readonly list: string[] = [];
  count = 0;

  ref(s: string): number {
    this.count++;
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.index.set(s, i);
      this.list.push(s);
    }
    return i;
  }

  xml(richText: boolean): string {
    const items = this.list.map((s) => {
      const space = s !== s.trim() ? ' xml:space="preserve"' : '';
      if (!richText || s.length < 2) return `<si><t${space}>${escapeOoxml(s)}</t></si>`;
      const half = Math.ceil(s.length / 2);
      const [a, b] = [s.slice(0, half), s.slice(half)];
      return (
        `<si><r><rPr><b/></rPr><t xml:space="preserve">${escapeOoxml(a)}</t></r>` +
        `<r><t xml:space="preserve">${escapeOoxml(b)}</t></r>` +
        `<rPh sb="0" eb="1"><t>IGNORAR</t></rPh></si>`
      );
    });
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.count}" uniqueCount="${this.list.length}">` +
      items.join('') +
      '</sst>'
    );
  }
}

function sheetXml(rows: string[], lastRow: number, lastCol: string, omitDimension: boolean): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">' +
    (omitDimension ? '' : `<dimension ref="A1:${lastCol}${lastRow}"/>`) +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="12"/>' +
    `<sheetData>${rows.join('')}</sheetData>` +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'
  );
}

export function buildCfgr700(options: SynthOptions): Uint8Array {
  const sst = new SharedStrings();
  const reportSheetFile = options.reportSheetFile ?? 'sheet2.xml';
  const reportSheetName = options.reportSheetName ?? '15-01 - Relatório de auditoria';

  const textCell = (ref: string, value: string, inline: boolean) =>
    inline
      ? `<c r="${ref}" s="3" t="inlineStr"><is><t xml:space="preserve">${escapeOoxml(value)}</t></is></c>`
      : `<c r="${ref}" s="3" t="s"><v>${sst.ref(value)}</v></c>`;

  // Parameters sheet, laid out like the real report.
  const params = { ...DEFAULT_PARAMETERS, ...options.parameters };
  const paramRows: string[] = [
    `<row r="1">${textCell('A1', 'Dt.Ref: 01/01/2030', false)}</row>`,
    `<row r="3">${textCell('A3', 'Hora: 12:00:00', false)}</row>`,
    `<row r="5">${textCell('A5', 'Emissão: 01/01/2030', false)}</row>`,
  ];
  Object.entries(params).forEach(([label, value], i) => {
    const r = 8 + i;
    const n = String(i + 1).padStart(2, '0');
    paramRows.push(`<row r="${r}">${textCell(`A${r}`, `Pergunta ${n} : ${label} ?`, false)}${textCell(`B${r}`, value, false)}</row>`);
  });
  const paramsXml = sheetXml(paramRows, 7 + Object.keys(params).length, 'B', false);

  // Report sheet.
  const reportRows: string[] = [];
  let r = 0;
  for (const row of options.rows) {
    if (row.kind === 'gap') {
      r += row.count;
      continue;
    }
    r++;
    let cells: string[];
    if (row.kind === 'header') {
      cells = HEADER.map((h, i) => textCell(`${COLS[i]}${r}`, h, false));
    } else if (row.kind === 'blank') {
      cells = HEADER.map((_, i) => textCell(`${COLS[i]}${r}`, row.withContent && i === 1 ? 'resto' : '', false));
    } else {
      const inline = options.inlineStrings ?? false;
      const values = [
        row.field,
        row.oldValue ?? '',
        row.newValue ?? '',
        row.dataType ?? 'C',
        null,
        row.user ?? '',
        row.operation,
        row.dateTime,
        row.status ?? 'Ativo',
        row.protectedType ?? '',
      ];
      cells = values.map((v, i) => {
        const ref = `${COLS[i]}${r}`;
        if (v !== null) return textCell(ref, v, inline);
        return options.recnoAsText || typeof row.recno === 'string'
          ? textCell(ref, String(row.recno), false)
          : `<c r="${ref}" s="4"><v>${row.recno}</v></c>`;
      });
    }
    reportRows.push(`<row r="${r}" spans="1:10" ht="12" x14ac:dyDescent="0.2">${cells.join('')}</row>`);
  }
  const reportXml = sheetXml(reportRows, r, 'J', options.omitDimension ?? false);

  const enc = (s: string) => new TextEncoder().encode(s);
  const level = options.stored ? 0 : 6;
  const file = (s: string): [Uint8Array, { level: 0 | 6 }] => [enc(s), { level }];

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    `<sheet name="Parametros" sheetId="1" r:id="rId1"/>` +
    `<sheet name="${escapeXml(reportSheetName)}" sheetId="2" r:id="rId2"/>` +
    '</sheets></workbook>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${reportSheetFile}"/>` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>';
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/></Types>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const sstXml = sst.xml(options.richText ?? false);
  const entries: Zippable = {
    '[Content_Types].xml': file(contentTypes),
    '_rels/.rels': file(rootRels),
    'xl/workbook.xml': file(workbook),
    'xl/_rels/workbook.xml.rels': file(rels),
  };
  if (!options.sharedStringsLast) entries['xl/sharedStrings.xml'] = file(sstXml);
  entries['xl/worksheets/sheet1.xml'] = file(paramsXml);
  entries[`xl/worksheets/${reportSheetFile}`] = file(reportXml);
  if (options.sharedStringsLast) entries['xl/sharedStrings.xml'] = file(sstXml);

  // Fixed timestamp: the generated bytes are deterministic.
  return zipSync(entries, { mtime: new Date(2026, 0, 1) });
}

/** A Blob of a synthetic workbook, as the ingestion receives it from a File. */
export function synthBlob(options: SynthOptions): Blob {
  return new Blob([buildCfgr700(options) as Uint8Array<ArrayBuffer>]);
}
