import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { parseDate } from '../../src/shared/dates';
import type { Ct2TableId } from '../../src/shared/modules/ct2Integrity';
import { analyzeCt2 } from '../../src/worker/modules/ct2Integrity/analysis';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { ct2Panel } from '../../src/worker/modules/ct2Integrity/panel';
import { Ct2Tables } from '../../src/worker/modules/ct2Integrity/tables';
import { buildCt2Workpaper } from '../../src/worker/modules/ct2Integrity/workpaper';
import { ct2Blob } from '../synthetic/ct2Extraction';
import { ENGINE_EXCEPTIONS, ENGINE_HOLIDAYS, ENGINE_ROWS } from '../synthetic/ct2EngineFixture';
import { Workbook } from '../support/xlsxEval';

/** Tables of the CT2 module (docs/REGRAS_CT2_INTEGRIDADE.md, section 9): each number of the panel opens a table with exactly that many rows. */
const holidays = ENGINE_HOLIDAYS.map(parseDate);

async function engine() {
  const config = ct2DefaultConfig();
  const base = await ingestCt2([{ name: 'sintetico.xlsx', blob: ct2Blob({ rows: ENGINE_ROWS }) }], config, () => {});
  const analysis = analyzeCt2(base, config, new Set(holidays));
  return { base, analysis, config, tables: new Ct2Tables(base, analysis) };
}

describe('CT2 tables', async () => {
  const { base, analysis, config, tables } = await engine();

  it('pages the five tables with the counts of the Base', () => {
    const total = (table: Ct2TableId) => tables.page(table, {}, undefined, 0, 10).total;
    expect([total('ct2Documents'), total('ct2Batches'), total('ct2Days'), total('ct2Exceptions'), total('ct2Base')]).toEqual([
      analysis.blocks.documents,
      analysis.blocks.batches,
      analysis.blocks.days,
      analysis.exceptions.count,
      1038,
    ]);
    const page = tables.page('ct2Documents', {}, undefined, 0, 2);
    expect(page.columns.slice(0, 5).map((c) => c.header)).toEqual(['Segmento', 'Data', 'Lote', 'Sub-lote', 'Documento']);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]![1]).toBe(parseDate('07/09/2026'));
  });

  it('lists the exceptions in the order of the workpaper, with their key', () => {
    const page = tables.page('ct2Exceptions', {}, undefined, 0, 200);
    const col = (id: string) => page.columns.findIndex((c) => c.id === id);
    const texts = page.rows.map((r) => {
      const level = r[col('level')];
      const where = level === 'Linha' ? `linha ${r[col('document')]}-${r[col('line')]}` : level === 'Documento' ? `doc ${r[col('batch')]}/${r[col('document')]}` : level === 'Lote' ? `lote ${r[col('batch')]}` : 'dia';
      return `${r[col('code')]} ${where}`;
    });
    // Erro first, then Alerta (the order of the Excecoes tab).
    const errors = ENGINE_EXCEPTIONS.filter((e) => config.tests[e.slice(0, 2) as 'B1'].severity === 'error');
    expect(texts.length).toBe(ENGINE_EXCEPTIONS.length);
    expect(texts.slice(0, errors.length).every((t) => config.tests[t.slice(0, 2) as 'B1'].severity === 'error')).toBe(true);
  });

  it('opens each number of the board with exactly that many rows, in every segment, as the Resumo of the workpaper', async () => {
    const out = await buildCt2Workpaper(
      { base, analysis, config, holidays, language: 'pt', generatedAt: '29/10/2026 10:30:00', appVersion: 't', configHash: '-', configDifferences: [], confirmedFailures: [] },
      () => {},
    );
    const book = await Workbook.read(out.blob);
    for (const segment of [null, 0, 1, 2]) {
      const panel = ct2Panel(base, analysis, segment);
      for (const t of panel.board) {
        if (!t.link) continue;
        const filter = { test: t.code, ...(segment !== null && { segment }) };
        expect(tables.page(t.link, filter, undefined, 0, 1).total, `${t.code} no segmento ${segment}`).toBe(t.occurrences);
        if (segment === null) {
          let r = 1;
          while (book.value('Resumo', `A${r}`) !== t.code || r < 20) r++;
          expect(book.value('Resumo', `E${r}`), `${t.code} no Resumo`).toBe(t.occurrences);
        }
      }
      const docs = tables.page('ct2Documents', segment === null ? {} : { segment }, undefined, 0, 1).total;
      expect(docs).toBe(panel.totals.documents);
      expect(tables.page('ct2Base', segment === null ? {} : { segment }, undefined, 0, 1).total).toBe(panel.totals.lines);
    }
  });

  it('searches without accents or case and sorts by a column, keeping the Base order on ties', () => {
    expect(tables.page('ct2Base', { search: 'sintetico' }, undefined, 0, 1).total).toBe(1038 - 1);
    const sorted = tables.page('ct2Documents', {}, { column: 'lines', direction: 'desc' }, 0, 3);
    const lines = sorted.columns.findIndex((c) => c.id === 'lines');
    expect(sorted.rows.map((r) => r[lines])).toEqual([1000, 2, 2]);
  });

  it('shows the mapped columns and the tests of the Base, and every column on request', () => {
    const some = tables.page('ct2Base', {}, undefined, 0, 1).columns.map((c) => c.header);
    const all = tables.page('ct2Base', { allColumns: true }, undefined, 0, 1).columns.map((c) => c.header);
    expect(some).toContain('Hist Lanc');
    expect(some).toContain('I1 Exceção?');
    expect(some).not.toContain('Campo Livre 01');
    expect(all).toContain('Campo Livre 01');
    expect(all.length).toBeGreaterThan(some.length + 50);
  });
});
