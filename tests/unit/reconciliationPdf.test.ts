import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { identifyReconciliationInput } from '../../src/modules/reconciliation/detect';
import type { LedgerFileCard, PayrollFileCard, ReconciliationReconciliation } from '../../src/shared/modules/reconciliation';
import type { WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { probeWorkbook } from '../../src/worker/ingest/probe';
import type { PdfItem } from '../../src/worker/ingest/pdfText';
import { spoolLines } from '../../src/worker/ingest/spoolText';
import { PdfGrid, PdfGridError, readPdfLines } from '../../src/worker/modules/reconciliation/formats/pdf';
import { payrollDivergence } from '../../src/worker/modules/reconciliation/ingest';
import { readingDivergence } from '../../src/worker/modules/reconciliation/ledger';
import { readPayrollPdf, readPayrollSpool } from '../../src/worker/modules/reconciliation/payrollSource';
import { LedgerTextReader, competenceDays, ledgerReadingChecks, type LedgerReading } from '../../src/worker/modules/reconciliation/reports/ctbr400';
import { ledgerSpool, type LedgerFixture } from '../synthetic/ledgerFixture';
import { payrollSpool } from '../synthetic/payrollFixture';
import { VERBAS_ACCOUNT, engineFixture } from '../synthetic/payrollLedgerFixture';
import { pdfBytes, spoolPages, spoolPdf, type PdfFixtureOptions } from '../synthetic/pdfFixture';
import { configOf, screenFixture, sessionFiles, type SessionFile } from '../synthetic/reconciliationSession';

/**
 * PDF adapter of the Conciliador (docs/REGRAS_CONCILIADOR.md, 3.3 and 3.4; Phase 16, step 4): the grid of a page from
 * its items (pure), the synthetic PDFs written by tests/synthetic/pdfFixture.ts (Courier body, Helvetica header) read by
 * the bundled pdf.js into the lines of the TXT of the same report, the readers of the GPER040 and of the CTBR400 fed
 * from the PDF, V-1 (off the grid, no monospaced body), the probe and detect by content, and V-3 in the ingestion.
 * Invented data only.
 */
const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);
const mono = (str: string, x: number, y: number, width: number): PdfItem => ({ str, x, y, width, mono: true });
const prop = (str: string, x: number, y: number): PdfItem => ({ str, x, y, width: str.length * 3, mono: false });

function laid(pages: PdfItem[][]): { headers: string[][]; lines: string[] } {
  const grid = new PdfGrid();
  pages.forEach((items, i) => grid.page(i + 1, items));
  const headers: string[][] = [];
  const lines: string[] = [];
  grid.finish({ header: (h) => void headers.push([...h]), line: (l) => void lines.push(l) });
  return { headers, lines };
}

const gridError = (pages: PdfItem[][]) => {
  try {
    laid(pages);
  } catch (e) {
    if (e instanceof PdfGridError) return e.message;
    throw e;
  }
  return null;
};

describe('the grid of a PDF (3.3), from the items of its pages', () => {
  it('lays the monospaced items by column and the lines by y, top to bottom; the proportional text is the page header', () => {
    const step = 4;
    const { headers, lines } = laid([
      [
        prop('SIGA /CTBR400/v.12', 10, 200),
        prop(' ', 64, 200),
        prop('RAZAO', 70, 200),
        mono('Z', 10, 90, step),
        mono('AB CD', 10, 100, 5 * step),
        mono('X', 10 + 7 * step, 100, step),
        mono('0,00', 10 + 3 * step, 90.04, 4 * step),
      ],
      // The second page starts two columns to the right: the origin X is the smallest x of the whole document.
      [mono('ABC', 10 + 2 * step, 100, 3 * step)],
    ]);
    expect(headers).toEqual([['SIGA /CTBR400/v.12 RAZAO'], []]);
    expect(lines).toEqual(['AB CD  X', 'Z  0,00', '  ABC']);
  });

  it('rejects a character off the grid (V-1), never rounding it', () => {
    const ok = [mono('ABCD', 10, 100, 16), mono('EF', 10, 90, 8)];
    expect(gridError([ok])).toBeNull();
    // 0.14 of a column still lies on the grid; 0.2 does not.
    expect(gridError([[...ok, mono('G', 10 + 4.14 * 4, 80, 4)]])).toBeNull();
    expect(gridError([[...ok, mono('G', 10 + 4.2 * 4, 80, 4)]])).toMatch(/^Página 1: o trecho "G" começa a 0,2 coluna de uma coluna inteira \(limite 0,15\): caractere fora da grade \(V-1\)/);
    // A page whose left margin is off the grid of the document.
    expect(gridError([ok, [mono('AB', 10 + 2.3 * 4, 100, 8)]])).toMatch(/^Página 2: a margem esquerda .* \(V-1\)/);
    // An item of the monospaced font whose characters are not as wide as the step (beyond 0.5%).
    expect(gridError([[...ok, mono('HIJK', 10, 70, 4 * 4.1)]])).toMatch(/^Página 1: o trecho "HIJK" está na fonte monoespaçada, mas a largura .* \(V-1\)/);
    // Two characters in the same column of a line.
    expect(gridError([[...ok, mono('Q', 10 + 4, 100, 4)]])).toMatch(/dois caracteres na mesma coluna \(2\)/);
  });

  it('rejects a PDF without a monospaced body', () => {
    expect(gridError([[prop('SIGA /GPER040/v.12', 10, 200), prop('texto corrido', 10, 190)]])).toMatch(/não tem texto em fonte monoespaçada/);
    expect(gridError([[]])).toMatch(/não tem texto em fonte monoespaçada/);
  });

  it('reads a spread page: one space between every two characters is pdf.js, the step is measured between items', () => {
    // Advance 5 pt, glyph 3.6 pt: width of n characters = (n − 1) × 5 + 3.6, every character followed by a space.
    const w = (n: number) => (n - 1) * 5 + 3.6;
    const { lines } = laid([[mono('D a t a', 10, 100, w(4)), mono('B a s e :', 10 + 5 * 5, 100, w(5)), mono('3 1', 10 + 11 * 5, 100, w(2)), mono('1', 10, 90, w(1)), mono('A B C', 10 + 3 * 5, 90, w(3))]]);
    expect(lines).toEqual(['Data Base: 31', '1  ABC']);
  });
});

/** Body lines of a spool as the PDF has them: no separators, no page headers, no parameters, no blank lines. */
function bodyLines(spool: Uint8Array): string[] {
  return spoolPages(spoolLines(spool).lines)
    .flatMap((p) => p.body)
    .filter((l) => l.trim() !== '');
}

/** A character of a body line of the page, past the first one (the origin of the page stays put). */
function offGridAt(spool: Uint8Array, page: number): { page: number; line: number; column: number } {
  const body = spoolPages(spoolLines(spool).lines)[page]!.body;
  const line = body.findIndex((l) => /^\S.*\S {2,}\S/.test(l));
  return { page, line, column: body[line]!.search(/(?<= {2})\S/) };
}

async function gridLines(pdf: Uint8Array): Promise<{ lines: string[]; headers: string[][]; pages: number[] }> {
  const lines: string[] = [];
  const headers: string[][] = [];
  const pages: number[] = [];
  await readPdfLines(blob(pdf), { header: (h) => void headers.push([...h]), line: (l) => void lines.push(l) }, { onPage: (done) => void pages.push(done) });
  return { lines, headers, pages };
}

describe('synthetic PDFs read by pdf.js (Courier body, Helvetica page header)', () => {
  for (const [label, options] of [
    ['advance = glyph', {}],
    ['spread (advance larger than the glyph)', { spread: 1.1 }],
  ] as const) {
    it(`gives the lines of the TXT of the same GPER040, page by page (${label})`, async () => {
      const spool = payrollSpool().bytes;
      const pdf = spoolPdf(spool, options);
      const read = await gridLines(pdf);
      expect(read.lines.map((l) => l.trimEnd())).toEqual(bodyLines(spool).map((l) => l.trimEnd()));
      expect(read.pages).toEqual(Array.from({ length: read.pages.length }, (_, i) => i + 1));
      expect(read.headers[0]!.some((h) => h.includes('SIGA /GPER040/v.12'))).toBe(true);
      expect(read.headers[0]!.some((h) => h.includes('Emissão'))).toBe(true);
    });
  }

  it('feeds the reader of the GPER040: the same report as the TXT, invariants passing', async () => {
    const spool = payrollSpool().bytes;
    const options = { netPayCode: 'Z99' };
    const fromText = await readPayrollSpool(blob(spool), options);
    for (const o of [{}, { spread: 1.1 }] satisfies PdfFixtureOptions[]) {
      const fromPdf = await readPayrollPdf(blob(spoolPdf(spool, o)), options);
      expect(payrollDivergence(fromText.report, fromPdf.report)).toBeNull();
      expect(fromPdf.checks.map((c) => [c.id, c.passed])).toEqual(fromText.checks.map((c) => [c.id, c.passed]));
      expect(fromPdf.reading.format).toBe('pdf');
      expect(fromPdf.reading.encoding).toMatch(/^pdf\.js \d+\.\d+\.\d+$/);
      expect(fromPdf.reading.pages).toBeGreaterThan(1);
      expect(fromPdf.reading.employees).toBe(fromText.reading.employees);
    }
  });

  const ledgerOf = async (f: LedgerFixture, o: PdfFixtureOptions = {}) => {
    const text = new LedgerTextReader();
    for (const [i, l] of spoolLines(ledgerSpool(f)).lines.entries()) text.line(l, i + 1);
    const pdf = new LedgerTextReader({ format: 'pdf' });
    await readPdfLines(blob(spoolPdf(ledgerSpool(f), o)), { header: (lines, page) => pdf.pageHeader(lines, page), line: (l, n) => pdf.line(l, n) });
    return { text: text.finish(), pdf: pdf.finish() };
  };
  const failing = (r: LedgerReading) =>
    ledgerReadingChecks(r, competenceDays(2026, 10))
      .filter((c) => !c.passed)
      .map((c) => c.id);

  it('feeds the reader of the CTBR400: parameters from the proportional text, the same records as the TXT, in real and pre-entry', async () => {
    const { real, preEntry } = screenFixture();
    for (const f of [real, preEntry]) {
      const { text, pdf } = await ledgerOf(f);
      expect(pdf.format).toBe('pdf');
      expect(pdf.parameters).toEqual(text.parameters);
      expect(pdf.titles).toEqual(text.titles);
      expect(pdf.transports.map((t) => [t.kind, t.value])).toEqual(text.transports.map((t) => [t.kind, t.value]));
      expect(readingDivergence(text, pdf)).toBeNull();
      expect(pdf.unknown).toEqual([]);
      expect(failing(pdf)).toEqual([]);
    }
    // R-9 still reads the marker of the title: in the pre-entry PDF every page title has it.
    expect((await ledgerOf(preEntry)).pdf.titles!.withoutMarker).toBe(0);
  });

  it('rejects a PDF with a character off the grid (V-1) or with a body in a proportional font', async () => {
    const spool = payrollSpool().bytes;
    const at = offGridAt(spool, 1);
    await expect(gridLines(spoolPdf(spool, { offGrid: { ...at, fraction: 0.4 } }))).rejects.toThrow(/^Página 2: .*caractere fora da grade \(V-1\)/);
    await expect(gridLines(spoolPdf(spool, { spread: 1.1, offGrid: { ...at, fraction: 0.4 } }))).rejects.toThrow(/^Página 2: .*caractere fora da grade \(V-1\)/);
    // Within 0.15 of a column the character is on the grid, and the lines are those of the TXT.
    const near = await gridLines(spoolPdf(spool, { offGrid: { ...at, fraction: 0.1 } }));
    expect(near.lines.map((l) => l.trimEnd())).toEqual(bodyLines(spool).map((l) => l.trimEnd()));
    await expect(gridLines(spoolPdf(spool, { bodyFont: 'Helvetica' }))).rejects.toThrow(/não tem texto em fonte monoespaçada/);
  });

  it('can be canceled between pages', async () => {
    const controller = new AbortController();
    const pdf = spoolPdf(payrollSpool().bytes);
    const reading = readPdfLines(blob(pdf), { line: () => {} }, { signal: controller.signal, onPage: (done) => done === 1 && controller.abort() });
    await expect(reading).rejects.toThrow(/abort/i);
  });
});

describe('probe and detect of a PDF (3.1): by its content, the report from the text of the first page', () => {
  it('reads the first page of a PDF, whatever the name, and names the report', async () => {
    const config = configOf(engineFixture().profile);
    const payroll = spoolPdf(payrollSpool().bytes);
    const ledger = spoolPdf(ledgerSpool(engineFixture().ledger));
    for (const [bytes, report] of [
      [payroll, 'GPER040'],
      [ledger, 'CTBR400'],
    ] as const) {
      const sheets = await probeWorkbook(new File([bytes as Uint8Array<ArrayBuffer>], 'relatorio.bin'), 30);
      expect(sheets).toHaveLength(1);
      expect(sheets[0]!.format).toBe('pdf');
      expect(identifyReconciliationInput(sheets, config)).toEqual({ report, format: 'pdf' });
    }
    // A PDF of another routine is not an input of the module.
    const other = pdfBytes([{ header: ['SIGA /MATR100/v.12   RELATORIO'], body: ['ABC 123'] }]);
    expect(identifyReconciliationInput(await probeWorkbook(new File([other as Uint8Array<ArrayBuffer>], 'x.pdf'), 30), config)).toBeNull();
  });
});

describe('ingestion with PDFs (V-1 on the board, V-3 across formats)', () => {
  const toFile = (f: SessionFile) => new File([f.bytes as Uint8Array<ArrayBuffer>], f.name);
  async function ingest(files: SessionFile[], config: unknown) {
    const events: WorkerEvent[] = [];
    const handle = createCommandHandler((e) => events.push(e), { progressIntervalMs: 0 });
    await handle({ type: 'ingest', module: 'reconciliation', files: files.map(toFile), config });
    const recon = events.find((e) => e.type === 'reconciliation');
    const error = events.find((e) => e.type === 'error');
    return { events, error: error?.type === 'error' ? error : null, reconciliation: recon?.type === 'reconciliation' ? (recon.data as ReconciliationReconciliation) : null };
  }
  const failing = (r: ReconciliationReconciliation) => r.checks.filter((c) => !c.passed).map((c) => c.id);

  it('reads the GPER040 and the CTBR400 in PDF next to their TXT: same readings (V-3), the PDFs on the grid (V-1)', async () => {
    const fx = engineFixture();
    const [payroll, ledger] = sessionFiles(fx, [{ format: 'text' }]);
    const files: SessionFile[] = [
      { name: 'folha.pdf', bytes: spoolPdf(payroll!.bytes) },
      ledger!,
      { name: 'razao', bytes: spoolPdf(ledger!.bytes, { spread: 1.1 }) },
      payroll!,
    ];
    const r = await ingest(files, configOf(fx.profile));
    expect(r.error).toBeNull();
    const recon = r.reconciliation!;
    expect(recon.files.map((f) => f.kind)).toEqual(['payroll', 'ledger', 'ledger', 'payroll']);
    const pdfPayroll = recon.files[0] as PayrollFileCard;
    expect([pdfPayroll.format, pdfPayroll.used, pdfPayroll.sha256]).toEqual(['pdf', true, createHash('sha256').update(files[0]!.bytes).digest('hex')]);
    expect(pdfPayroll.encoding).toMatch(/^pdf\.js /);
    const pdfLedger = recon.files[2] as LedgerFileCard;
    expect([pdfLedger.format, pdfLedger.pages! > 1, pdfLedger.parameters.length]).toEqual(['pdf', true, (recon.files[1] as LedgerFileCard).parameters.length]);
    expect(failing(recon)).toEqual([]);
    const v1 = recon.checks.find((c) => c.id === 'V-1')!;
    expect(v1.message).toMatch(/^folha\.pdf: \d+ página\(s\) · razao: \d+ página\(s\); texto lido com pdf\.js \d+\.\d+\.\d+, nenhum caractere fora da grade\.$/);
    expect(recon.checks.find((c) => c.id === 'V-3')!.message).toBe('2 par(es) de arquivos do mesmo relatório com leituras iguais.');
    // Progress of a PDF counts pages.
    expect(r.events.some((e) => e.type === 'progress' && e.unit === 'steps' && e.message.includes('folha.pdf (PDF, página a página)'))).toBe(true);
  });

  it('blocks with the first divergence when the PDF and the TXT of the same ledger differ (V-3)', async () => {
    const fx = engineFixture();
    const other = structuredClone(fx.ledger);
    const line = other.accounts.find((a) => a.code === VERBAS_ACCOUNT)!.entries.find((e) => e.credit !== undefined)!;
    line.credit = line.credit! + 1;
    const [payroll, ledger] = sessionFiles(fx, [{ format: 'text' }]);
    const r = await ingest([payroll!, ledger!, { name: 'razao.pdf', bytes: spoolPdf(ledgerSpool(other)) }], configOf(fx.profile));
    expect(r.error).toBeNull();
    expect(failing(r.reconciliation!)).toEqual(['R-7', 'V-3']);
    expect(r.reconciliation!.checks.find((c) => c.id === 'V-3')!.message).toMatch(/^CTBR400-1\.__r × razao\.pdf: primeira divergência em conta 9\.9\.1\.0\.10\.02, lançamento \d+: crédito: /);
  });

  it('stops the ingestion on a PDF off the grid (V-1), naming the file and the page', async () => {
    const fx = engineFixture();
    const [payroll, ledger] = sessionFiles(fx, [{ format: 'text' }]);
    const r = await ingest([{ name: 'folha.pdf', bytes: spoolPdf(payroll!.bytes, { offGrid: { ...offGridAt(payroll!.bytes, 0), fraction: 0.5 } }) }, ledger!], configOf(fx.profile));
    expect(r.reconciliation).toBeNull();
    expect(r.error!.stage).toBe('rows');
    expect(r.error!.message).toMatch(/^folha\.pdf: Página 1: .*\(V-1\)/);
    expect(r.error!.detail).toMatch(/PDF rejeitado/);
  });
});
