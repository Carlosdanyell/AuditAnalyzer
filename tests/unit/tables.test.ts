/**
 * Worker tables (phase 3) on the engine fixture, consolidated scope.
 * Key property: a table opened from a panel number has exactly that number of rows.
 */
import { describe, expect, it } from 'vitest';
import type { Category, OriginFilter, Period, TableFilter, TableId } from '../../src/shared/protocol';
import { FULL_PERIOD, periodPanel } from '../../src/worker/engine/periods';
import { TableQueries } from '../../src/worker/engine/tables';
import { EVENTS, PERIODS } from '../synthetic/engineFixture';
import { analyze } from '../synthetic/logBuilder';

const all = analyze(EVENTS);
const queries = new TableQueries(all, ['agosto.xlsx', 'setembro.xlsx']);
const total = (table: TableId, filter: TableFilter = {}) => queries.page(table, filter, undefined, 0, 0).total;
const column = (table: TableId, id: string, filter: TableFilter = {}, sort?: { column: string; direction: 'asc' | 'desc' }) => {
  const page = queries.page(table, filter, sort, 0, 1000);
  const at = page.columns.findIndex((c) => c.id === id);
  if (at < 0) throw new Error(`coluna ${id} ausente`);
  return page.rows.map((r) => r[at]);
};

describe('tables without filters', () => {
  it.each<[TableId, number]>([
    ['documents', 7],
    ['baseRows', 17],
    ['deletions', 5],
    ['changes', 4],
    ['unbalanced', 1],
    ['discardedChanges', 4],
  ])('%s has %i rows', (table, n) => {
    expect(total(table)).toBe(n);
  });

  it('keeps the base order: documents contiguous, unidentified last', () => {
    expect(column('baseRows', 'recno')).toEqual([1, 2, 3, 10, 11, 20, 21, 31, 32, 50, 51, 70, 60, 61, 40, 41, 42]);
  });

  it('lists one Alteracoes row per changed field, with old and new values', () => {
    expect(column('changes', 'campo')).toEqual(['CT2_HIST', 'CT2_HIST', 'CT2_HIST', 'CT2_INCONS']);
    expect(column('changes', 'valorNovo')).toEqual(['NOVO', 'OUTRO', 'B', '2']);
  });

  it('labels discarded events', () => {
    expect(column('discardedChanges', 'tipo')).toEqual([
      'Efetivação do tipo de saldo',
      'Somente carimbo de usuário',
      'Somente carimbo de usuário',
      'Efetivação do tipo de saldo',
    ]);
  });

  it('has one "last change" column per file of the scope', () => {
    const headers = queries.page('documents', {}, undefined, 0, 0).columns.map((c) => c.header);
    expect(headers).toContain('Últ. alteração — agosto.xlsx');
    expect(headers).toContain('Últ. alteração — setembro.xlsx');
  });
});

describe('tables opened from panel numbers', () => {
  const periods: [string, Period][] = [
    ['P1', PERIODS.P1],
    ['P2', PERIODS.P2],
    ['P3', PERIODS.P3],
    ['full', FULL_PERIOD],
  ];
  const categories: Category[] = ['deleted', 'changed', 'unbalanced', 'posted'];

  it.each(periods)('every number of %s matches the row count of its table', (_, period) => {
    const panel = periodPanel(all, period);
    for (const category of categories) {
      const c = panel[category];
      const lines = (origin: OriginFilter) => total('baseRows', { category, period, origin });
      const docs = (origin: OriginFilter) => total(category === 'unbalanced' ? 'unbalanced' : 'documents', { category, period, origin });
      expect([lines('manual'), lines('automatic'), lines('unidentified')], category).toEqual([
        c.manual.lines,
        c.automatic.lines,
        c.unidentifiedLines,
      ]);
      expect([docs('manual'), docs('automatic'), docs('mixed')], category).toEqual([
        c.manual.documents,
        c.automatic.documents,
        c.mixedDocuments,
      ]);
      expect(total(category === 'unbalanced' ? 'unbalanced' : 'documents', { category, period }), category).toBe(c.totalDocuments);
    }
    expect(total('deletions', { category: 'deleted', period, origin: 'manual' })).toBe(panel.deleted.manual.lines);
  });

  it('shows the source file of each change when a line changed in two files', () => {
    expect(column('baseRows', 'arquivoAlteracao', { category: 'changed', period: FULL_PERIOD, origin: 'manual' })).toEqual([
      'agosto.xlsx',
      'setembro.xlsx',
      'agosto.xlsx',
    ]);
  });

  it('filters change and discarded events by event date when no category is given', () => {
    expect(total('changes', { period: PERIODS.P3 })).toBe(1);
    expect(total('discardedChanges', { period: PERIODS.P1 })).toBe(4);
    expect(total('deletions', { period: PERIODS.P2 })).toBe(2);
  });
});

describe('search, sort and paging', () => {
  it('searches text columns ignoring case and accents', () => {
    expect(column('baseRows', 'recno', { search: 'outro' })).toEqual([2]);
    expect(column('baseRows', 'recno', { search: 'USR06' })).toEqual([60, 61]);
    expect(column('discardedChanges', 'recno', { search: 'efetivacao' })).toEqual([1, 42]);
  });

  it('sorts by a column, keeping empty values last and ties in base order', () => {
    expect(column('baseRows', 'recno', {}, { column: 'valor', direction: 'desc' }).slice(0, 4)).toEqual([1, 2, 10, 11]);
    expect(column('baseRows', 'recno', {}, { column: 'valor', direction: 'asc' }).slice(-3)).toEqual([40, 41, 42]);
    expect(column('documents', 'documento', {}, { column: 'documento', direction: 'asc' })[0]).toBe('02/09/2026|000009|001|000060');
  });

  it('returns the requested slice', () => {
    const page = queries.page('baseRows', {}, undefined, 5, 3);
    expect(page.total).toBe(17);
    expect(page.rows.map((r) => r[0])).toEqual([20, 21, 31]);
  });
});
