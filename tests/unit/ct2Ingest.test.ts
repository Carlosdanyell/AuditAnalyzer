import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { parseDate } from '../../src/shared/dates';
import { CT2_STAGES, isCt2Reconciliation, isCt2Summary, type Ct2Reconciliation, type Ct2Summary } from '../../src/shared/modules/ct2Integrity';
import type { WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { buildCfgr700 } from '../synthetic/cfgr700';
import { CT2_COLUMNS, ct2Blob, ct2Line, type Ct2ExtractionOptions, buildCt2Extraction } from '../synthetic/ct2Extraction';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { fileA, fileB } from '../synthetic/ct2Fixtures';
import { fileA as cfgr700FileA } from '../synthetic/fixtures';

/** Reading of the CT2 extraction through the worker (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-4 and 8). */
const file = (name: string, o: Ct2ExtractionOptions) => new File([buildCt2Extraction(o) as Uint8Array<ArrayBuffer>], name);

async function ingest(files: File[], config: unknown = ct2DefaultConfig(), inflateMode: 'auto' | 'fallback' = 'auto', sheets?: (string | null)[]) {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e), { now: () => 0, inflateMode });
  await handle({ type: 'ingest', module: 'ct2Integrity', files, config, ...(sheets && { sheets }) });
  const error = events.find((e) => e.type === 'error');
  const recon = events.find((e) => e.type === 'reconciliation');
  const ready = events.find((e) => e.type === 'ready');
  const reconciliation = recon?.type === 'reconciliation' && isCt2Reconciliation(recon.data) ? recon.data : null;
  const summary = ready?.type === 'ready' && isCt2Summary(ready.summary) ? ready.summary : null;
  return { events, handle, error, reconciliation, summary };
}

const check = (r: Ct2Reconciliation | null, id: string) => r?.checks.find((c) => c.id === id);

/** The sheet XML of a synthetic extraction, edited (cells added to a row, an end tag removed). */
function editSheet(bytes: Uint8Array, edit: (xml: string) => string): Uint8Array {
  const entries = unzipSync(bytes);
  const name = 'xl/worksheets/sheet1.xml';
  entries[name] = new TextEncoder().encode(edit(new TextDecoder().decode(entries[name])));
  return zipSync(entries);
}
const withCells = (bytes: Uint8Array, r: number, cells: string) =>
  new Blob([
    editSheet(bytes, (xml) => {
      const end = xml.indexOf('</row>', xml.indexOf(`<row r="${r}"`));
      return xml.slice(0, end) + cells + xml.slice(end);
    }) as Uint8Array<ArrayBuffer>,
  ]);
const sharedStrings = (bytes: Uint8Array) =>
  [...new TextDecoder().decode(unzipSync(bytes)['xl/sharedStrings.xml']).matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);

describe('CT2 reading: one file', () => {
  it('reconciles the rows of the sheet: rows after the header − blank rows = detail rows (CI-1)', async () => {
    const { reconciliation: r, events } = await ingest([file('a.xlsx', fileA())]);
    expect(r).not.toBeNull();
    const f = r!.files[0]!;
    expect(f.sheetName).toBe('SCACKST0.XML');
    expect(f.header.row).toBe(3);
    expect(f.header.mapped).toHaveLength(20);
    expect(f.header.mapped[10]).toEqual({ field: 'amount', title: 'Valor', column: 11 });
    expect(f.header.missingOptional).toEqual([]);
    expect(f.header.unmapped).toHaveLength(60);
    expect(f.rows).toEqual({
      dimensionRows: 16,
      totalRows: 16,
      headerRow: 3,
      rowsAfterHeader: 13,
      blankRows: 3,
      missingRows: 2,
      detailRows: 10,
      balanced: true,
      outsideCells: 0,
    });
    expect(f.entries.every((e) => e.ok)).toBe(true);
    expect(check(r, 'ct2-reading')).toMatchObject({ passed: true, severity: 'error' });
    const stages = events.filter((e) => e.type === 'progress').map((e) => (e.type === 'progress' ? e.stage : ''));
    expect(stages.filter((s, i) => s !== stages[i - 1])).toEqual([...CT2_STAGES]);
    expect(events.filter((e) => e.type !== 'progress').map((e) => e.type)).toEqual(['reconciliation', 'ready']);
  });

  it('flags unreadable values (CI-4, blocking): incomplete key, empty line and segment, amount and date', async () => {
    const { reconciliation: r } = await ingest([file('a.xlsx', fileA())]);
    expect(r!.files[0]!.unreadable).toEqual({
      incompleteKey: 1,
      line: 1,
      segment: 1,
      date: 1,
      amount: 2,
      code: 0,
      sharedString: 0,
      rows: 3,
      examples: [13, 14, 15],
    });
    const ci4 = check(r, 'ct2-values');
    expect(ci4).toMatchObject({ passed: false, severity: 'error' });
    expect(ci4!.message).toMatch(/a\.xlsx: linhas 13, 14, 15/);
  });

  it('sorts the Base in contiguous blocks (CI-2) and totals each segment without mixing currencies', async () => {
    const { reconciliation: r, summary: s } = await ingest([file('a.xlsx', fileA())]);
    expect(check(r, 'ct2-order')).toMatchObject({ passed: true });
    const day = parseDate('15/09/2026');
    expect(s).toEqual<Ct2Summary>({
      module: 'ct2Integrity',
      lines: 10,
      segments: [
        { balanceType: '', currency: '', lines: 1, documents: 1, debitCents: 0, creditCents: 0 },
        { balanceType: '1', currency: '01', lines: 8, documents: 6, debitCents: 151456, creditCents: 151456 },
        { balanceType: '1', currency: '02', lines: 1, documents: 1, debitCents: 10000, creditCents: 10000 },
      ],
      documents: 8,
      batches: 4,
      days: 4,
      firstDay: day,
      lastDay: day,
      // The analysis itself is tested in ct2Analysis.test.ts.
      analysis: expect.objectContaining({ exceptions: expect.any(Number) }),
    });
  });

  it('answers the panel as not offered yet and exports the workpaper, blocked until a failed check is confirmed', async () => {
    const { handle, events } = await ingest([file('a.xlsx', fileA())]);
    events.length = 0;
    await handle({ type: 'panel', requestId: 1, scope: 0, period: null, cutoffDay: null });
    await handle({ type: 'export', requestId: 2, options: { scope: 0, language: 'pt', confirmFailures: false, generatedAt: '29/10/2026 10:30:00' } });
    await handle({ type: 'export', requestId: 3, options: { scope: 0, language: 'pt', confirmFailures: true, generatedAt: '29/10/2026 10:30:00' } });
    const answers = events.filter((e) => e.type !== 'progress');
    expect(answers.map((e) => (e.type === 'error' ? e.message : e.type))).toEqual(['Recurso não disponível nesta análise.', 'exportBlocked', 'exported']);
    const exported = answers[2]!;
    expect(exported.type === 'exported' && exported.fileName).toBe('CT2_Integridade_2026-09_2026-10-29.xlsx');
  });
});

describe('CT2 reading: several files and layouts', () => {
  it('joins the files in one Base, columns by title, with an alert when the columns differ', async () => {
    const { reconciliation: r, summary: s } = await ingest([file('a.xlsx', fileA()), file('b.xlsx', fileB())]);
    expect(r!.files.map((f) => f.rows.detailRows)).toEqual([10, 3]);
    expect(r!.files[1]!.header.mapped.find((m) => m.field === 'amount')).toEqual({ field: 'amount', title: 'CT2_VALOR', column: 11 });
    expect(r!.consolidated.detailRows).toBe(13);
    expect(r!.consolidated.alerts.map((a) => a.message)).toEqual([
      'As extrações não têm as mesmas colunas: b.xlsx tem Campo Exclusivo B, que falta em a.xlsx. As colunas foram unidas pelo título.',
    ]);
    expect(s!.lines).toBe(13);
    expect(s!.segments[1]).toMatchObject({ lines: 11, documents: 7, debitCents: 151456 + 27000, creditCents: 151456 + 27000 });
    const reversed = await ingest([file('b.xlsx', fileB()), file('a.xlsx', fileA())]);
    expect(reversed.summary).toEqual(s);
  });

  it('gives the same result twice, and with the fallback decompression', async () => {
    const one = await ingest([file('a.xlsx', fileA()), file('b.xlsx', fileB())]);
    const two = await ingest([file('a.xlsx', fileA()), file('b.xlsx', fileB())], ct2DefaultConfig(), 'fallback');
    expect(JSON.stringify(two.reconciliation)).toBe(JSON.stringify(one.reconciliation));
    expect(two.summary).toEqual(one.summary);
  });

  it('reads the sheet that has the header when the workbook has several', async () => {
    const { reconciliation: r } = await ingest([file('a.xlsx', fileA({ extraSheets: { Resumo: [['Totais'], ['Linhas', 10]] } }))]);
    expect(r!.files[0]!.sheetName).toBe('SCACKST0.XML');
    expect(r!.files[0]!.sheetNames).toEqual(['Resumo', 'SCACKST0.XML']);
    const two = await ingest([file('a.xlsx', fileA({ extraSheets: { Copia: [[], [], [...CT2_COLUMNS]] } }))]);
    expect(two.error).toMatchObject({ stage: 'rows', message: 'Mais de uma aba de a.xlsx tem o cabeçalho da extração CT2: Copia, SCACKST0.XML. Escolha a aba na lista de arquivos.' });
  });

  it('reads the sheet chosen in the list of files, even when another sheet has the header too', async () => {
    const twoHeaders = () => file('a.xlsx', fileA({ extraSheets: { Copia: [[], [], [...CT2_COLUMNS]] } }));
    const chosen = await ingest([twoHeaders()], ct2DefaultConfig(), 'auto', ['SCACKST0.XML']);
    expect(chosen.error).toBeUndefined();
    expect(chosen.reconciliation!.files[0]!.sheetName).toBe('SCACKST0.XML');
    expect(chosen.reconciliation!.files[0]!.rows.detailRows).toBe(10);
    // A null choice is the automatic one.
    const auto = await ingest([file('a.xlsx', fileA())], ct2DefaultConfig(), 'auto', [null]);
    expect(auto.reconciliation!.files[0]!.sheetName).toBe('SCACKST0.XML');
  });

  it('reads only the chosen sheet: without the header there, or absent from the file, it says so', async () => {
    const withSummary = () => file('a.xlsx', fileA({ extraSheets: { Resumo: [['Totais'], ['Linhas', 10]] } }));
    const noHeader = await ingest([withSummary()], ct2DefaultConfig(), 'auto', ['Resumo']);
    expect(noHeader.error).toMatchObject({ stage: 'rows', message: 'Cabeçalho da extração CT2 não encontrado nas primeiras 30 linhas da aba "Resumo" de a.xlsx.' });
    const absent = await ingest([withSummary()], ct2DefaultConfig(), 'auto', ['Nada']);
    expect(absent.error).toMatchObject({ stage: 'rows', message: 'A aba "Nada" não existe em a.xlsx. Abas do arquivo: Resumo, SCACKST0.XML.' });
  });

  it('reads the 1904 date system, keeps a repeated unmapped title apart and flags a numeric code that is not whole', async () => {
    // 15/09/2026 is serial 46280 counted from 1900 and 44818 counted from 1904.
    const rows = [ct2Line({ date: 44818 }), ct2Line({ line: '002', date: 44818, document: 3.5 })];
    const columns = [...CT2_COLUMNS, 'Filial'];
    const { reconciliation: r, summary: s } = await ingest([file('a.xlsx', { rows, columns, date1904: true })]);
    expect(s!.firstDay).toBe(parseDate('15/09/2026'));
    expect(r!.files[0]!.unreadable).toMatchObject({ code: 1, date: 0, rows: 1, examples: [5] });
    expect(r!.files[0]!.header.unmapped.filter((t) => t.startsWith('Filial'))).toEqual(['Filial', 'Filial [2]']);
  });

  it('warns about an absent optional column and an unreadable "Valor Moeda1", without blocking', async () => {
    const columns = CT2_COLUMNS.filter((t) => t.trim() !== 'Rotina');
    const rows = [ct2Line({ amountCurrency1: 'x' })];
    const { reconciliation: r } = await ingest([file('a.xlsx', { rows, columns })]);
    expect(r!.files[0]!.header.missingOptional).toEqual(['Rotina']);
    expect(r!.files[0]!.amountCurrency1Unreadable).toBe(1);
    expect(r!.files[0]!.alerts.map((a) => a.message)).toEqual([
      'a.xlsx: colunas opcionais ausentes: Rotina (CT2_ROTINA).',
      'a.xlsx: 1 linha tem "Valor Moeda1" ilegível.',
    ]);
    expect(r!.checks.filter((c) => c.severity === 'error').every((c) => c.passed)).toBe(true);
    expect(check(r, 'ct2-optional')).toMatchObject({ passed: false, message: 'Colunas opcionais ausentes: Rotina (P1 sem a rotina).' });
  });

  it('joins the n-th occurrence of a repeated other column across files, apart from a literal title', async () => {
    // CT2_COLUMNS already has one "Filial": the second of each file is "Filial [2]"; "Filial (2)" is another column.
    const a = { columns: [...CT2_COLUMNS, 'Filial'], rows: [ct2Line({}, { Filial: '01' })] };
    const b = { columns: [...CT2_COLUMNS, 'Filial (2)', 'Filial'], rows: [ct2Line({ document: '000009' }, { Filial: '02', 'Filial (2)': 'L' })] };
    const { reconciliation, store } = await ingestCt2(
      [{ name: 'a.xlsx', blob: ct2Blob(a) }, { name: 'b.xlsx', blob: ct2Blob(b) }],
      ct2DefaultConfig(),
      () => {},
    );
    expect(reconciliation.files.map((f) => f.header.unmapped.filter((t) => t.startsWith('Filial')))).toEqual([
      ['Filial', 'Filial [2]'],
      ['Filial', 'Filial (2)', 'Filial [2]'],
    ]);
    const values = (title: string) => Array.from({ length: store.rows }, (_, i) => store.other.get(title)!.get(i));
    expect(values('Filial [2]')).toEqual(['01', '02']);
    expect(values('Filial (2)')).toEqual([null, 'L']);
    expect([...store.other.values()].every((c) => c.length === store.rows)).toBe(true);
  });

  it('judges the cells beyond column 256 by their text, and keeps an empty numeric cell empty', async () => {
    const spaces = '   ';
    const base = buildCt2Extraction({ rows: [ct2Line({}, { 'Campo Livre 01': spaces })] });
    const sstIndex = sharedStrings(base).indexOf(spaces);
    expect(sstIndex).toBeGreaterThanOrEqual(0);
    const blank =
      `<c r="IW4" s="1"/><c r="IX4" t="s"><v>${sstIndex}</v></c><c r="IY4" t="inlineStr"><is><t>&#32;</t></is></c>` +
      '<c r="IZ4" t="str"><f>""</f><v></v></c><c r="V4"><v></v></c>';
    const ok = await ingestCt2([{ name: 'a.xlsx', blob: withCells(base, 4, blank) }], ct2DefaultConfig(), () => {});
    expect(ok.reconciliation.files[0]!.rows.outsideCells).toBe(0);
    expect(check(ok.reconciliation, 'ct2-reading')).toMatchObject({ passed: true });
    expect(ok.store.other.get('C Custo Deb')!.get(0)).toBeNull();
    const values = '<c r="JA4" t="inlineStr"><is><t>x</t></is></c><c r="JB4" t="str"><v><![CDATA[Y]]></v></c>';
    const lost = await ingestCt2([{ name: 'a.xlsx', blob: withCells(base, 4, values) }], ct2DefaultConfig(), () => {});
    expect(lost.reconciliation.files[0]!.rows.outsideCells).toBe(2);
    expect(check(lost.reconciliation, 'ct2-reading')).toMatchObject({ passed: false });
  });

  it('stops with a reading error naming the file on a cell without its end', async () => {
    const bytes = buildCt2Extraction({ rows: [ct2Line(), ct2Line({ line: '002' })] });
    const broken = editSheet(bytes, (xml) => {
      const end = xml.indexOf('</row>', xml.indexOf('<row r="5"'));
      return xml.slice(0, end - 4) + xml.slice(end);
    });
    const { error } = await ingest([new File([broken as Uint8Array<ArrayBuffer>], 'a.xlsx')]);
    expect(error).toMatchObject({ stage: 'rows', message: 'A aba "SCACKST0.XML" de a.xlsx está malformada.' });
    expect(error?.type === 'error' && error.detail).toMatch(/linha 5/);
  });

  it('fails CI-1 when a value sits in a column without a title', async () => {
    const columns = [...CT2_COLUMNS.slice(0, 20), '', ...CT2_COLUMNS.slice(20)];
    const { reconciliation: r } = await ingest([file('a.xlsx', { columns, rows: [ct2Line({}, { '': 'perdido' }), ct2Line({ line: '002' })] })]);
    expect(r!.files[0]!.rows.outsideCells).toBe(1);
    expect(check(r, 'ct2-reading')).toMatchObject({ passed: false });
  });
});

describe('CT2 reading: files that cannot be read', () => {
  it('stops when a mandatory column is missing, listing what was missing and what was found', async () => {
    const columns = CT2_COLUMNS.filter((t) => t.trim() !== 'Valor');
    const { error } = await ingest([file('a.xlsx', fileA({ columns }))]);
    expect(error).toMatchObject({ stage: 'rows', message: 'Cabeçalho da extração CT2 não encontrado nas primeiras 30 linhas da aba "SCACKST0.XML" de a.xlsx.' });
    expect(error?.type === 'error' && error.detail).toMatch(/^Colunas obrigatórias não encontradas: Valor \(CT2_VALOR\)\. Títulos encontrados: Data Lcto, /);
  });

  it('stops on a column found twice, on a header below row 30 and on a CFGR700 report', async () => {
    const twice = await ingest([file('a.xlsx', fileA({ columns: [...CT2_COLUMNS, 'CT2_VALOR'] }))]);
    expect(twice.error).toMatchObject({ stage: 'rows', message: 'Coluna repetida no cabeçalho da aba "SCACKST0.XML" de a.xlsx.' });
    expect(twice.error?.type === 'error' && twice.error.detail).toBe('Valor (CT2_VALOR): colunas 11 e 81');
    const low = await ingest([file('a.xlsx', fileA({ headerRow: 31 }))]);
    expect(low.error).toMatchObject({ stage: 'rows' });
    const log = await ingest([new File([buildCfgr700(cfgr700FileA()) as Uint8Array<ArrayBuffer>], 'log.xlsx')]);
    expect(log.error?.type === 'error' && log.error.message).toMatch(/Cabeçalho da extração CT2 não encontrado|Nenhuma aba de log\.xlsx/);
  });

  it('refuses an invalid configuration and an empty selection', async () => {
    expect((await ingest([file('a.xlsx', fileA())], { schemaVersion: 1 })).error).toMatchObject({ stage: 'fileCheck', message: 'Configuração inválida.' });
    expect((await ingest([])).error).toEqual({ type: 'error', stage: 'fileCheck', message: 'Nenhum arquivo selecionado.' });
  });
});
