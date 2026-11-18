import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CT2_CHART_TESTS, CT2_TESTS, ct2DefaultConfig, type Ct2IntegrityConfig, type Ct2TestCode } from '../../src/config/ct2IntegritySchema';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import { isCt2Reconciliation, isCt2Summary, type Ct2ChartReconciliation } from '../../src/shared/modules/ct2Integrity';
import type { CheckResult, WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { probeWorkbook } from '../../src/worker/ingest/probe';
import { analyzeCt2, hasMark, type Ct2Analysis } from '../../src/worker/modules/ct2Integrity/analysis';
import { ct2Document } from '../../src/worker/modules/ct2Integrity/document';
import { findingAt, findingReason } from '../../src/worker/modules/ct2Integrity/findings';
import { ingestCt2, type Ct2Ingested } from '../../src/worker/modules/ct2Integrity/ingest';
import { ct2Panel } from '../../src/worker/modules/ct2Integrity/panel';
import { segmentMap } from '../../src/worker/modules/ct2Integrity/segments';
import { Ct2Tables } from '../../src/worker/modules/ct2Integrity/tables';
import { buildCt2Workpaper } from '../../src/worker/modules/ct2Integrity/workpaper';
import { Workbook } from '../support/xlsxEval';
import { CHART_ACCOUNTS, CHART_EXPECTED, CHART_OCCURRENCES, CHART_REASONS, CHART_ROWS, CT2_CHART_COLUMNS, buildCt2Chart, buildCt2ChartXml, type ChartOptions } from '../synthetic/ct2Chart';
import { CT2_COLUMNS, buildCt2Extraction, ct2Line, type Ct2ExtractionOptions, type Ct2Row } from '../synthetic/ct2Extraction';
import { zipFiles } from '../synthetic/ct2Xml';

/**
 * The chart of accounts loaded with the CT2 extraction and the tests C1-C5 (decisions of 18/11/2026): reading in any
 * position of the list (.xlsx and the system XML), the reconciliation of the chart, CI-11 and the alerts, each rule on
 * each side with its reason, and the session keeping the chart.
 */
const asFile = (bytes: Uint8Array, name: string) => new File([bytes as Uint8Array<ArrayBuffer>], name);
const chartBytes = (o: Partial<ChartOptions> = {}) => buildCt2Chart({ accounts: CHART_ACCOUNTS, ...o });
const chart = (o: Partial<ChartOptions> = {}, name = 'plano.xlsx') => asFile(chartBytes(o), name);
const extraction = (o: Partial<Ct2ExtractionOptions> = {}, name = 'ct2.xlsx') => asFile(buildCt2Extraction({ rows: CHART_ROWS, ...o }), name);

async function ingest(files: File[], config: Ct2IntegrityConfig = ct2DefaultConfig(), sheets?: (string | null)[]) {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e), { now: () => 0 });
  await handle({ type: 'ingest', module: 'ct2Integrity', files, config, ...(sheets && { sheets }) });
  const error = events.find((e) => e.type === 'error');
  const recon = events.find((e) => e.type === 'reconciliation');
  const ready = events.find((e) => e.type === 'ready');
  return {
    handle,
    events,
    error: error?.type === 'error' ? error : undefined,
    reconciliation: recon?.type === 'reconciliation' && isCt2Reconciliation(recon.data) ? recon.data : null,
    summary: ready?.type === 'ready' && isCt2Summary(ready.summary) ? ready.summary : null,
  };
}

/** The engine directly: the reading with the analysis. */
async function engine(files: File[], config: Ct2IntegrityConfig = ct2DefaultConfig()) {
  const read = await ingestCt2(files.map((f) => ({ name: f.name, blob: f })), config, () => {}, {}, { holidays: new Set() });
  const base: Ct2Ingested = { reconciliation: read.reconciliation, summary: read.summary, store: read.store, order: read.order, keys: read.keys, chart: read.chart };
  return { base, analysis: read.analysis! };
}

/** Lines marked by a test, as "document-line" in the order of the Base. */
function marked(base: Ct2Ingested, analysis: Ct2Analysis, code: Ct2TestCode): string[] {
  const out: string[] = [];
  for (let pos = 0; pos < base.order.length; pos++) {
    if (!hasMark(analysis.marks.line, pos, code)) continue;
    const i = base.order[pos]!;
    out.push(`${base.store.text.document.get(i)}-${base.store.text.line.get(i)}`);
  }
  return out;
}

/** The reasons of the findings of a test, in the order of the findings. */
function reasons(base: Ct2Ingested, analysis: Ct2Analysis, code: Ct2TestCode): string[] {
  return Array.from({ length: analysis.findings.count }, (_, n) => findingAt(analysis, n))
    .filter((f) => f.code === code)
    .map((f) => findingReason(base, analysis, f.code, f.item));
}

const test = (analysis: Ct2Analysis, code: Ct2TestCode) => analysis.tests.find((t) => t.code === code)!;
const checkOf = (checks: CheckResult[], id: string) => checks.find((c) => c.id === id)!;

/** What depends on the file itself (name, bytes, container, position), left out to compare readings. */
function content(c: Ct2ChartReconciliation) {
  const copy: Partial<Ct2ChartReconciliation> = structuredClone(c);
  for (const key of ['name', 'size', 'sha256', 'format', 'entries', 'timings', 'fileIndex'] as const) delete copy[key];
  return { ...copy, alerts: c.alerts.map((a) => a.message.replace(/^plano\.(xlsx|xml|zip): /, '')) };
}

describe('chart of accounts: reading', () => {
  it('recognizes the chart among the files, in any position, and reconciles it', async () => {
    const bytes = chartBytes();
    for (const [files, chartAt, extractionAt] of [
      [[asFile(bytes, 'plano.xlsx'), extraction()], 0, 1],
      [[extraction(), asFile(bytes, 'plano.xlsx')], 1, 0],
    ] as const) {
      const { error, reconciliation: r, summary } = await ingest([...files]);
      expect(error).toBeUndefined();
      expect(r!.files.map((f) => [f.name, f.fileIndex])).toEqual([['ct2.xlsx', extractionAt]]);
      expect(r!.chart).toMatchObject({
        fileIndex: chartAt,
        name: 'plano.xlsx',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        format: 'xlsx',
        sheetName: 'Plano de Contas',
        sheetNames: ['Plano de Contas'],
        ...CHART_EXPECTED,
        missingColumns: [],
        missingAccounts: { count: 2, sample: ['99999998', '99999999'] },
      });
      expect(r!.chart!.entries.length).toBeGreaterThan(0);
      expect(r!.chart!.timings.map((t) => t.stage)).toContain('rows');
      // The chart is not part of the Base.
      expect(summary!.lines).toBe(r!.files[0]!.rows.detailRows);
      expect(summary!.analysis!.tests.find((t) => t.code === 'C1')).toMatchObject({ state: 'on', occurrences: CHART_OCCURRENCES.C1.length });
    }
  });

  it('reads the chart in the system XML, plain or in a .zip, like the .xlsx', async () => {
    const xlsx = (await ingest([extraction(), chart()])).reconciliation!.chart!;
    const xmlBytes = buildCt2ChartXml({ accounts: CHART_ACCOUNTS });
    const xml = (await ingest([extraction(), asFile(xmlBytes, 'plano.xml')])).reconciliation!.chart!;
    const zip = (await ingest([asFile(zipFiles({ 'PLANO.XML': xmlBytes }), 'plano.zip'), extraction()])).reconciliation!.chart!;
    expect(content(xml)).toEqual(content(xlsx));
    expect(content(zip)).toEqual(content(xlsx));
    expect([xlsx.format, xml.format, zip.format]).toEqual(['xlsx', 'xml', 'xmlZip']);
    expect(xml.entries).toEqual([]);
  });

  it('finds the header by title or alias, with spaces at the ends, and only in the first rows', async () => {
    const alias: Record<string, string> = { Conta: ' CT1_CONTA', 'C. Custo Obrig.': 'CT1_CCOBRG ', 'Item Obrig.': 'CT1_ITOBRG', 'Aceita C. Custo': 'CT1_ACCUST' };
    const aliases = CT2_CHART_COLUMNS.map((t) => alias[t] ?? t);
    const { reconciliation } = await ingest([extraction(), chart({ columns: aliases })]);
    expect(reconciliation!.chart).toMatchObject({ headerRow: 4, accounts: CHART_EXPECTED.accounts, missingColumns: [] });
    const config = ct2DefaultConfig();
    config.reading.headerSearchRows = 3;
    const { error } = await ingest([extraction(), chart()], config);
    expect(error?.message).toBe('Cabeçalho da extração CT2 não encontrado nas primeiras 3 linhas da aba "Plano de Contas" de plano.xlsx.');
  });

  it('turns off the tests of a missing optional flag column, with an alert naming them', async () => {
    const columns = CT2_CHART_COLUMNS.filter((t) => t !== 'Aceita Cl. Valor' && t !== 'Aceita Item');
    const { base, analysis } = await engine([extraction(), chart({ columns })]);
    const r = base.reconciliation;
    expect(r.chart!.missingColumns).toEqual(['Aceita Item', 'Aceita Cl. Valor']);
    expect(r.chart!.alerts.map((a) => a.message)).toContain('plano.xlsx: colunas do plano de contas ausentes: Aceita Item, Aceita Cl. Valor (C4, C5 desligados).');
    expect([test(analysis, 'C4').state, test(analysis, 'C5').state]).toEqual(['noColumn', 'noColumn']);
    expect(marked(base, analysis, 'C3')).toEqual(CHART_OCCURRENCES.C3);
  });

  it('chooses the chart sheet automatically or as chosen on the start screen', async () => {
    const notes = { Notas: [['Notas do plano'], ['sem cabeçalho']] };
    const auto = await ingest([extraction(), chart({ extraSheets: notes })]);
    expect(auto.reconciliation!.chart).toMatchObject({ sheetName: 'Plano de Contas', sheetNames: ['Notas', 'Plano de Contas'], accounts: 10 });
    const chosen = await ingest([extraction(), chart({ extraSheets: notes })], undefined, [null, 'Plano de Contas']);
    expect(chosen.reconciliation!.chart!.accounts).toBe(10);
    // The extraction and the chart in one workbook: the sheet is chosen on the list of files.
    const both = asFile(buildCt2Extraction({ rows: CHART_ROWS, extraSheets: { Plano: buildChartSheet() } }), 'junto.xlsx');
    const ambiguous = await ingest([both]);
    expect(ambiguous.error?.message).toBe('Mais de uma aba de junto.xlsx tem o cabeçalho da extração CT2 ou do plano de contas: SCACKST0.XML, Plano. Escolha a aba na lista de arquivos.');
    expect((await ingest([both, chart()], undefined, ['SCACKST0.XML', null])).reconciliation!.chart!.name).toBe('plano.xlsx');
  });

  it('refuses two charts, a chart without an extraction and a repeated column of the chart', async () => {
    expect((await ingest([chart({}, 'a.xlsx'), extraction(), chart({}, 'b.xlsx')])).error).toMatchObject({
      stage: 'rows',
      message: 'Mais de um plano de contas na lista de arquivos: a.xlsx e b.xlsx. Carregue um único plano de contas por análise.',
    });
    expect((await ingest([chart()])).error?.message).toBe(
      'Nenhuma extração da CT2 na lista de arquivos: plano.xlsx é o plano de contas, lido junto com a extração. Carregue também a extração.',
    );
    const repeated = await ingest([extraction(), chart({ columns: [...CT2_CHART_COLUMNS, 'CT1_CCOBRG'] })]);
    expect(repeated.error).toMatchObject({
      message: 'Coluna repetida no cabeçalho do plano de contas, aba "Plano de Contas" de plano.xlsx.',
      detail: 'C. Custo Obrig. (CT1_CCOBRG): colunas 14 e 23',
    });
  });

  it('is recognized by the module on the start screen (no warning of another analysis)', async () => {
    const config = ct2DefaultConfig();
    for (const bytes of [chartBytes(), buildCt2ChartXml({ accounts: CHART_ACCOUNTS })]) {
      expect(ct2IntegrityModule.detect(await probeWorkbook(new Blob([bytes as Uint8Array<ArrayBuffer>]), 30), config)).toBe('match');
    }
    expect(ct2IntegrityModule.detect([{ name: 'x', rows: [{ r: 1, titles: ['Conta', 'Aceita C. Custo'] }] }], config)).toBe('no');
  });
});

/** The chart as raw rows of another sheet (for a workbook with the extraction). */
function buildChartSheet() {
  return [[], [], [], [...CT2_CHART_COLUMNS], ['31101001', 'X', 5, 'Analítica', null, null, null, null, null, null, null, null, 'Sim', 'Sim', 'Sim', 'Não', 'Sim']];
}

describe('chart of accounts: CI-11 and the alerts', () => {
  it('warns of the accounts repeated with other flags and the unknown flags (CI-11), without blocking', async () => {
    const { reconciliation: r } = await ingest([extraction(), chart()]);
    const ci11 = checkOf(r!.checks, 'ct2-chart');
    expect(ci11).toMatchObject({ label: 'Plano de contas legível', severity: 'warning', passed: false });
    expect(ci11.message).toBe(
      'Plano de contas com 1 conta repetida com marcas diferentes (marcas tratadas como desconhecidas) e 2 marcas que não são Sim nem Não: as contas e os lados com marca desconhecida ficam fora dos testes C1 a C5.',
    );
    expect(r!.checks.map((c) => c.id).slice(0, 4)).toEqual(['ct2-reading', 'ct2-order', 'ct2-values', 'ct2-chart']);
    const clean = await ingest([extraction(), chart({ accounts: CHART_ACCOUNTS.slice(0, 4) })]);
    expect(checkOf(clean.reconciliation!.checks, 'ct2-chart')).toMatchObject({ passed: true, message: '4 contas no plano de contas, cada uma com as marcas Sim ou Não em todas as colunas lidas.' });
  });

  it('says which accounts of the extraction are not in the chart, the first ten by text', async () => {
    const { reconciliation: r } = await ingest([extraction(), chart()]);
    expect(r!.chart!.alerts.map((a) => a.message)).toEqual([
      'plano.xlsx: 1 linha do plano de contas tem valores sem conta; não entram no plano.',
      '2 contas da extração não estão no plano de contas; os testes C1 a C5 não se aplicam a elas: 99999998, 99999999.',
    ]);
    const many: Ct2Row[] = Array.from({ length: 12 }, (_, k) => ct2Line({ document: String(200 + k).padStart(6, '0'), debitAccount: `9${String(12 - k).padStart(7, '0')}` }));
    const twelve = await ingest([extraction({ rows: many }), chart()]);
    expect(twelve.reconciliation!.chart!.missingAccounts).toEqual({ count: 12, sample: Array.from({ length: 10 }, (_, k) => `9${String(k + 1).padStart(7, '0')}`) });
    expect(twelve.reconciliation!.chart!.alerts.at(-1)!.message).toMatch(/^12 contas da extração não estão no plano de contas; os testes C1 a C5 não se aplicam a elas: 90000001, .*, 90000010…\.$/);
  });

  it('without a chart: the C tests are off, CI-11 passes and an alert says so', async () => {
    const { reconciliation: r, summary } = await ingest([extraction()]);
    expect(r!.chart).toBeNull();
    expect(checkOf(r!.checks, 'ct2-chart')).toMatchObject({ passed: true, message: 'Nenhum plano de contas carregado: os testes C1 a C5 não foram aplicados.' });
    expect(r!.consolidated.alerts.map((a) => a.message)).toEqual(['Plano de contas não carregado: os testes C1 a C5 não foram aplicados.']);
    expect(summary!.analysis!.tests.filter((t) => t.state === 'off').map((t) => t.code)).toEqual([...CT2_CHART_TESTS]);
    // With the C tests turned off there is nothing to warn about.
    const config = ct2DefaultConfig();
    for (const code of CT2_CHART_TESTS) config.tests[code].enabled = false;
    expect((await ingest([extraction()], config)).reconciliation!.consolidated.alerts).toEqual([]);
  });
});

describe('chart of accounts: the tests C1-C5', async () => {
  const { base, analysis } = await engine([extraction(), chart()]);

  it('checks each side the entry type has, with its account found and a known flag', () => {
    for (const code of CT2_CHART_TESTS) expect(marked(base, analysis, code), code).toEqual(CHART_OCCURRENCES[code]);
    for (const code of CT2_CHART_TESTS) expect(test(analysis, code), code).toMatchObject({ state: 'on', severity: 'warning', occurrences: CHART_OCCURRENCES[code].length });
  });

  it('gives the reason of each occurrence: the account and the entity of each side that fails', () => {
    for (const code of CT2_CHART_TESTS) expect(reasons(base, analysis, code), code).toEqual(CHART_REASONS[code]);
  });

  it('lists them as exceptions (Alerta) and keeps the invariants', () => {
    const total = CT2_CHART_TESTS.reduce((n, c) => n + CHART_OCCURRENCES[c].length, 0);
    const chartTests: readonly string[] = CT2_CHART_TESTS;
    const listed = Array.from({ length: analysis.exceptions.count }, (_, k) => CT2_TESTS[analysis.exceptions.test.get(k)]!).filter((code) => chartTests.includes(code));
    expect(listed).toHaveLength(total);
    // The analysis invariants recount them (CI-5 among them) and all pass.
    expect(analysis.checks.filter((c) => c.severity === 'error').map((c) => [c.id, c.passed])).toEqual([
      ['ct2-totals', true],
      ['ct2-exceptions', true],
      ['ct2-counts', true],
    ]);
    expect(analysis.findings.groupCounts.exception).toBe(analysis.exceptions.count);
  });

  it('opens each number of the board with exactly that many rows, and shows them in the document panel', () => {
    const tables = new Ct2Tables(base, analysis);
    const panel = ct2Panel(base, analysis, {});
    for (const code of CT2_CHART_TESTS) {
      const t = panel.board.find((x) => x.code === code)!;
      expect(t, code).toMatchObject({ occurrences: CHART_OCCURRENCES[code].length, link: 'ct2Exceptions', group: 'exception' });
      expect(tables.page('ct2Exceptions', { test: code }, undefined, 0, 1).total, code).toBe(t.occurrences);
      expect(tables.page('ct2Base', { test: code }, undefined, 0, 1).total, code).toBe(t.occurrences);
      expect(t.sample.map((s) => s.reason)).toEqual(CHART_REASONS[code].slice(0, 5));
    }
    expect(tables.page('ct2Base', {}, undefined, 0, 1).columns.map((c) => c.header)).toEqual(expect.arrayContaining(['C1 Exceção?', 'C5 Exceção?']));
    const documents = tables.page('ct2Documents', {}, undefined, 0, 100);
    const d = documents.documents![documents.rows.findIndex((row) => row.includes('000104'))]!;
    const detail = ct2Document(base, analysis, segmentMap(base, analysis.blocks), d);
    expect(detail.lines[0]!.findings).toContainEqual({ code: 'C1', group: 'exception', reason: CHART_REASONS.C1[2] });
  });

  it('keeps the board, the tables and the side panel equal under the common filter', () => {
    const tables = new Ct2Tables(base, analysis);
    const day = base.store.day.get(base.order[0]!);
    for (const filter of [{}, { origins: ['manual' as const] }, { origins: ['automatic' as const] }, { routine: 'CTBA102' }, { routine: 'OUTRA' }, { day }, { segment: 0 }]) {
      const panel = ct2Panel(base, analysis, filter);
      for (const code of CT2_CHART_TESTS) {
        const t = panel.board.find((x) => x.code === code)!;
        expect(tables.page('ct2Exceptions', { ...filter, test: code }, undefined, 0, 1).total, `${code} ${JSON.stringify(filter)}`).toBe(t.occurrences);
      }
    }
  });

  it('is in the workpaper, which ties out (formula = list = confirmed = engine; details in ct2Workpaper.test.ts)', async () => {
    const config = ct2DefaultConfig();
    const out = await buildCt2Workpaper(
      { base, analysis, config, holidays: [], language: 'pt', generatedAt: '18/11/2026 10:00:00', appVersion: 't', configHash: '-', configDifferences: [], confirmedFailures: [] },
      () => {},
    );
    const book = await Workbook.read(out.blob);
    const codes = new Map<string, number>();
    for (let r = 10; r < 200; r++) {
      const code = book.value('Resumo', `A${r}`);
      if (typeof code === 'string' && /^[BIECP]\d[a-c]?$/.test(code) && !codes.has(code)) {
        codes.set(code, r);
        expect(book.value('Resumo', `I${r}`), code).toBe('Confere');
      }
    }
    expect([...codes.keys()]).toEqual(analysis.tests.filter((t) => t.state === 'on').map((t) => t.code));
    const listed: unknown[] = [];
    for (let r = 2; book.value('Excecoes', `A${r}`) !== null && book.value('Excecoes', `A${r}`) !== ''; r++) listed.push(book.value('Excecoes', `A${r}`));
    expect(listed).toHaveLength(analysis.findings.groupCounts.exception + analysis.findings.groupCounts.approval);
    for (const code of CT2_CHART_TESTS) expect(listed.filter((c) => c === code), code).toHaveLength(CHART_OCCURRENCES[code].length);
  });

  it('follows the configuration: a test off, a severity changed, other yes/no values', async () => {
    const config = ct2DefaultConfig();
    config.tests.C2.enabled = false;
    config.tests.C3.severity = 'info';
    // Only "Sim"/"Não": the codes 1/2 of account 71101001 become unknown.
    config.chart.yes = ['Sim'];
    config.chart.no = ['Não'];
    const { base: b, analysis: a } = await engine([extraction(), chart()], config);
    expect(test(a, 'C2').state).toBe('off');
    expect(test(a, 'C3')).toMatchObject({ state: 'on', severity: 'info' });
    expect(ct2Panel(b, a, {}).board.find((t) => t.code === 'C3')).toMatchObject({ group: 'info', link: 'ct2Base' });
    expect(marked(b, a, 'C1')).toEqual(CHART_OCCURRENCES.C1.filter((x) => x !== '000119-001'));
    expect(marked(b, a, 'C4')).toEqual(['000111-001']);
    expect(b.reconciliation.chart!.unknownFlags).toBe(CHART_EXPECTED.unknownFlags + 3);
  });

  it('needs the entity columns of the extraction: off without both sides, a side absent counts as empty (CI-9)', async () => {
    const without = (titles: string[]) => CT2_COLUMNS.filter((t) => !titles.includes(t.trim()));
    const none = await engine([extraction({ columns: without(['C Custo Deb', 'C Custo Crd']) }), chart()]);
    expect([test(none.analysis, 'C1').state, test(none.analysis, 'C3').state]).toEqual(['noColumn', 'noColumn']);
    expect(checkOf(none.analysis.checks, 'ct2-optional').message).toBe(
      'Colunas opcionais ausentes: C Custo Deb (I3a e I3b comparam as entidades sem ela; C1 e C3 desligados), C Custo Crd (I3a e I3b comparam as entidades sem ela; C1 e C3 desligados).',
    );
    const one = await engine([extraction({ columns: without(['C Custo Crd']) }), chart()]);
    expect(marked(one.base, one.analysis, 'C1')).toEqual(CHART_OCCURRENCES.C1);
    // The credit cost center of document 110 is not read: no C3 on that side.
    expect(marked(one.base, one.analysis, 'C3')).toEqual(['000113-001']);
    expect(checkOf(one.analysis.checks, 'ct2-optional').message).toBe('Colunas opcionais ausentes: C Custo Crd (I3a e I3b comparam as entidades sem ela; C1 e C3 consideram o lado vazio).');
  });
});

describe('chart of accounts: the session keeps it', () => {
  it('reapplies the tests with other parameters with the same chart, and exports', async () => {
    const { handle, events, summary } = await ingest([chart(), extraction()]);
    const c1 = summary!.analysis!.tests.find((t) => t.code === 'C1')!.occurrences;
    expect(c1).toBe(CHART_OCCURRENCES.C1.length);
    events.length = 0;
    await handle({ type: 'analyze', requestId: 1, parameters: { ...summary!.analysis!.parameters, toleranceCents: 1000 } });
    const e = events.find((x) => x.type === 'analyzed');
    if (e?.type !== 'analyzed' || !isCt2Summary(e.summary) || !isCt2Reconciliation(e.reconciliation)) throw new Error('sem análise');
    expect(e.summary.analysis!.tests.find((t) => t.code === 'C1')!.occurrences).toBe(c1);
    expect(e.reconciliation.chart).toMatchObject({ name: 'plano.xlsx', accounts: CHART_EXPECTED.accounts });
    expect(e.checks.filter((c) => c.id === 'ct2-chart')).toHaveLength(1);
    await handle({ type: 'export', requestId: 2, options: { scope: 0, language: 'pt', confirmFailures: true, generatedAt: '18/11/2026 10:00:00' } });
    expect(events.find((x) => x.type === 'exported')).toBeDefined();
  });

  it('runs the analysis again from the same Base and chart (pure)', async () => {
    const { base, analysis } = await engine([extraction(), chart()]);
    const again = analyzeCt2(base, ct2DefaultConfig(), new Set());
    for (const code of CT2_CHART_TESTS) expect(marked(base, again, code)).toEqual(marked(base, analysis, code));
  });
});
