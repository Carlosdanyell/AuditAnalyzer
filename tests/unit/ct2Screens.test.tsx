/**
 * Screens of the CT2 after the analysis (Phase 14, section 4): the common filter, the geometry of the Painel charts, the
 * arrangement of the Achados, the side panel of a document and the rail. Pure helpers and static markup, synthetic data.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import type { AvailableModule } from '../../src/modules/types';
import { railViews } from '../../src/app/rail';
import { Ct2DocumentDetailView, currency1Differs, documentTitle } from '../../src/app/modules/ct2Integrity/Ct2DocumentPanel';
import { DEBIT_UNAVAILABLE, dayColumns, manualShare, routineBars, valueSegment } from '../../src/app/modules/ct2Integrity/charts';
import { NOT_APPLICABLE, commonOf, filterChips, isEmptyFilter, ownOf, toggleOrigin, withFilter, withoutFilter } from '../../src/app/modules/ct2Integrity/filters';
import { findingsLayout, occurrencesName, type BoardRow } from '../../src/app/modules/ct2Integrity/findingsLayout';
import { parseDate } from '../../src/shared/dates';
import type { Ct2DocumentDetail, Ct2DocumentLine, Ct2Origin, Ct2Overview } from '../../src/shared/modules/ct2Integrity';

const day = parseDate;
const origins = (automatic: number, manual: number, mixed: number, unidentified: number): Record<Ct2Origin, number> => ({ automatic, manual, mixed, unidentified });

describe('common filter of the CT2 screens', () => {
  it('adds, replaces, removes and clears filters', () => {
    let f = withFilter({}, 'routine', 'CTBA102');
    f = withFilter(f, 'segment', 1);
    expect(f).toEqual({ routine: 'CTBA102', segment: 1 });
    expect(withFilter(f, 'routine', 'CTBANFE').routine).toBe('CTBANFE');
    expect(withoutFilter(f, 'routine')).toEqual({ segment: 1 });
    // An empty routine is a filter (the lines without routine); an empty list of origins is none.
    expect(withFilter({}, 'routine', '')).toEqual({ routine: '' });
    expect(withFilter({ origins: ['manual'] }, 'origins', [])).toEqual({});
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ day: day('01/09/2026') })).toBe(false);
  });

  it('toggles origins keeping the order of the origins', () => {
    let f = toggleOrigin({}, 'mixed');
    f = toggleOrigin(f, 'automatic');
    expect(f.origins).toEqual(['automatic', 'mixed']);
    expect(toggleOrigin(toggleOrigin(f, 'automatic'), 'mixed')).toEqual({});
  });

  it('splits a table filter into the common part and the part of the table', () => {
    const t = { segment: 0, routine: 'X', test: 'B1' as const, group: 'exception' as const, search: 'abc', intervention: true };
    expect(commonOf(t)).toEqual({ segment: 0, routine: 'X' });
    expect(ownOf(t)).toEqual({ test: 'B1', group: 'exception', search: 'abc', intervention: true });
  });

  it('writes one chip per active filter, with the name of its button, and dims what the table ignores', () => {
    const filter = { segment: 1, origins: ['manual', 'mixed'] as Ct2Origin[], routine: '', batch: { batch: '000100', subBatch: '001' }, day: day('05/09/2026') };
    const chips = filterChips(filter, ['Saldo 1 · Moeda 01', 'Saldo 1 · Moeda 02'], null);
    expect(chips.map((c) => `${c.label}: ${c.text}`)).toEqual(['Segmento: Saldo 1 · Moeda 02', 'Origem: Manual ou Misto', 'Rotina: (vazio)', 'Lote: 000100 / sub-lote 001', 'Dia: 05/09/2026']);
    expect(chips.map((c) => c.remove)).toEqual(['Remover filtro Segmento', 'Remover filtro Origem', 'Remover filtro Rotina', 'Remover filtro Lote', 'Remover filtro Dia']);
    expect(chips.every((c) => c.applies)).toBe(true);
    const applies = (table: Parameters<typeof filterChips>[2]) => Object.fromEntries(filterChips(filter, [], table).map((c) => [c.key, c.applies]));
    expect(applies('ct2Days')).toEqual({ segment: true, origins: false, routine: false, batch: false, day: true });
    expect(applies('ct2Batches')).toEqual({ segment: true, origins: false, routine: false, batch: true, day: true });
    expect(applies('ct2Base')).toEqual({ segment: true, origins: true, routine: true, batch: true, day: true });
    expect(NOT_APPLICABLE).toBe('não se aplica a esta tabela');
    // No name of a new button contains the words the e2e helpers look for.
    for (const c of chips) expect(c.remove).not.toMatch(/analisar|ajuda|configuração|painel|cancelar|nova análise|exportar planilha/i);
  });
});

const routine = (name: string, lines: Record<Ct2Origin, number>, documents: Record<Ct2Origin, number>, debit: Ct2Overview['routines'][number]['debit'] = []) => ({ routine: name, lines, documents, debit });

describe('geometry of the Painel charts', () => {
  const overview = {
    segments: [
      { index: 0, balanceType: '1', currency: '01', label: 'Saldo 1 · Moeda 01' },
      { index: 1, balanceType: '1', currency: '02', label: 'Saldo 1 · Moeda 02' },
    ],
    routines: [
      routine('CTBA102', origins(0, 600, 30, 0), origins(0, 20, 1, 0), [{ segment: 0, cents: origins(0, 500_00, 10_00, 0) }]),
      routine('CTBANFE', origins(300, 0, 20, 0), origins(10, 0, 1, 0), [{ segment: 0, cents: origins(900_00, 0, 5_00, 0) }]),
      routine('', origins(0, 0, 0, 2), origins(0, 0, 0, 1)),
    ],
    days: [
      { day: day('04/09/2026'), businessDay: true, lines: 40, documents: 4, debit: [{ segment: 0, cents: 100_00 }] },
      { day: day('05/09/2026'), businessDay: false, lines: 10, documents: 1, debit: [{ segment: 0, cents: 25_00 }] },
    ],
  };

  it('scales the bars to the largest one; the stacked parts add up to each bar', () => {
    const bars = routineBars(overview, 'lines', null);
    expect(bars.map((b) => [b.label, b.total, Math.round(b.width)])).toEqual([
      ['CTBA102', 630, 100],
      ['CTBANFE', 320, 51],
      ['(vazio)', 2, 0],
    ]);
    for (const b of bars) {
      expect(b.parts.reduce((s, p) => s + p.width, 0)).toBeCloseTo(b.width, 9);
      expect(b.parts.reduce((s, p) => s + p.value, 0)).toBe(b.total);
    }
    expect(bars[0]!.parts.map((p) => p.origin)).toEqual(['manual', 'mixed']);
    expect(bars.map((b) => b.name)).toEqual(['CTBA102: 630 linhas', 'CTBANFE: 320 linhas', '(vazio): 2 linhas']);
  });

  it('counts documents and, for one segment only, the debit, sorted by the value', () => {
    expect(routineBars(overview, 'documents', null).map((b) => b.name)).toEqual(['CTBA102: 21 documentos', 'CTBANFE: 11 documentos', '(vazio): 1 documento']);
    expect(routineBars(overview, 'debit', null)).toEqual([]);
    const debit = routineBars(overview, 'debit', 0);
    expect(debit.map((b) => b.name)).toEqual(['CTBANFE: 905,00 de débito', 'CTBA102: 510,00 de débito']);
    expect(valueSegment(overview, undefined)).toBeNull();
    expect(valueSegment(overview, 1)).toBe(1);
    expect(valueSegment({ segments: [overview.segments[1]!] }, undefined)).toBe(1);
    expect(DEBIT_UNAVAILABLE).toMatch(/não se somam/);
  });

  it('draws one column per day, marking the non-business days', () => {
    const cols = dayColumns(overview, 'lines', null);
    expect(cols.map((c) => [c.label, c.height, c.businessDay, c.name])).toEqual([
      ['04', 100, true, '04/09/2026: 40 linhas'],
      ['05', 25, false, '05/09/2026: 10 linhas (dia não útil)'],
    ]);
    expect(dayColumns(overview, 'debit', null)).toEqual([]);
    expect(dayColumns(overview, 'debit', 0).map((c) => c.name)).toEqual(['04/09/2026: 100,00 de débito', '05/09/2026: 25,00 de débito (dia não útil)']);
  });

  it('gives the share of the debit in manual lines with one decimal', () => {
    expect(manualShare({ debitCents: 3_00, manualDebitCents: 1_00 })).toBe('33,3%');
    expect(manualShare({ debitCents: 0, manualDebitCents: 0 })).toBeNull();
  });
});

const row = (code: BoardRow['code'], severity: BoardRow['severity'], group: BoardRow['group'], occurrences: number, state: BoardRow['state'] = 'on'): BoardRow => ({
  code,
  severity,
  group,
  occurrences,
  state,
  detail: null,
  link: group ? 'ct2Exceptions' : null,
  sample: [],
});

describe('Achados: the board arranged by group', () => {
  const board = [
    row('B1', 'error', 'exception', 6),
    row('B2', 'error', 'exception', 0),
    row('E4', 'warning', 'exception', 2),
    row('I4a', 'info', 'approval', 2),
    row('I1', 'info', 'info', 3),
    row('I5', 'info', 'info', 14),
    row('E6', 'info', 'info', 0, 'off'),
    row('P1', 'info', null, 4),
  ];

  it('opens the exceptions and the approval group, folds the informative ones and those without occurrence', () => {
    const layout = findingsLayout(board, 1);
    expect(layout.exceptions.tests.map((t) => t.code)).toEqual(['B1', 'E4']);
    expect(layout.exceptions).toMatchObject({ occurrences: 8, open: true, title: 'Exceções — Erro e Alerta · 8 ocorrências' });
    expect(layout.approval).toMatchObject({ occurrences: 2, open: true, title: 'Conferir com documento de aprovação · 2 ocorrências e 1 documento misto' });
    expect(layout.info).toMatchObject({ occurrences: 17, open: false, title: 'Informativos · 17 ocorrências em 2 testes' });
    // The profile is the Painel's; a test turned off is listed with those without occurrence.
    expect(layout.quiet.tests.map((t) => t.code)).toEqual(['B2', 'E6']);
    expect(layout.quiet.title).toBe('1 teste(s) sem ocorrência · 1 desligado(s) ou sem a coluna');
    expect(occurrencesName(board[0]!)).toBe('B1: 6 documentos');
    expect(occurrencesName(board[2]!)).toBe('E4: 2 linhas');
  });
});

const line = (over: Partial<Ct2DocumentLine>): Ct2DocumentLine => ({
  position: 0,
  segment: 0,
  line: '001',
  entryType: '3',
  debitAccount: '1101',
  creditAccount: '2101',
  entities: { costCenterDebit: '100', costCenterCredit: '200' },
  amountCents: 100_00,
  amountCurrency1Cents: 100_00,
  origin: 'automatic',
  manualCode: '2',
  routine: 'CTBANFE',
  history: 'HISTORICO SINTETICO',
  findings: [],
  ...over,
});

describe('side panel of a document', () => {
  const detail: Ct2DocumentDetail = {
    day: day('07/09/2026'),
    batch: '000100',
    subBatch: '001',
    document: '000007',
    routines: ['CTBA102', 'CTBANFE'],
    blocks: [{ index: 7, segment: 0, origin: 'mixed', lines: 2, debitCents: 250_00, creditCents: 250_00, unbalanced: false, compensation: null }],
    entities: ['costCenterDebit', 'costCenterCredit'],
    lines: [
      line({ position: 10, line: '001' }),
      line({
        position: 11,
        line: '002',
        origin: 'manual',
        manualCode: '1',
        routine: 'CTBA102',
        amountCents: 150_00,
        amountCurrency1Cents: 120_00,
        findings: [{ code: 'I4a', group: 'approval', reason: 'Valor gerado 120,00 → atual 150,00; documento com 1 linha(s) manual(is)' }],
      }),
    ],
    totalLines: 2,
  };
  const html = renderToStaticMarkup(<Ct2DocumentDetailView detail={detail} segments={['Saldo 1 · Moeda 01']} titleId="t" />);

  it('shows the key, the origin, the routines and the totals by segment', () => {
    expect(documentTitle(detail)).toBe('Documento 000007 · lote 000100/001 · 07/09/2026');
    expect(html).toContain('id="t"');
    expect(html).toContain('Documento 000007 · lote 000100/001 · 07/09/2026');
    expect(html).toContain('CTBA102, CTBANFE');
    expect(html).toContain('Misto');
    expect(html).toContain('250,00');
    expect(html).toContain('CC D');
  });

  it('marks the manual line and the line with a finding, with its reason', () => {
    expect(html.match(/data-origin="manual"/g)).toHaveLength(1);
    expect(html).toContain('Linha com achado');
    expect(html).toContain('I4a · Conferir com aprovação');
    expect(html).toContain('Valor gerado 120,00 → atual 150,00');
  });

  it('shows Valor Moeda1 only where it differs from Valor', () => {
    expect(currency1Differs(detail.lines[0]!)).toBe(false);
    expect(currency1Differs(detail.lines[1]!)).toBe(true);
    expect(currency1Differs({ amountCents: 1, amountCurrency1Cents: null })).toBe(false);
    expect(html).toContain('Valor Moeda1');
    expect(html).toContain('120,00');
    const same = renderToStaticMarkup(<Ct2DocumentDetailView detail={{ ...detail, lines: [detail.lines[0]!] }} segments={[]} titleId="t" />);
    expect(same).not.toContain('Valor Moeda1');
  });
});

describe('rail of the views', () => {
  it('offers Achados for the CT2 and not for the CFGR700', () => {
    expect(railViews(ct2IntegrityModule as unknown as AvailableModule).map((v) => v.label)).toEqual(['Reconciliação', 'Painel', 'Achados', 'Tabelas', 'Exportação']);
    expect(railViews(cfgr700Module as unknown as AvailableModule).map((v) => v.label)).toEqual(['Reconciliação', 'Painel', 'Tabelas', 'Justificativas', 'Exportação']);
  });
});
