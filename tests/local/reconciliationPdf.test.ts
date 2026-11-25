/**
 * The real PDFs in local/conciliador/ (docs/FASE_16_CONCILIADOR_PROVISOES_PDF.md, sections 5 step 4 and 6.3; never
 * versioned), read by the PDF adapter (formats/pdf.ts, rules 3.3 and 3.4):
 * - GPER070 and GPER090: the lines of the grid = the normalized lines of the TXT of the same report, except the
 *   separation lines and the page headers (only in the TXT) and the accents (U+FFFD in the TXT); compared as lines
 *   (the readers of the provisions come in step 2);
 * - the net-pay ledger: the PDF reads to the same records as its TXT and its XML (V-2), its invariants passing;
 * - the ledger of the provision accounts (PDF only): read without V-1, R-1 to R-6 passing for every account.
 * Prints to the console only (counts, balances by account, time and memory); skipped without the files.
 */
import { existsSync, openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPdfLines, type PdfReading } from '../../src/worker/modules/reconciliation/formats/pdf';
import { readSpoolLines } from '../../src/worker/modules/reconciliation/formats/text';
import { readSpreadsheetRows } from '../../src/worker/modules/reconciliation/formats/spreadsheetml';
import { readingDivergence } from '../../src/worker/modules/reconciliation/ledger';
import { LedgerSheetReader, LedgerTextReader, balanceText, competenceDays, ledgerReadingChecks, type LedgerReading } from '../../src/worker/modules/reconciliation/reports/ctbr400';
import { localDir } from './realFiles';

const dir = join(localDir, 'conciliador');
const file = (name: string) => join(dir, name);
const has = (...names: string[]) => names.every((n) => existsSync(file(n)));

/** Separation lines and page headers of the spool: drawing and proportional text in the PDF (3.3). */
const isSeparator = (line: string) => line.startsWith('*') || /^[-#*=\s]*$/.test(line);
/** Accents: the TXT has U+FFFD (or a windows-1252 letter) where the PDF has the accented letter (3.3). */
const sameLine = (txt: string, pdf: string) => {
  if (txt === pdf) return true;
  if (txt.length !== pdf.length) return false;
  for (let i = 0; i < txt.length; i++) if (txt[i] !== pdf[i] && !(txt[i] === '�' && pdf.charCodeAt(i) > 0x7f)) return false;
  return true;
};

interface Measured<T> {
  value: T;
  ms: number;
  heapMb: number;
  /** Resident memory of the process before the reading and its peak during it. */
  rssBeforeMb: number;
  peakMb: number;
}

/** Time, retained heap and peak resident memory of a reading (sampled every 20 ms). */
async function measured<T>(run: () => Promise<T>): Promise<Measured<T>> {
  globalThis.gc?.();
  const heap = process.memoryUsage().heapUsed;
  const before = process.memoryUsage().rss;
  let peak = before;
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 20);
  const start = performance.now();
  try {
    const value = await run();
    return { value, ms: performance.now() - start, heapMb: (process.memoryUsage().heapUsed - heap) / 1048576, rssBeforeMb: before / 1048576, peakMb: Math.max(peak, process.memoryUsage().rss) / 1048576 };
  } finally {
    clearInterval(timer);
  }
}

async function pdfLines(name: string): Promise<Measured<{ lines: string[]; headers: number; reading: PdfReading }>> {
  return measured(async () => {
    const lines: string[] = [];
    let headers = 0;
    const reading = await readPdfLines(await openAsBlob(file(name)), { header: (h) => void (headers += h.length), line: (l) => void lines.push(l) });
    return { lines, headers, reading };
  });
}

async function txtLines(name: string): Promise<string[]> {
  const lines: string[] = [];
  await readSpoolLines(await openAsBlob(file(name)), (l) => void lines.push(l));
  return lines;
}

/** Body lines of the TXT and of the PDF compared in order (trailing spaces aside): equal, different, left over. */
function compareBodies(txt: readonly string[], pdf: readonly string[]) {
  const t = txt.map((l) => l.trimEnd()).filter((l) => !isSeparator(l));
  const p = pdf.map((l) => l.trimEnd()).filter((l) => !isSeparator(l));
  let equal = 0;
  let accents = 0;
  const different: number[] = [];
  const n = Math.min(t.length, p.length);
  for (let i = 0; i < n; i++) {
    if (t[i] === p[i]) equal++;
    else if (sameLine(t[i]!, p[i]!)) accents++;
    else different.push(i);
  }
  return { txtBody: t.length, pdfBody: p.length, equal, accents, different, separatorsInPdf: pdf.length - p.length };
}

async function provisionCase(report: string) {
  const pdf = await pdfLines(`${report}.pdf`);
  const txt = await txtLines(`${report}.__r`);
  const c = compareBodies(txt, pdf.value.lines);
  const r = pdf.value.reading;
  console.log(
    `[${report}] PDF ${r.pages} páginas (${r.spreadPages} espaçadas pelo pdf.js), passo ${r.step} pt, origem X ${r.originX?.toFixed(3)}, ${r.lines} linhas da grade + ${pdf.value.headers} de texto proporcional; ` +
      `${r.library}; ${pdf.ms.toFixed(0)} ms, Δheap ${pdf.heapMb.toFixed(1)} MB, RSS ${pdf.rssBeforeMb.toFixed(0)} → pico ${pdf.peakMb.toFixed(0)} MB`,
  );
  console.log(
    `[${report}] TXT ${txt.length} linhas, corpo ${c.txtBody}; PDF corpo ${c.pdfBody} (+${c.separatorsInPdf} separação); iguais ${c.equal}, iguais exceto acentos ${c.accents}, diferentes ${c.different.length}` +
      (c.different.length > 0 ? ` (primeiras: corpo ${c.different.slice(0, 5).join(', ')})` : ''),
  );
  expect(c.different).toEqual([]);
  expect(c.pdfBody).toBe(c.txtBody);
}

describe.skipIf(!has('gper070-2026-10.pdf', 'gper070-2026-10.__r'))('GPER070 in PDF', () => {
  it('gives the lines of its TXT (body, in order)', async () => provisionCase('gper070-2026-10'));
});

describe.skipIf(!has('gper090-2026-10.pdf', 'gper090-2026-10.__r'))('GPER090 in PDF', () => {
  it('gives the lines of its TXT (body, in order)', async () => provisionCase('gper090-2026-10'));
});

async function ledgerPdf(name: string): Promise<Measured<LedgerReading & { pdf: PdfReading }>> {
  return measured(async () => {
    const reader = new LedgerTextReader({ format: 'pdf' });
    const pdf = await readPdfLines(await openAsBlob(file(name)), { header: (lines, page) => reader.pageHeader(lines, page), line: (l, n) => reader.line(l, n) });
    return { ...reader.finish(), pdf };
  });
}

const failed = (r: LedgerReading) =>
  ledgerReadingChecks(r, competenceDays(2026, 10))
    .filter((c) => !c.passed)
    .map((c) => `${c.id}: ${c.message}`);

const accountsOf = (label: string, r: LedgerReading) => {
  for (const a of r.accounts) {
    console.log(`  ${label} conta ${a.code}: ${a.lines.length} linhas, saldo anterior ${balanceText(a.openingBalance)}, saldo final ${a.closing ? balanceText(a.closing.balance) : '(sem fecho)'}`);
  }
};

describe.skipIf(!has('ctbr400-liquido.pdf', 'ctbr400-liquido.__r', 'ctbr400-liquido.xml'))('the net-pay ledger in PDF', () => {
  it('reads to the records of its TXT and its XML (V-2), its invariants passing', async () => {
    const pdf = await ledgerPdf('ctbr400-liquido.pdf');
    const txt = new LedgerTextReader();
    await readSpoolLines(await openAsBlob(file('ctbr400-liquido.__r')), (l, n) => txt.line(l, n));
    const xml = new LedgerSheetReader();
    await readSpreadsheetRows(await openAsBlob(file('ctbr400-liquido.xml')), (s, name, r, cells) => xml.row(s, name, r, cells));
    const t = txt.finish();
    const x = xml.finish();
    const p = pdf.value;
    console.log(
      `[ctbr400-liquido PDF] ${p.pdf.pages} páginas, passo ${p.pdf.step} pt, ${p.pdf.lines} linhas; ${p.parameters.length} parâmetros (TXT ${t.parameters.length}); títulos ${p.titles?.withoutMarker}+${p.titles?.withMarker} (TXT ${t.titles?.withoutMarker}+${t.titles?.withMarker}); ` +
        `${p.accounts.reduce((n, a) => n + a.lines.length, 0)} lançamentos, ${p.transports.length} transportes, ${p.unknown.length} desconhecidas; ${pdf.ms.toFixed(0)} ms, pico RSS ${pdf.peakMb.toFixed(0)} MB`,
    );
    accountsOf('PDF', p);
    const vsTxt = readingDivergence(p, t);
    const vsXml = readingDivergence(p, x);
    console.log(`[V-2] PDF × TXT: ${vsTxt ? `primeira divergência em ${vsTxt.what}` : 'registros idênticos'}; PDF × XML: ${vsXml ? `primeira divergência em ${vsXml.what}` : 'registros idênticos'}`);
    console.log(`[ctbr400-liquido PDF] invariantes com falha: ${failed(p).join(' · ') || 'nenhuma'}`);
    expect(vsTxt?.what ?? null).toBeNull();
    expect(vsXml?.what ?? null).toBeNull();
    expect(p.transports.length).toBe(t.transports.length);
    expect(p.titles).toEqual(t.titles);
    expect(failed(p)).toEqual([]);
  });
});

describe.skipIf(!has('razoes-provisoes-2026-10.pdf'))('the ledger of the provision accounts in PDF', () => {
  it('reads without V-1, R-1 to R-6 passing for every account', async () => {
    const pdf = await ledgerPdf('razoes-provisoes-2026-10.pdf');
    const p = pdf.value;
    console.log(
      `[razoes-provisoes PDF] ${p.pdf.pages} páginas, passo ${p.pdf.step} pt, ${p.pdf.lines} linhas; ${p.accounts.length} contas, ${p.accounts.reduce((n, a) => n + a.lines.length, 0)} lançamentos, ` +
        `${p.transports.length} transportes, ${p.unknown.length} desconhecidas (${p.unknown.filter((u) => u.account !== null).length} dentro de conta), ${p.invalid.length} ilegíveis; ${pdf.ms.toFixed(0)} ms, pico RSS ${pdf.peakMb.toFixed(0)} MB`,
    );
    accountsOf('PDF', p);
    console.log(`[razoes-provisoes PDF] invariantes com falha: ${failed(p).join(' · ') || 'nenhuma'}`);
    expect(p.accounts.length).toBe(6);
    expect(failed(p)).toEqual([]);
  });
});
