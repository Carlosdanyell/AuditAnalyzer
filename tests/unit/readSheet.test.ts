import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IngestError } from '../../src/worker/ingest/errors';
import { ProgressReporter } from '../../src/worker/ingest/progress';
import { readSheet, type SheetReadOptions } from '../../src/worker/ingest/readSheet';
import { buildCt2Extraction, ct2Line, type Ct2ExtractionOptions } from '../synthetic/ct2Extraction';

/** Generic streaming reading of one sheet, shared by the modules (docs/MODULOS.md, section 2). */
async function read(o: Ct2ExtractionOptions, options: Partial<SheetReadOptions> = {}, bytes = buildCt2Extraction(o)) {
  const rows: { r: number; values: string[] }[] = [];
  const result = await readSheet(
    { name: 'a.xlsx', blob: new Blob([bytes as Uint8Array<ArrayBuffer>]) },
    {
      fileIndex: 0,
      progress: new ProgressReporter(() => {}, () => 0, 0),
      inflateMode: 'auto',
      width: 128,
      chooseSheet: async (sheets) => sheets.length - 1,
      onRow: (r, row, cell) => rows.push({ r, values: Array.from({ length: 12 }, (_, c) => cell(row, c)) }),
      ...options,
    },
  );
  return { result, rows, bytes };
}

describe('reading one sheet', () => {
  const lines = [ct2Line({ amount: 10.5 }), { gap: 2 }, ct2Line({ document: 7, amount: '1.234,56' }), { empty: true as const }];

  it('checks the whole file and each ZIP entry, and gives each present row with its cells resolved', async () => {
    const { result, rows, bytes } = await read({ rows: lines });
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(result.entries.every((e) => e.ok)).toBe(true);
    expect(result.entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/sharedStrings.xml',
    ]);
    expect(result.sheetName).toBe('SCACKST0.XML');
    expect(result.dimensionRows).toBe(8);
    expect(result.lastRow).toBe(8);
    expect(result.date1904).toBe(false);
    expect(rows.map((r) => r.r)).toEqual([1, 3, 4, 7, 8]);
    expect(rows[1]!.values[0]).toMatch(/^Data Lcto +$/);
    expect(rows[2]!.values.slice(0, 4)).toEqual(['15/09/2026', '000001', '001', '000001']);
    expect(rows[2]!.values[10]).toBe('10.5');
    expect(rows[3]!.values[3]).toBe('7');
    expect(rows[3]!.values[10]).toBe('1.234,56');
    expect(rows[4]!.values.every((v) => v === '')).toBe(true);
  });

  it('reads the same with inline strings, without dimension, in the 1904 system and with the fallback inflate', async () => {
    const plain = (await read({ rows: lines })).rows;
    expect((await read({ rows: lines, inlineStrings: true })).rows).toEqual(plain);
    expect((await read({ rows: lines }, { inflateMode: 'fallback' })).rows).toEqual(plain);
    const other = await read({ rows: lines, omitDimension: true, date1904: true });
    expect(other.result.dimensionRows).toBeNull();
    expect(other.result.date1904).toBe(true);
  });

  it('lets the module choose among several sheets by their first rows', async () => {
    const extraSheets = { Resumo: [['Nada a ver'], ['Total', 3]] };
    const seen: string[][] = [];
    const { result } = await read(
      { rows: lines, extraSheets },
      {
        chooseSheet: async (sheets, head) => {
          for (const s of sheets) seen.push((await head(s, 3)).map((r) => r.titles[0] ?? ''));
          return 1;
        },
      },
    );
    expect(result.sheetNames).toEqual(['Resumo', 'SCACKST0.XML']);
    expect(result.sheetName).toBe('SCACKST0.XML');
    expect(seen[0]).toEqual(['Nada a ver', 'Total']);
    expect(seen[1]![0]).toBe('CT2 - Lancamentos Contabeis');
    expect(result.entries.find((e) => e.name === 'xl/worksheets/sheet1.xml')?.ok).toBe(true);
  });

  it('refuses a corrupted sheet (CRC32) and a sheet the module did not find', async () => {
    const bytes = buildCt2Extraction({ rows: lines, stored: true });
    const text = new TextDecoder('latin1').decode(bytes);
    bytes[text.indexOf('<v>10.5</v>') + 3] = '2'.charCodeAt(0);
    const corrupted = await read({ rows: lines }, {}, bytes).catch((e: unknown) => e);
    expect(corrupted).toBeInstanceOf(IngestError);
    expect((corrupted as IngestError).message).toMatch(/CRC32 .* xl\/worksheets\/sheet1\.xml/);
    const none = await read({ rows: lines }, { chooseSheet: async () => 'Nenhuma aba tem o cabeçalho da extração.' }).catch((e: unknown) => e);
    expect(none).toBeInstanceOf(IngestError);
    expect((none as IngestError).stage).toBe('rows');
    expect((none as IngestError).message).toBe('Nenhuma aba tem o cabeçalho da extração.');
  });
});
