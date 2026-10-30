import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig, type Ct2IntegrityConfig, type Ct2TestCode } from '../../src/config/ct2IntegritySchema';
import { formatDay, parseDate } from '../../src/shared/dates';
import { analyzeCt2, compensationText, documentRef, hasMark } from '../../src/worker/modules/ct2Integrity/analysis';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { BASE_SHEET_ROWS, MAX_EXPORT_ROWS, buildCt2Workpaper, ct2FileName } from '../../src/worker/modules/ct2Integrity/workpaper';
import { CT2_LABELS } from '../../src/worker/modules/ct2Integrity/workpaperLabels';
import type { Language } from '../../src/worker/export/labels';
import { ct2Blob, ct2Line, type Ct2ExtractionOptions } from '../synthetic/ct2Extraction';
import { ENGINE_HOLIDAYS, ENGINE_ROWS } from '../synthetic/ct2EngineFixture';
import { Workbook, type Value } from '../support/xlsxEval';

/** The CT2 workpaper tied out by formulas (docs/REGRAS_CT2_INTEGRIDADE.md, section 7), evaluated by the test evaluator. */
const holidays = ENGINE_HOLIDAYS.map(parseDate);

async function build(o: { files?: Ct2ExtractionOptions[]; config?: Ct2IntegrityConfig; language?: Language; sheetRows?: number; maxRows?: number; baseSheetRows?: number } = {}) {
  const config = o.config ?? ct2DefaultConfig();
  const ingested = await ingestCt2(
    (o.files ?? [{ rows: ENGINE_ROWS }]).map((f, i) => ({ name: `${'abc'[i]}.xlsx`, blob: ct2Blob(f) })),
    config,
    () => {},
  );
  const analysis = analyzeCt2(ingested, config, new Set(holidays));
  const out = await buildCt2Workpaper(
    {
      base: ingested,
      analysis,
      config,
      holidays,
      language: o.language ?? 'pt',
      generatedAt: '29/10/2026 10:30:00',
      appVersion: 'teste',
      configHash: 'hash',
      configDifferences: [],
      confirmedFailures: [],
      ...(o.sheetRows !== undefined && { sheetRows: o.sheetRows }),
      ...(o.maxRows !== undefined && { maxRows: o.maxRows }),
      ...(o.baseSheetRows !== undefined && { baseSheetRows: o.baseSheetRows }),
    },
    () => {},
  );
  const book = await Workbook.read(out.blob);
  return { ingested, analysis, out, book, L: CT2_LABELS[o.language ?? 'pt'] };
}

/** Values of a column of a data sheet, by its header (row 1). */
function column(book: Workbook, sheet: string, header: string): Value[] {
  const cells = book.sheets.get(sheet)!;
  let letter = '';
  let last = 1;
  for (const [ref, c] of cells) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    if (m[2] === '1' && c.v === header) letter = m[1]!;
    last = Math.max(last, Number(m[2]));
  }
  if (!letter) throw new Error(`Coluna ${header} ausente em ${sheet}`);
  return Array.from({ length: last - 1 }, (_, i) => book.value(sheet, `${letter}${i + 2}`));
}

/** Rows of a sheet whose column A holds `text`: the evaluated cells of the row. */
function rowOf(book: Workbook, sheet: string, text: string, from = 1): { r: number; cells: (col: string) => Value } {
  const cells = book.sheets.get(sheet)!;
  for (let r = from; r < 2000; r++) if (cells.get(`A${r}`)?.v === text) return { r, cells: (c) => book.value(sheet, `${c}${r}`) };
  throw new Error(`${text} ausente em ${sheet}`);
}

const yes = (L: { yes: string; no: string }, marked: boolean) => (marked ? L.yes : L.no);

describe('CT2 workpaper: sheets and tie-out', async () => {
  const { ingested, analysis, out, book, L } = await build();

  it('has the sheets of section 7.3, the defined names of the parameters and a dated file name', () => {
    expect([...book.sheets.keys()]).toEqual(['Resumo', 'Criterios', 'Documentos', 'Lotes', 'Dias', 'Excecoes', 'Perfil', 'Base', 'Rastreabilidade']);
    for (const n of ['P_DATA_INI', 'P_DATA_FIM', 'P_SALDO', 'P_MOEDA', 'P_MOEDA_LOCAL', 'P_TOL', 'P_LIMITE_LINHAS', 'P_TIPO_PD', 'P_TIPO_DEB', 'P_TIPO_CRED', 'P_TIPO_HIST', 'P_FERIADOS']) {
      expect(book.names.has(n), n).toBe(true);
    }
    expect(out.fileName).toBe('CT2_Integridade_2026-09_a_2026-10_2026-10-29.xlsx');
    expect(out.minDateSerial).toBeGreaterThan(367);
  });

  it('ties out every level: the matrix is all OK and Excel computes what the engine did', () => {
    for (const level of ['Base', 'Documentos', 'Lotes', 'Dias', 'Ferramenta (motor)']) {
      const row = rowOf(book, 'Resumo', level, 10);
      expect(row.cells('G'), level).toBe('OK');
    }
    const base = rowOf(book, 'Resumo', 'Base', 10);
    expect(base.cells('B')).toBe(ingested.summary.lines);
    const max = rowOf(book, 'Resumo', 'Maior diferença');
    for (const c of ['B', 'C', 'D', 'E', 'F']) expect(max.cells(c), c).toBe(0);
  });

  it('confirms every test of the board ("Confere") and every exception at its source', () => {
    for (const t of analysis.tests.filter((x) => x.state === 'on')) {
      const row = rowOf(book, 'Resumo', t.code, 10);
      expect(row.cells('I'), t.code).toBe('Confere');
      expect(row.cells('E'), t.code).toBe(t.occurrences);
    }
    const confirmed = column(book, 'Excecoes', 'Confirmada na origem?');
    expect(confirmed).toHaveLength(analysis.exceptions.count);
    expect(confirmed.every((v) => v === 'Sim')).toBe(true);
    // Erro first, then Alerta.
    const severities = column(book, 'Excecoes', 'Severidade');
    expect(severities.indexOf('Alerta')).toBeGreaterThan(severities.lastIndexOf('Erro'));
  });

  it('gives each document, batch and day the statuses of the engine', () => {
    const b1 = column(book, 'Documentos', 'B1 Desbalanceado?');
    const b4 = column(book, 'Documentos', 'B4 Compensação adjacente');
    const e2 = column(book, 'Documentos', 'E2 Lacuna na numeração?');
    for (let d = 0; d < analysis.blocks.documents; d++) {
      expect(b1[d], `B1 ${d}`).toBe(yes(L, hasMark(analysis.marks.document, d, 'B1')));
      expect(b4[d], `B4 ${d}`).toBe(compensationText(analysis, ingested, d) ?? '');
      if (e2[d] !== '') expect(e2[d], `E2 ${d}`).toBe(yes(L, hasMark(analysis.marks.document, d, 'E2')));
    }
    const b2 = column(book, 'Lotes', 'B2 Desbalanceado?');
    b2.forEach((v, k) => expect(v, `B2 ${k}`).toBe(yes(L, hasMark(analysis.marks.batch, k, 'B2'))));
    const e6 = column(book, 'Dias', 'E6 Dia não útil?');
    expect(column(book, 'Dias', 'Data').filter((_, k) => e6[k] === 'Sim').map((v) => formatDay((v as number) - 36526))).toEqual(['07/09/2026', '19/09/2026']);
  });

  it('marks each line of the Base as the engine did, test by test', () => {
    for (const code of ['I1', 'I2', 'I3', 'I4', 'I5', 'E1', 'E3', 'E4', 'E5'] as Ct2TestCode[]) {
      const values = column(book, 'Base', `${code} Exceção?`);
      values.forEach((v, pos) => expect(v, `${code} linha ${pos + 2}`).toBe(yes(L, hasMark(analysis.marks.line, pos, code))));
    }
    const exceptions = column(book, 'Base', 'Exceções na linha');
    const docs = column(book, 'Documentos', 'Linhas com exceção');
    expect(docs).toEqual(Array.from(analysis.documentExceptionLines));
    expect(exceptions.filter((v) => (v as number) > 0)).toHaveLength(docs.reduce<number>((n, v) => n + (v as number), 0));
  });

  it('profiles the Base by formula with the counts of the engine', () => {
    for (const r of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      const label = book.value('Perfil', `G${r}`);
      if (label === 'Confere' || label === 'Verificar') expect(label, `Perfil linha ${r}`).toBe('Confere');
    }
    const p3 = rowOf(book, 'Perfil', 'Documentos com Seq CTK repetido entre documentos ou mais de um no documento');
    expect(p3.cells('C')).toBe(3);
  });

  it('lists the unbalanced documents on the Resumo through Documentos', () => {
    const head = rowOf(book, 'Resumo', 'Linha em Documentos');
    const docs = [1, 2, 3, 4, 5, 6].map((k) => book.value('Resumo', `E${head.r + k}`));
    expect(docs).toEqual(['000010', '000011', '000020', '000060', '000061', '000062']);
    const d10 = Array.from({ length: analysis.blocks.documents }, (_, d) => d).find((d) => documentRef(analysis, ingested, d).document === '000010')!;
    expect(book.value('Resumo', `A${head.r + 1}`)).toBe(d10 + 2);
  });
});

describe('CT2 workpaper: parameters recalculate the statuses as the engine', () => {
  it('a tolerance typed in Criterios (P_TOL) balances what the engine balances with the same tolerance', async () => {
    const { book } = await build();
    const ref = book.names.get('P_TOL')!.replace(/^.*!/, '').replace(/\$/g, '');
    book.set('Criterios', ref, 10);
    const config = ct2DefaultConfig();
    config.parameters.toleranceCents = 1000;
    const engine = await build({ config });
    const b1 = column(book, 'Documentos', 'B1 Desbalanceado?');
    for (let d = 0; d < engine.analysis.blocks.documents; d++) expect(b1[d], `B1 ${d}`).toBe(yes(engine.L, hasMark(engine.analysis.marks.document, d, 'B1')));
    expect(b1.filter((v) => v === 'Sim')).toHaveLength(2);
  });

  it('a period typed in Criterios marks E5 on the lines outside it', async () => {
    const { book } = await build();
    const end = book.names.get('P_DATA_FIM')!.replace(/^.*!/, '').replace(/\$/g, '');
    book.set('Criterios', end, parseDate('30/09/2026') + 36526);
    expect(column(book, 'Base', 'E5 Exceção?').filter((v) => v === 'Sim')).toHaveLength(1);
  });
});

describe('CT2 workpaper: configuration, language, limits and determinism', () => {
  it('leaves out the columns of the tests turned off, and they leave the board', async () => {
    const config = ct2DefaultConfig();
    config.tests.I5.enabled = false;
    const { book } = await build({ config });
    expect(() => column(book, 'Base', 'I5 Exceção?')).toThrow();
    expect(() => rowOf(book, 'Resumo', 'I5', 10)).toThrow();
  });

  it('writes the English workpaper with English sheets and values', async () => {
    const { book, out } = await build({ language: 'en' });
    expect([...book.sheets.keys()]).toEqual(['Summary', 'Criteria', 'Documents', 'Batches', 'Days', 'Exceptions', 'Profile', 'Base', 'Traceability']);
    expect(column(book, 'Exceptions', 'Confirmed at the source?').every((v) => v === 'Yes')).toBe(true);
    expect(out.fileName).toBe('CT2_Integrity_2026-09_to_2026-10_2026-10-29.xlsx');
  });

  it('continues the exceptions on other sheets above the row limit, still tied out', async () => {
    // Three lines with five exceptions each (I1, I2, I5, E3, E4) and 5 data rows per sheet: three sheets of exceptions.
    const bad = (k: number) => ct2Line({ document: `00090${k}`, entryType: 'XYZ', amount: 0, amountCurrency1: 0, history: ' ', balanceType: '9', currency: '07' });
    const { book, analysis } = await build({ files: [{ rows: [bad(1), bad(2), bad(3)] }], sheetRows: 6 });
    expect(analysis.exceptions.count).toBe(15);
    expect([...book.sheets.keys()].filter((x) => x.startsWith('Excecoes'))).toEqual(['Excecoes', 'Excecoes (2)', 'Excecoes (3)']);
    for (const sheet of ['Excecoes', 'Excecoes (2)', 'Excecoes (3)']) expect(column(book, sheet, 'Confirmada na origem?')).toEqual(['Sim', 'Sim', 'Sim', 'Sim', 'Sim']);
    for (const code of ['I1', 'I2', 'I5', 'E3', 'E4']) {
      const row = rowOf(book, 'Resumo', code, 10);
      expect([row.cells('E'), row.cells('F'), row.cells('H'), row.cells('I')], code).toEqual([3, 3, 3, 'Confere']);
    }
    expect(book.value('Resumo', `B${rowOf(book, 'Resumo', 'Exceções de Erro').r}`)).toBe(6);
  });

  it('continues the Base on other sheets at a day boundary, and every level still ties out (decision of 30/10/2026)', { timeout: 60_000 }, async () => {
    const whole = await build();
    const { book, analysis, ingested } = await build({ baseSheetRows: 20 });
    const bases = [...book.sheets.keys()].filter((x) => x.startsWith('Base'));
    expect(bases.length).toBeGreaterThan(2);
    expect(bases).toEqual(bases.map((_, k) => (k === 0 ? 'Base' : `Base (${k + 1})`)));
    // The Base sheets sit where the Base was: after Perfil, before Rastreabilidade.
    const names = [...book.sheets.keys()];
    expect(names.slice(names.indexOf('Perfil') + 1, names.indexOf('Rastreabilidade'))).toEqual(bases);
    // No day is cut: each segment + date lives in one sheet; a sheet passes 20 rows only when it holds a single day.
    const home = new Map<string, string>();
    let lines = 0;
    for (const sheet of bases) {
      const segments = column(book, sheet, 'Segmento');
      const dates = column(book, sheet, 'Data Lcto');
      const n = segments.length;
      lines += n;
      const days = new Set(segments.map((s, k) => `${s}|${dates[k]}`));
      if (n > 20) expect(days.size, sheet).toBe(1);
      for (const d of days) {
        expect(home.get(d) ?? sheet, d).toBe(sheet);
        home.set(d, sheet);
      }
    }
    expect(lines).toBe(ingested.summary.lines);
    // The matrix, the board, the exceptions and the profile give what the whole Base gives.
    for (const level of ['Base', 'Documentos', 'Lotes', 'Dias', 'Ferramenta (motor)']) {
      const split = rowOf(book, 'Resumo', level, 10);
      const one = rowOf(whole.book, 'Resumo', level, 10);
      expect(['B', 'C', 'D', 'E', 'F', 'G'].map(split.cells), level).toEqual(['B', 'C', 'D', 'E', 'F', 'G'].map(one.cells));
      expect(split.cells('G'), level).toBe('OK');
    }
    for (const t of analysis.tests.filter((x) => x.state === 'on')) {
      const row = rowOf(book, 'Resumo', t.code, 10);
      expect([row.cells('E'), row.cells('I')], t.code).toEqual([t.occurrences, 'Confere']);
    }
    expect(column(book, 'Excecoes', 'Confirmada na origem?').every((v) => v === 'Sim')).toBe(true);
    // A line exception points to the Base sheet that holds its line.
    const origin = column(book, 'Excecoes', 'Aba de origem');
    expect(origin.filter((v) => typeof v === 'string' && v.startsWith('Base (')).length).toBeGreaterThan(0);
    for (const r of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      const label = book.value('Perfil', `G${r}`);
      if (label === 'Confere' || label === 'Verificar') expect(label, `Perfil linha ${r}`).toBe('Confere');
    }
    // Documentos says which Base sheet holds each document; its rows are rows of that sheet.
    const docSheet = column(book, 'Documentos', 'Aba da Base');
    expect(docSheet).toHaveLength(analysis.blocks.documents);
    expect(new Set(docSheet)).toEqual(new Set(bases));
    // Each line keeps the marks of the engine, sheet after sheet.
    const marks = bases.flatMap((sheet) => column(book, sheet, 'I1 Exceção?'));
    marks.forEach((v, pos) => expect(v, `I1 linha ${pos}`).toBe(yes(whole.L, hasMark(analysis.marks.line, pos, 'I1'))));
  });

  it('keeps one Base sheet, without the sheet column in Documentos, up to the rows of a sheet', async () => {
    expect(BASE_SHEET_ROWS).toBe(300_000);
    const { book } = await build();
    expect([...book.sheets.keys()].filter((x) => x.startsWith('Base'))).toEqual(['Base']);
    expect(() => column(book, 'Documentos', 'Aba da Base')).toThrow();
  });

  it('blocks a Base above the rows a workpaper can recalculate (CI-8; decision of 30/10/2026), and a day above a sheet', async () => {
    expect(MAX_EXPORT_ROWS).toBe(600_000);
    const above = await build({ files: [{ rows: ENGINE_ROWS.slice(0, 8) }], maxRows: 7 }).catch((e: Error) => e);
    expect(above).toBeInstanceOf(Error);
    expect((above as Error).message).toBe(
      'CI-8: a base tem 8 linhas e a planilha amarrada por fórmulas aceita até 7 linhas por exportação (acima disso o Excel não recalcula em tempo viável). Divida a extração, por exemplo por semestre ou trimestre, e analise cada parte.',
    );
    // At the limit it is exported.
    await expect(build({ files: [{ rows: ENGINE_ROWS.slice(0, 8) }], maxRows: 8 })).resolves.toBeDefined();
    // Days are never cut: a day with more lines than a sheet holds cannot be written.
    const day = (date: string, n: number) => Array.from({ length: n }, (_, k) => ct2Line({ date, document: '000001', line: String(k + 1).padStart(3, '0'), amount: 10, amountCurrency1: 10 }));
    const big = await build({ files: [{ rows: day('15/09/2026', 6) }], sheetRows: 6 }).catch((e: Error) => e);
    expect((big as Error).message).toBe('CI-8: o dia 15/09/2026 (saldo 1, moeda 01) tem 6 linhas e não cabe numa aba da Base (até 5 linhas).');
    // Two days of 4 lines in sheets of 5 rows: two Base sheets.
    const two = await build({ files: [{ rows: [...day('15/09/2026', 4), ...day('16/09/2026', 4)] }], sheetRows: 6 });
    expect([...two.book.sheets.keys()].filter((x) => x.startsWith('Base'))).toEqual(['Base', 'Base (2)']);
    expect(rowOf(two.book, 'Resumo', 'Base', 10).cells('G')).toBe('OK');
  });

  it('is deterministic: the same input gives the same bytes', async () => {
    const one = await build();
    const two = await build();
    expect(new Uint8Array(await one.out.blob.arrayBuffer())).toEqual(new Uint8Array(await two.out.blob.arrayBuffer()));
  });

  it('names the file by its only month when the period has one', () => {
    const sep = parseDate('01/09/2026');
    expect(ct2FileName('pt', sep, parseDate('30/09/2026'), '29/10/2026 10:30:00')).toBe('CT2_Integridade_2026-09_2026-10-29.xlsx');
  });
});
