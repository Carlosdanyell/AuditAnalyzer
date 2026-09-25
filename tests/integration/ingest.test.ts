import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { formatIsoDateTime } from '../../src/shared/dates';
import type { FileReconciliation, WorkerEvent } from '../../src/shared/protocol';
import { IngestError, runIngestion, type IngestionResult } from '../../src/worker/ingest/pipeline';
import { buildCfgr700, synthBlob, type SynthOptions } from '../synthetic/cfgr700';
import {
  CONSOLIDATED_EXPECTED,
  FILE_A_EXPECTED,
  FILE_B_EXPECTED,
  FILE_LATE_ROWS,
  fileA,
  fileB,
} from '../synthetic/fixtures';

async function ingest(files: [string, SynthOptions | Blob][], opts: Parameters<typeof runIngestion>[3] = {}) {
  const events: WorkerEvent[] = [];
  const result = await runIngestion(
    files.map(([name, spec]) => ({ name, blob: spec instanceof Blob ? spec : synthBlob(spec) })),
    defaultConfig(),
    (e) => events.push(e),
    opts,
  );
  return { result, events };
}

function eventsByLabel(file: { events: { operation: string; count: number }[] }) {
  return Object.fromEntries(file.events.map((e) => [e.operation, e.count]));
}

function expectFileA(file: FileReconciliation) {
  expect(file.rows).toMatchObject({
    totalRows: FILE_A_EXPECTED.totalRows,
    rowsAfterHeader: FILE_A_EXPECTED.rowsAfterHeader,
    repeatedHeaders: FILE_A_EXPECTED.repeatedHeaders,
    blankRows: FILE_A_EXPECTED.blankRows,
    missingRows: FILE_A_EXPECTED.missingRows,
    blankRowsWithContent: FILE_A_EXPECTED.blankRowsWithContent,
    detailRows: FILE_A_EXPECTED.detailRows,
    balanced: true,
  });
  expect(eventsByLabel(file)).toEqual(FILE_A_EXPECTED.events);
  expect(file.totalEvents).toBe(FILE_A_EXPECTED.totalEvents);
  expect(formatIsoDateTime(file.firstEvent!)).toBe(FILE_A_EXPECTED.firstEvent);
  expect(formatIsoDateTime(file.lastEvent!)).toBe(FILE_A_EXPECTED.lastEvent);
  expect(file.invalid).toEqual({ dateTime: 0, recno: 0, operation: 0, sharedStringIndex: 0 });
}

function trickyValueStored(result: IngestionResult): boolean {
  const { details, dictionary } = result;
  for (let i = 0; i < details.length; i++) {
    if (dictionary.get(details.newVal[i]!) === FILE_A_EXPECTED.trickyValue) return true;
  }
  return false;
}

describe('ingestion of a synthetic CFGR700 file', () => {
  it('reconciles rows and counts events', async () => {
    const { result } = await ingest([['a.xlsx', fileA()]]);
    const [file] = result.reconciliation.files;
    expectFileA(file!);
    expect(file!.alerts).toEqual([]);
    expect(file!.entries.every((e) => e.ok)).toBe(true);
    expect(file!.entries.map((e) => e.name)).toContain('xl/worksheets/sheet2.xml');
    expect(file!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file!.rows.dimensionRows).toBe(16);
    expect(result.details.length).toBe(9);
    expect(trickyValueStored(result)).toBe(true);
    expect(result.reconciliation.checks.every((c) => c.passed)).toBe(true);
  });

  it('keeps counts of the columns not stored', async () => {
    const { result } = await ingest([['a.xlsx', fileA()]]);
    const status = result.reconciliation.files[0]!.otherColumns.find((c) => c.column === 'Situacao');
    expect(status?.values).toEqual([{ value: 'Ativo', count: 9 }]);
  });

  it('reads the parameters sheet', async () => {
    const { result } = await ingest([['a.xlsx', fileA()]]);
    const params = result.reconciliation.files[0]!.parameters;
    expect(params.find((p) => p.label === 'Tabela início')?.value).toBe('CT2');
    expect(params.find((p) => p.label === 'Dt.Ref')?.value).toBe('01/01/2030');
  });

  it.each<[string, Partial<SynthOptions>]>([
    ['uncompressed entries', { stored: true }],
    ['shared strings after the sheets', { sharedStringsLast: true }],
    ['report sheet stored under another file name', { reportSheetFile: 'sheet7.xml' }],
    ['no <dimension>', { omitDimension: true }],
    ['inline strings', { inlineStrings: true }],
    ['rich text shared strings', { richText: true }],
    ['Recno written as text', { recnoAsText: true }],
  ])('gives the same answer with %s', async (_, variant) => {
    const { result } = await ingest([['a.xlsx', fileA(variant)]]);
    expectFileA(result.reconciliation.files[0]!);
    expect(trickyValueStored(result)).toBe(true);
  });

  it('gives the same answer with the fflate fallback', async () => {
    const { result } = await ingest([['a.xlsx', fileA()]], { inflateMode: 'fallback' });
    expectFileA(result.reconciliation.files[0]!);
  });

  it('emits throttled progress through the documented stages', async () => {
    const { events } = await ingest([['a.xlsx', fileA()]]);
    const stages = [...new Set(events.filter((e) => e.type === 'progress').map((e) => e.stage))];
    expect(stages).toEqual(['fileCheck', 'parameters', 'sharedStrings', 'rows', 'reconciliation', 'events', 'checks']);
  });
});

describe('ingestion of two extractions', () => {
  it('reconciles each file and the consolidated base, with a global reading order', async () => {
    const { result } = await ingest([
      ['a.xlsx', fileA()],
      ['b.xlsx', fileB()],
    ]);
    const [a, b] = result.reconciliation.files;
    expectFileA(a!);
    expect(b!.rows.totalRows).toBe(FILE_B_EXPECTED.totalRows);
    expect(b!.rows.detailRows).toBe(FILE_B_EXPECTED.detailRows);
    expect(eventsByLabel(b!)).toEqual(FILE_B_EXPECTED.events);

    const c = result.reconciliation.consolidated;
    expect(c.detailRows).toBe(CONSOLIDATED_EXPECTED.detailRows);
    expect(eventsByLabel(c)).toEqual(CONSOLIDATED_EXPECTED.events);
    expect(c.totalEvents).toBe(CONSOLIDATED_EXPECTED.totalEvents);
    expect(formatIsoDateTime(c.firstEvent!)).toBe(CONSOLIDATED_EXPECTED.firstEvent);
    expect(formatIsoDateTime(c.lastEvent!)).toBe(CONSOLIDATED_EXPECTED.lastEvent);
    expect(c.alerts).toEqual([]);

    // ord = position in the base: all of file A, then file B.
    expect(Array.from(result.details.source.subarray(0, result.details.length))).toEqual([
      ...Array<number>(9).fill(0),
      1,
      1,
    ]);
  });

  it('alerts on uncovered weekdays between extractions', async () => {
    const { result } = await ingest([
      ['a.xlsx', fileA()],
      ['c.xlsx', { rows: FILE_LATE_ROWS }],
    ]);
    expect(result.reconciliation.consolidated.alerts.map((a) => a.message)).toEqual([
      '3 dia(s) útil(eis) (segunda a sexta) sem extração entre "a.xlsx" e "c.xlsx": 04/09/2026, 07/09/2026, 08/09/2026.',
    ]);
  });
});

describe('ingestion failures', () => {
  async function failure(files: [string, SynthOptions | Blob][]): Promise<IngestError> {
    try {
      await ingest(files);
    } catch (e) {
      if (e instanceof IngestError) return e;
      throw e;
    }
    throw new Error('ingestion did not fail');
  }

  it('rejects a file that is not an .xlsx', async () => {
    const e = await failure([['x.xlsx', new Blob(['texto qualquer'])]]);
    expect(e.stage).toBe('fileCheck');
    expect(e.message).toMatch(/não é um arquivo \.xlsx válido/);
  });

  it('rejects a corrupted entry (CRC32)', async () => {
    const bytes = buildCfgr700(fileA({ stored: true }));
    // Flip one byte of the report sheet data (stored, so the ZIP stays readable).
    const text = new TextDecoder('latin1').decode(bytes);
    const at = text.indexOf('dyDescent="0.2"') + 'dyDescent="0.'.length;
    bytes[at] = '3'.charCodeAt(0);
    const e = await failure([['a.xlsx', new Blob([bytes as Uint8Array<ArrayBuffer>])]]);
    expect(e.message).toMatch(/CRC32/);
    expect(e.message).toMatch(/sheet2\.xml/);
  });

  it('rejects a workbook without the report sheet', async () => {
    const e = await failure([['a.xlsx', fileA({ reportSheetName: 'Outra aba' })]]);
    expect(e.message).toBe('Aba do relatório ("Relatório de auditoria") não encontrada. Abas do arquivo: Parametros, Outra aba.');
  });

  it('rejects a report whose first row is not the header', async () => {
    const e = await failure([['a.xlsx', { rows: fileA().rows.slice(1) }]]);
    expect(e.stage).toBe('rows');
    expect(e.message).toMatch(/cabeçalho/i);
  });

  it('rejects an empty selection', async () => {
    const e = await failure([]);
    expect(e.message).toBe('Nenhum arquivo selecionado.');
  });
});
