/**
 * Large synthetic CT2 extraction for the measurements (docs/MEDICOES.md): written in parts to a sink, never held
 * whole in memory, with the expected totals computed while writing. Same layout as ct2Extraction.ts (titles in row
 * 3, ~80 columns, shared strings, codes as text, dates as Excel serials, amounts as numbers); documents of 1 to 6
 * lines, one document of 1,100 lines (lines after 999: A00, A01, ...), two currencies and two balance types,
 * history continuation lines. Deterministic for the same options. No real data.
 */
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { parseDate } from '../../src/shared/dates';
import type { Ct2Segment } from '../../src/shared/modules/ct2Integrity';
import { CT2_COLUMNS, columnRef } from './ct2Extraction';

export interface LargeCt2Options {
  /** Detail rows to write (the last document may end a few rows after). */
  rows: number;
  seed: number;
  /** First entry date (dd/mm/aaaa); documents spread over `days` consecutive days. */
  firstDate: string;
  days: number;
  /** Batch numbers start here (distinct batches for each file of a set). */
  firstBatch: number;
}

export interface LargeCt2Expected {
  detailRows: number;
  segments: Ct2Segment[];
  documents: number;
  batches: number;
  days: number;
  bytes: number;
}

/** Excel serial of a day number (1900 date system). */
const serialOf = (day: number) => day + 36526;
const pad = (n: number, width: number) => String(n).padStart(width, '0');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Line code: 001-999, then A00-A99, B00, ... (docs/REGRAS_CT2_INTEGRIDADE.md, section 3). */
const lineCode = (n: number) => (n <= 999 ? pad(n, 3) : String.fromCharCode(65 + Math.floor((n - 1000) / 100)) + pad((n - 1000) % 100, 2));

/** Mulberry32: small deterministic generator. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const enc = new TextEncoder();

export function writeLargeCt2(sink: (chunk: Uint8Array) => void, o: LargeCt2Options): LargeCt2Expected {
  const rand = random(o.seed);
  const int = (n: number) => Math.floor(rand() * n);
  let bytes = 0;
  let failure: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) failure = err;
    bytes += data.length;
    sink(data);
  });

  // Shared strings, in order of first use.
  const strings: string[] = [];
  const index = new Map<string, number>();
  const shared = (s: string): number => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };

  const width = CT2_COLUMNS.length;
  const refs = Array.from({ length: width }, (_, c) => columnRef(c));
  const sheet = new ZipDeflate('xl/worksheets/sheet1.xml', { level: 1 });
  zip.add(sheet);
  let buffer = '';
  const flush = (final = false) => {
    sheet.push(enc.encode(buffer), final);
    buffer = '';
  };
  // The dimension is written first: the last row is known in advance only up to the end of the last document, so it
  // is left out (the reading then relies on the rows themselves).
  buffer += '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  buffer += `<row r="1"><c r="A1" t="s"><v>${shared('CT2 - Lancamentos Contabeis')}</v></c></row>`;
  buffer += `<row r="3">${CT2_COLUMNS.map((t, c) => `<c r="${refs[c]}3" t="s"><v>${shared(t)}</v></c>`).join('')}</row>`;

  const text = (c: number, r: number, s: string) => `<c r="${refs[c]}${r}" t="s"><v>${shared(s)}</v></c>`;
  const num = (c: number, r: number, v: number) => `<c r="${refs[c]}${r}"><v>${v}</v></c>`;
  const space = shared(' ');
  const blank = (c: number, r: number) => `<c r="${refs[c]}${r}" t="s"><v>${space}</v></c>`;

  const firstDay = parseDate(o.firstDate);
  const rowsPerDay = Math.ceil(o.rows / o.days);
  const segments = new Map<string, Ct2Segment>();
  const dayKeys = new Set<string>();
  const batchKeys = new Set<string>();
  let documents = 0;
  let r = 3;
  let detail = 0;
  let sequence = 0;
  let batch = o.firstBatch;
  let documentInBatch = 0;
  let currentDay = -1;
  let hugeWritten = false;

  while (detail < o.rows) {
    const day = firstDay + Math.min(o.days - 1, Math.floor(detail / rowsPerDay));
    if (day !== currentDay || documentInBatch >= 60) {
      if (day !== currentDay) currentDay = day;
      batch++;
      documentInBatch = 0;
    }
    documentInBatch++;
    const currency = rand() < 0.08 ? '02' : '01';
    const balanceType = rand() < 0.03 ? '9' : '1';
    const segmentKey = `${balanceType}|${currency}`;
    let segment = segments.get(segmentKey);
    if (!segment) {
      segment = { balanceType, currency, lines: 0, documents: 0, debitCents: 0, creditCents: 0 };
      segments.set(segmentKey, segment);
    }
    segment.documents++;
    documents++;
    dayKeys.add(`${segmentKey}|${day}`);
    batchKeys.add(`${segmentKey}|${day}|${batch}`);

    // Lines of the document: [entry type, cents or null].
    const lines: [string, number | null][] = [];
    const huge = !hugeWritten && detail >= o.rows / 2;
    if (huge) {
      hugeWritten = true;
      for (let i = 0; i < 550; i++) {
        const cents = 1 + int(500_000);
        lines.push(['Debito', cents], ['Credito', cents]);
      }
    } else {
      const shape = int(10);
      const cents = 1 + int(10_000_000);
      if (shape < 4) lines.push(['Partida Dobrada', cents]);
      else if (shape < 8) lines.push(['Debito', cents], ['Credito', cents]);
      else lines.push(['Partida Dobrada', cents], ['Cont.Hist', null]);
      for (let extra = int(3); extra > 0; extra--) {
        const more = 1 + int(1_000_000);
        lines.push(['Debito', more], ['Credito', more]);
      }
    }

    const document = pad(documentInBatch, 6);
    const historyBase = `LANCAMENTO SINTETICO ${pad(int(5000), 4)}`;
    lines.forEach(([type, cents], i) => {
      r++;
      detail++;
      sequence++;
      segment.lines++;
      if (cents !== null) {
        if (type !== 'Credito') segment.debitCents += cents;
        if (type !== 'Debito') segment.creditCents += cents;
      }
      const amount = cents === null ? null : cents / 100;
      const history = rand() < 0.5 ? `${historyBase} DOC ${document} LINHA ${i + 1}`.padEnd(40) : historyBase.padEnd(40);
      const cells = [
        num(0, r, serialOf(day)),
        text(1, r, pad(batch, 6)),
        text(2, r, '001'),
        text(3, r, document),
        text(4, r, lineCode(i + 1)),
        text(5, r, balanceType),
        text(6, r, currency),
        text(7, r, type),
        type === 'Credito' || type === 'Cont.Hist' ? blank(8, r) : text(8, r, `1${pad(int(3000), 7)}`),
        type === 'Debito' || type === 'Cont.Hist' ? blank(9, r) : text(9, r, `2${pad(int(3000), 7)}`),
        amount === null ? '' : num(10, r, amount),
        text(11, r, history),
        amount === null ? '' : num(12, r, amount),
        text(13, r, int(4) === 0 ? 'CTBA102' : 'FINA370'),
        blank(14, r),
        text(15, r, pad(sequence, 10)),
        text(16, r, int(4) === 0 ? '1' : '2'),
        blank(17, r),
        text(18, r, '01'),
        text(19, r, '01'),
        // Other columns of the extraction.
        text(20, r, '01'),
        text(21, r, `CC${pad(int(300), 4)}`),
        blank(22, r),
        blank(23, r),
        blank(24, r),
        blank(25, r),
        blank(26, r),
        amount === null ? '' : num(27, r, Math.round(amount * 20) / 100),
        num(28, r, 0),
        num(29, r, 0),
        num(30, r, 0),
        text(31, r, '1'),
        num(32, r, serialOf(day)),
        num(33, r, sequence),
        text(34, r, '001'),
        blank(35, r),
        blank(36, r),
        blank(37, r),
        num(38, r, serialOf(day)),
        text(39, r, 'N'),
        ...Array.from({ length: 20 }, (_, k) => blank(40 + k, r)),
      ];
      buffer += `<row r="${r}">${cells.join('')}</row>`;
      if (buffer.length > 1 << 20) flush();
    });
  }
  buffer += '</sheetData></worksheet>';
  flush(true);

  const sst = new ZipDeflate('xl/sharedStrings.xml', { level: 1 });
  zip.add(sst);
  sst.push(
    enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">`,
    ),
  );
  for (let i = 0; i < strings.length; i += 10_000) {
    sst.push(enc.encode(strings.slice(i, i + 10_000).map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')));
  }
  sst.push(enc.encode('</sst>'), true);

  const small = (name: string, content: string) => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(enc.encode(content), true);
  };
  small('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  small(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SCACKST0.XML" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  small(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '</Relationships>',
  );
  zip.end();
  if (failure) throw failure;

  const sorted = [...segments.values()].sort((a, b) => (a.balanceType + a.currency < b.balanceType + b.currency ? -1 : 1));
  return { detailRows: detail, segments: sorted, documents, batches: batchKeys.size, days: dayKeys.size, bytes };
}
