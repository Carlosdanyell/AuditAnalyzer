import { describe, expect, it } from 'vitest';
import { CT2_TESTS, ct2DefaultConfig, type Ct2Field, type Ct2IntegrityConfig, type Ct2TestCode } from '../../src/config/ct2IntegritySchema';
import { formatDay, parseDate } from '../../src/shared/dates';
import { analyzeCt2, compensationText, documentRef, exceptionRow, hasMark, type Ct2Analysis } from '../../src/worker/modules/ct2Integrity/analysis';
import { analysisChecks } from '../../src/worker/modules/ct2Integrity/checks';
import { ingestCt2, type Ct2Ingested } from '../../src/worker/modules/ct2Integrity/ingest';
import { CT2_COLUMNS, ct2Blob, ct2Line, type Ct2ExtractionOptions } from '../synthetic/ct2Extraction';
import { ENGINE_E5, ENGINE_EXCEPTIONS, ENGINE_HOLIDAYS, ENGINE_INFO, ENGINE_ROWS } from '../synthetic/ct2EngineFixture';

/** Analysis of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md, sections 5, 6 and 8). */
const holidays = new Set(ENGINE_HOLIDAYS.map(parseDate));

async function run(files: Ct2ExtractionOptions[], config: Ct2IntegrityConfig = ct2DefaultConfig(), period?: { periodStart: number; periodEnd: number }) {
  const base = await ingestCt2(
    files.map((o, i) => ({ name: `${'abc'[i]}.xlsx`, blob: ct2Blob(o) })),
    config,
    () => {},
  );
  const analysis = analyzeCt2(base, config, holidays, period);
  return { base, analysis };
}

const segmentMark = (r: { balanceType: string; currency: string }) => (r.balanceType === '1' && r.currency === '01' ? '' : ` [${r.balanceType}/${r.currency}]`);

/** The exceptions as short texts (see ENGINE_EXCEPTIONS). */
function exceptions(base: Ct2Ingested, analysis: Ct2Analysis): string[] {
  return Array.from({ length: analysis.exceptions.count }, (_, k) => {
    const e = exceptionRow(analysis, base, k);
    const where =
      e.level === 'line'
        ? `linha ${e.document}-${e.line}`
        : e.level === 'document'
          ? `doc ${e.batch}/${e.document}`
          : e.level === 'batch'
            ? `lote ${formatDay(e.day)} ${e.batch}`
            : `dia ${formatDay(e.day)}`;
    return `${e.code} ${where}${segmentMark(e)}`;
  });
}

/** Documents (by number) with a mark of the test. */
function markedDocuments(base: Ct2Ingested, analysis: Ct2Analysis, code: Ct2TestCode): string[] {
  const out: string[] = [];
  for (let d = 0; d < analysis.blocks.documents; d++) if (hasMark(analysis.marks.document, d, code)) out.push(documentRef(analysis, base, d).document);
  return out;
}

const test = (analysis: Ct2Analysis, code: Ct2TestCode) => analysis.tests.find((t) => t.code === code)!;
const checkOf = (analysis: Ct2Analysis, id: string) => analysis.checks.find((c) => c.id === id)!;

describe('CT2 analysis: the synthetic cases of section 11', async () => {
  const { base, analysis } = await run([{ rows: ENGINE_ROWS }]);

  it('derives the parameters of the run: every month read and the defaults of the configuration', () => {
    expect(analysis.parameters).toEqual({
      periodStart: parseDate('01/09/2026'),
      periodEnd: parseDate('31/10/2026'),
      expectedBalanceType: '1',
      expectedCurrency: '01',
      localCurrency: '01',
      toleranceCents: 0,
      documentLineLimit: 1000,
    });
  });

  it('aggregates documents, batches, days and segments as blocks of the Base, in cents', () => {
    const b = analysis.blocks;
    expect(b.segments).toBe(3);
    // 1/01: 27 documents; 1/02: 43 and 50; 2/01: 42.
    expect(b.documents).toBe(30);
    expect(b.days).toBe(8);
    const d10 = Array.from({ length: b.documents }, (_, d) => d).find((d) => documentRef(analysis, base, d).document === '000010')!;
    expect(b.documentStart[d10 + 1]! - b.documentStart[d10]!).toBe(1000);
    expect(b.documentDebit[d10]).toBe(99_900 + 5_000);
    expect(b.documentCredit[d10]).toBe(99_900);
    const totalDebit = b.segmentDebit.reduce((s, v) => s + v, 0);
    expect(totalDebit).toBe(base.summary.segments.reduce((s, x) => s + x.debitCents, 0));
  });

  it('lists exactly the expected exceptions, by test and in the order of the Base', () => {
    expect(exceptions(base, analysis)).toEqual(ENGINE_EXCEPTIONS);
  });

  it('marks the duplicate after its first occurrence (E1)', () => {
    const k = exceptions(base, analysis).indexOf('E1 linha 000040-001');
    const e = exceptionRow(analysis, base, k);
    // Rows 4-6, document 1, 1.000 lines of document 10, ... the second line of document 40 comes right after the first.
    const first = ENGINE_ROWS.findIndex((r) => r.fields.document === '000040') + 4;
    expect(e.sourceRow).toBe(first + 1);
  });

  it('diagnoses each unbalanced document with the adjacent compensation, the next document first (B4)', () => {
    const results: Record<string, string> = {};
    for (let d = 0; d < analysis.blocks.documents; d++) {
      const text = compensationText(analysis, base, d);
      if (text !== null) results[documentRef(analysis, base, d).document] = text;
    }
    expect(results).toEqual(ENGINE_INFO.B4);
    expect(test(analysis, 'B4').detail).toBe('5 compensados pelo documento vizinho, 1 sem compensação');
  });

  it('marks the Info tests without listing them as exceptions (E2, E6, P3, P4)', () => {
    expect(markedDocuments(base, analysis, 'E2')).toEqual(ENGINE_INFO.E2);
    expect(markedDocuments(base, analysis, 'P3')).toEqual(ENGINE_INFO.P3);
    expect(markedDocuments(base, analysis, 'P4')).toEqual(ENGINE_INFO.P4);
    const days: string[] = [];
    for (let d = 0; d < analysis.blocks.days; d++) {
      if (hasMark(analysis.marks.day, d, 'E6')) days.push(formatDay(analysis.dayNumber[d]!));
    }
    expect(days).toEqual(ENGINE_INFO.E6);
  });

  it('counts the occurrences of every test for the board', () => {
    const counts = Object.fromEntries(analysis.tests.map((t) => [t.code, t.occurrences]));
    expect(counts).toEqual({
      B1: 6, B2: 2, B3: 2, B4: 6, B5: 1,
      I1: 6, I2: 2, I3: 1, I4: 1, I5: 1,
      E1: 1, E2: 2, E3: 1, E4: 2, E5: 0, E6: 2,
      // P1: groups of segment + routine (1/01 CTBA102 and CTBA500, 1/02 and 2/01 CTBA102) and of standard entry (4).
      P1: 8, P2: 5, P3: 3, P4: 1,
    });
    expect(analysis.tests.every((t) => t.state === 'on')).toBe(true);
    expect(analysis.exceptions.count).toBe(ENGINE_EXCEPTIONS.length);
    expect(test(analysis, 'P3').detail).toBe('1 Seq CTK em mais de um documento; 1 documento com mais de um Seq CTK');
  });

  it('profiles the Base by routine, standard entry and origin, never adding segments (P1, P2)', () => {
    const p = analysis.profile;
    const routine = p.routines.map((g) => `${g.balanceType}/${g.currency} ${g.value} ${g.lines}`);
    expect(routine).toEqual(['1/01 CTBA102 1034', '1/01 CTBA500 1', '1/02 CTBA102 2', '2/01 CTBA102 1']);
    expect(p.standardEntries.map((g) => `${g.balanceType}/${g.currency} ${g.value || '(vazio)'} ${g.lines}`)).toEqual([
      '1/01 (vazio) 1033',
      '1/01 610 2',
      '1/02 (vazio) 2',
      '2/01 (vazio) 1',
    ]);
    expect(p.manual.map((g) => `${g.balanceType}/${g.currency} ${g.origin} ${g.lines}`)).toEqual([
      '1/01 manual 1033',
      '1/01 automatic 1',
      '1/01 unidentified 1',
      '1/02 manual 2',
      '2/01 manual 1',
    ]);
    expect(p.largest[0]).toEqual({ document: expect.any(Number), lines: 1000 });
    expect(p.largest).toHaveLength(10);
  });

  it('passes the invariants CI-3, CI-5, CI-6 and, with every month read in the period, CI-10', () => {
    expect(checkOf(analysis, 'ct2-totals').passed).toBe(true);
    expect(checkOf(analysis, 'ct2-exceptions').passed).toBe(true);
    expect(checkOf(analysis, 'ct2-counts').passed).toBe(true);
    expect(checkOf(analysis, 'ct2-optional').passed).toBe(true);
    const period = checkOf(analysis, 'ct2-period');
    expect(period).toMatchObject({ severity: 'warning', passed: true, message: 'O período da análise (01/09/2026 a 31/10/2026) cobre todas as datas lidas.' });
  });
});

describe('CT2 analysis: configuration and parameters', () => {
  it('marks the lines outside an informed period (E5) and alerts that it does not cover every date (CI-10)', async () => {
    const september = { periodStart: parseDate('01/09/2026'), periodEnd: parseDate('30/09/2026') };
    const { base, analysis } = await run([{ rows: ENGINE_ROWS }], ct2DefaultConfig(), september);
    expect(analysis.parameters).toMatchObject(september);
    expect(exceptions(base, analysis)).toEqual([...ENGINE_EXCEPTIONS, ENGINE_E5]);
    const period = checkOf(analysis, 'ct2-period');
    expect(period).toMatchObject({ severity: 'warning', passed: false });
    expect(period.message).toMatch(/01\/09\/2026 a 30\/09\/2026.*1 linha fora dele \(apontadas no teste E5\)/);
  });

  it('follows the tolerance: a difference equal to it is balanced', async () => {
    const config = ct2DefaultConfig();
    config.parameters.toleranceCents = 1000;
    const { base, analysis } = await run([{ rows: ENGINE_ROWS }], config);
    const list = exceptions(base, analysis);
    // Document 20 (10,00), batch 3 and 15/09 (10,00) and batch 5 / 17/09 (5,00) are within the tolerance; 10 and 11 (50,00) are not.
    expect(list.filter((e) => e.startsWith('B'))).toEqual(['B1 doc 000002/000010', 'B1 doc 000002/000011']);
  });

  it('turns tests off and moves an Info test to the exceptions when its severity changes', async () => {
    const config = ct2DefaultConfig();
    config.tests.I1.enabled = false;
    config.tests.E2.severity = 'warning';
    const { base, analysis } = await run([{ rows: ENGINE_ROWS }], config);
    const list = exceptions(base, analysis);
    expect(list.some((e) => e.startsWith('I1'))).toBe(false);
    expect(list.filter((e) => e.startsWith('E2'))).toEqual(['E2 doc 000006/000040', 'E2 doc 000006/000041']);
    expect(test(analysis, 'I1')).toMatchObject({ state: 'off', occurrences: 0 });
    expect(checkOf(analysis, 'ct2-exceptions').passed).toBe(true);
  });

  it('finds duplicates between two files (E1) and counts the document once in each segment', async () => {
    const copy = ct2Line({ line: '001', amount: 100, amountCurrency1: 100 });
    const { base, analysis } = await run([{ rows: ENGINE_ROWS }, { rows: [copy] }]);
    const list = exceptions(base, analysis);
    expect(list.filter((e) => e.startsWith('E1'))).toEqual(['E1 linha 000001-001', 'E1 linha 000040-001']);
    const e1 = exceptionRow(analysis, base, list.indexOf('E1 linha 000001-001'));
    expect(e1.file).toBe(1);
    // The duplicated line doubles document 1 (balanced) and gives it a gap in the numbering (2 lines, last 001).
    expect(markedDocuments(base, analysis, 'E2')).toEqual(['000001', ...ENGINE_INFO.E2]);
  });

  it('turns off the tests of an optional column absent from every file (CI-9)', async () => {
    const columns = CT2_COLUMNS.filter((t) => !['Valor Moeda1', 'Seq CTK'].includes(t.trim()));
    const { analysis } = await run([{ rows: ENGINE_ROWS, columns }]);
    expect(test(analysis, 'I4')).toMatchObject({ state: 'noColumn', occurrences: 0 });
    expect(test(analysis, 'P3')).toMatchObject({ state: 'noColumn', occurrences: 0 });
    const optional = checkOf(analysis, 'ct2-optional');
    expect(optional).toMatchObject({ severity: 'warning', passed: false });
    expect(optional.message).toBe('Colunas opcionais ausentes: Valor Moeda1 (I4 desligado), Seq CTK (P3 desligado).');
  });

  it('says which files lack an optional column present in others (CI-9)', async () => {
    const columns = CT2_COLUMNS.filter((t) => t.trim() !== 'Valor Moeda1');
    const { analysis } = await run([{ rows: ENGINE_ROWS }, { rows: [ct2Line({ document: '000099' })], columns }]);
    expect(test(analysis, 'I4').state).toBe('on');
    expect(checkOf(analysis, 'ct2-optional').message).toBe('Colunas opcionais ausentes em parte dos arquivos: Valor Moeda1 em b.xlsx (I4 não testa essas linhas).');
  });

  it('runs on an extraction without any valid date: no period, E5 and E6 have nothing to test', async () => {
    const { analysis } = await run([{ rows: [ct2Line({ date: '31/02/2026' })] }]);
    expect(analysis.parameters.periodStart).toBeNull();
    expect(test(analysis, 'E5').occurrences).toBe(0);
    expect(checkOf(analysis, 'ct2-period').passed).toBe(true);
  });
});

describe('CT2 analysis: the invariants catch a broken analysis', async () => {
  const fresh = () => run([{ rows: ENGINE_ROWS }]);

  it('CI-3 fails when a level does not add up to the rows', async () => {
    const { base } = await fresh();
    base.summary.segments[0]!.debitCents += 1;
    const analysis = analyzeCt2(base, ct2DefaultConfig(), holidays);
    const totals = checkOf(analysis, 'ct2-totals');
    expect(totals.passed).toBe(false);
    expect(totals.message).toMatch(/totais da leitura com débito/);
  });

  it('CI-6 fails when the counts of the reading differ from the distinct keys', async () => {
    const { base } = await fresh();
    base.summary.batches += 1;
    const analysis = analyzeCt2(base, ct2DefaultConfig(), holidays);
    expect(checkOf(analysis, 'ct2-counts')).toMatchObject({ passed: false, message: expect.stringMatching(/lotes: \d+ blocos, \d+ chaves distintas, \d+ na leitura/) });
  });

  it('CI-5 fails when a mark is not in the list of exceptions', async () => {
    const { base, analysis } = await fresh();
    const config = ct2DefaultConfig();
    const marks = { ...analysis.marks, line: analysis.marks.line.slice() };
    marks.line[0]! |= 1 << CT2_TESTS.indexOf('I5');
    const present = new Set(base.reconciliation.files.flatMap((f) => f.header.mapped.map((m) => m.field as Ct2Field)));
    const checks = analysisChecks({
      base,
      blocks: analysis.blocks,
      marks,
      exceptions: analysis.exceptions,
      isException: (code) => config.tests[code].severity !== 'info',
      present,
      state: () => 'on',
      parameters: analysis.parameters,
      config,
    });
    expect(checks.find((c) => c.id === 'ct2-exceptions')).toMatchObject({ passed: false, message: 'A lista de exceções não confere com as marcas: I5: 2 marcadas e 1 listadas.' });
  });
});
