/**
 * Justifications in the engine (docs/REGRAS_CFGR700.md, section 9), consolidated scope of the fixture.
 * Documents with deletions: D2 (Sept), D3 (Aug, 21/08 and 26/08), D4 (Aug), D7 (Sept).
 * Documents with effective changes: D1 (Aug 20/08 and Sept 01/09), D5 (Aug 25/08).
 */
import { describe, expect, it } from 'vitest';
import { parseDate, parseDateTime } from '../../src/shared/dates';
import type { Justification } from '../../src/shared/protocol';
import { coverageCounts, documentMovement, justificationStatus } from '../../src/worker/engine/justifications';
import { FULL_PERIOD } from '../../src/worker/engine/periods';
import { periodSignals, type PanelContext } from '../../src/worker/engine/panel';
import { TableQueries } from '../../src/worker/engine/tables';
import { justificationKey } from '../../src/shared/justifications';
import { EVENTS, KEYS, PERIODS } from '../synthetic/engineFixture';
import { analyze } from '../synthetic/logBuilder';

const all = analyze(EVENTS);
const names = ['agosto.xlsx', 'setembro.xlsx'];
const doc = (key: string) => all.documents.find((d) => d.key === key)!;
const t = parseDateTime;
const just = (documentKey: string, kind: Justification['kind'], files: string[], lastEvent: number | null, text = 'Motivo'): Justification => ({
  documentKey,
  kind,
  text,
  responsible: '',
  coverage: { files, lastEvent },
  updatedAt: 1,
});
const store = (items: Justification[]) => new Map(items.map((x) => [justificationKey(x.kind, x.documentKey), x]));

describe('movement of a document', () => {
  it('lists the files and the last event of each kind', () => {
    expect(documentMovement(all, doc(KEYS.D1), 'change')).toEqual({ files: [0, 1], lastEvent: t('01/09/2026 10:00:00') });
    expect(documentMovement(all, doc(KEYS.D3), 'deletion')).toEqual({ files: [0], lastEvent: t('26/08/2026 15:00:00') });
    expect(documentMovement(all, doc(KEYS.D2), 'deletion')).toEqual({ files: [1], lastEvent: t('03/09/2026 10:00:00') });
  });
});

describe('status of a justification', () => {
  it('is pending without a text', () => {
    expect(justificationStatus(all, doc(KEYS.D5), 'change', names, undefined)).toBe('pending');
    expect(justificationStatus(all, doc(KEYS.D5), 'change', names, just(KEYS.D5, 'change', ['agosto.xlsx'], null, '  '))).toBe('pending');
  });

  it('is justified when every file with movement is covered', () => {
    expect(justificationStatus(all, doc(KEYS.D5), 'change', names, just(KEYS.D5, 'change', ['agosto.xlsx'], null))).toBe('justified');
  });

  it('is "moved" when the document moved in a file not covered, after the last event covered', () => {
    const j = just(KEYS.D1, 'change', ['agosto.xlsx'], t('20/08/2026 09:00:00'));
    expect(justificationStatus(all, doc(KEYS.D1), 'change', names, j)).toBe('moved');
  });

  it('a coverage by date alone covers movements up to that date', () => {
    expect(justificationStatus(all, doc(KEYS.D1), 'change', names, just(KEYS.D1, 'change', [], t('01/09/2026 10:00:00')))).toBe('justified');
    expect(justificationStatus(all, doc(KEYS.D1), 'change', names, just(KEYS.D1, 'change', [], t('31/08/2026 23:59:59')))).toBe('moved');
  });

  it('confirming ("abrange o novo evento") = covering the current files and last event', () => {
    const m = documentMovement(all, doc(KEYS.D1), 'change');
    const confirmed = just(KEYS.D1, 'change', m.files.map((s) => names[s]!), m.lastEvent);
    expect(justificationStatus(all, doc(KEYS.D1), 'change', names, confirmed)).toBe('justified');
  });
});

describe('coverage and signals in the panel', () => {
  const justifications = store([
    just(KEYS.D3, 'deletion', ['agosto.xlsx'], null),
    just(KEYS.D5, 'change', ['agosto.xlsx'], null),
    just(KEYS.D1, 'change', ['agosto.xlsx'], t('20/08/2026 09:00:00')),
    just('CHAVE INEXISTENTE', 'deletion', ['agosto.xlsx'], null),
  ]);

  it('counts distinct documents per category: justified, moved and pending', () => {
    expect(coverageCounts(all, FULL_PERIOD, justifications, names)).toEqual({
      deleted: { total: 4, justified: 1, moved: 0, pending: 3 },
      changed: { total: 2, justified: 1, moved: 1, pending: 0 },
    });
    expect(coverageCounts(all, PERIODS.P3, justifications, names)).toEqual({
      deleted: { total: 2, justified: 0, moved: 0, pending: 2 },
      changed: { total: 1, justified: 0, moved: 1, pending: 0 },
    });
  });

  it('"sem justificativa" counts pending and moved documents', () => {
    const context: PanelContext = {
      sourceNames: names,
      requestedIntervals: [
        { startDay: parseDate('17/08/2026'), endDay: parseDate('31/08/2026') },
        { startDay: parseDate('01/09/2026'), endDay: parseDate('04/09/2026') },
      ],
      justifications,
      justificationsLoaded: true,
      holidays: new Set(),
      userPresets: [],
    };
    const signal = periodSignals(all, FULL_PERIOD, context).find((s) => s.id === 'unjustifiedDocuments');
    expect(signal).toMatchObject({ count: 4, text: '4 documento(s) com justificativa pendente' });
  });
});

describe('justification lists', () => {
  const justifications = store([just(KEYS.D3, 'deletion', ['agosto.xlsx'], null, 'Lançamento em duplicidade'), just(KEYS.D1, 'change', ['agosto.xlsx'], t('20/08/2026 09:00:00'))]);
  const queries = new TableQueries(all, names, (kind, key) => justifications.get(justificationKey(kind, key)));
  const col = (table: 'deletionJustifications' | 'changeJustifications', id: string, filter = {}) => {
    const page = queries.page(table, filter, undefined, 0, 100);
    const at = page.columns.findIndex((c) => c.id === id);
    return page.rows.map((r) => r[at]);
  };

  it('has every document with a deleted line, and every document with an effective change', () => {
    expect(col('deletionJustifications', 'documento')).toEqual([KEYS.D2, KEYS.D3, KEYS.D4, KEYS.D7]);
    expect(col('changeJustifications', 'documento')).toEqual([KEYS.D1, KEYS.D5]);
  });

  it('shows status, text, files with movement and last event', () => {
    expect(col('deletionJustifications', 'situacao')).toEqual(['Pendente', 'Justificado', 'Pendente', 'Pendente']);
    expect(col('deletionJustifications', 'justificativa')[1]).toBe('Lançamento em duplicidade');
    expect(col('changeJustifications', 'situacao')).toEqual(['Movimentado após a justificativa', 'Pendente']);
    expect(col('changeJustifications', 'arquivosMovimento')[0]).toBe('agosto.xlsx, setembro.xlsx');
    expect(col('changeJustifications', 'ultimoEvento')[0]).toBe(t('01/09/2026 10:00:00'));
  });

  it('filters by status and by panel period, and searches the justification text', () => {
    expect(col('deletionJustifications', 'documento', { status: 'pending' })).toEqual([KEYS.D2, KEYS.D4, KEYS.D7]);
    expect(col('changeJustifications', 'documento', { status: 'moved' })).toEqual([KEYS.D1]);
    expect(col('deletionJustifications', 'documento', { category: 'deleted', period: PERIODS.P1 })).toEqual([KEYS.D3]);
    expect(col('changeJustifications', 'documento', { category: 'changed', period: FULL_PERIOD })).toEqual([KEYS.D1, KEYS.D5]);
    expect(col('deletionJustifications', 'documento', { search: 'duplicidade' })).toEqual([KEYS.D3]);
  });
});
