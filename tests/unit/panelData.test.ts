/**
 * Panel blocks of phase 3 (docs/REGRAS_CFGR700.md, section 8) on the engine fixture, consolidated scope.
 * Entry dates (CT2_DATA): D1 17/08, D2 18/08, D3 19/08, D4 20/08, D5 24/08, D7 30/08 (≤ 31/08); D6 02/09 (> 31/08).
 */
import { describe, expect, it } from 'vitest';
import { lastDayOfMonth, parseDate } from '../../src/shared/dates';
import {
  buildPanel,
  composition,
  compositionMatches,
  dailyMovement,
  periodSignals,
  subtractPanels,
  type PanelContext,
} from '../../src/worker/engine/panel';
import { FULL_PERIOD, periodPanel } from '../../src/worker/engine/periods';
import { EVENTS, PERIODS } from '../synthetic/engineFixture';
import { analyze } from '../synthetic/logBuilder';

const all = analyze(EVENTS);
const day = parseDate;
const context: PanelContext = {
  sourceNames: ['agosto.xlsx', 'setembro.xlsx'],
  requestedIntervals: [
    { startDay: day('17/08/2026'), endDay: day('31/08/2026') },
    { startDay: day('01/09/2026'), endDay: day('04/09/2026') },
  ],
  justifiedDocuments: new Set(),
  justificationsLoaded: false,
  holidays: new Set(),
  userPresets: [],
};
const cell = (lines: number, documents: number, debitCents: number) => ({ lines, documents, debitCents });
const none = cell(0, 0, 0);

describe('composition by entry date (cutoff 31/08/2026, full log)', () => {
  const comp = composition(all, FULL_PERIOD, day('31/08/2026'));

  it('splits lines, documents and debited value at the cutoff, plus "sem identificação"', () => {
    expect(comp.deleted).toEqual({ upToCutoff: cell(5, 4, 6100), afterCutoff: none, unreadableDate: none, unidentifiedLines: 0 });
    expect(comp.changed).toEqual({ upToCutoff: cell(3, 3, 500), afterCutoff: none, unreadableDate: none, unidentifiedLines: 1 });
    expect(comp.unbalanced).toEqual({ upToCutoff: cell(2, 1, 5000), afterCutoff: none, unreadableDate: none, unidentifiedLines: 0 });
    expect(comp.posted).toEqual({ upToCutoff: cell(10, 5, 18500), afterCutoff: cell(2, 1, 700), unreadableDate: none, unidentifiedLines: 0 });
  });

  it('adds up to the category totals plus the unidentified lines (invariant 7)', () => {
    expect(compositionMatches(periodPanel(all, FULL_PERIOD), comp)).toBe(true);
    const broken = structuredClone(comp);
    broken.posted.afterCutoff.lines++;
    expect(compositionMatches(periodPanel(all, FULL_PERIOD), broken)).toBe(false);
  });
});

describe('period × other days × full log', () => {
  it('other days = full log − period (here, P2 + P3 for P1)', () => {
    const add = (a: ReturnType<typeof periodPanel>, b: ReturnType<typeof periodPanel>) =>
      subtractPanels(a, subtractPanels(periodPanel(all, { startDay: 1, endDay: 0 }), b));
    const other = subtractPanels(periodPanel(all, FULL_PERIOD), periodPanel(all, PERIODS.P1));
    expect(other).toEqual(add(periodPanel(all, PERIODS.P2), periodPanel(all, PERIODS.P3)));
  });
});

describe('signals', () => {
  const texts = (period = FULL_PERIOD) => periodSignals(all, period, context).map((s) => [s.id, s.requiresAction, s.text]);

  it('full log', () => {
    expect(texts()).toEqual([
      ['unbalancedDocuments', true, '1 documento(s) desbalanceado(s)'],
      ['unjustifiedDocuments', true, '6 documento(s) com justificativa pendente'],
      ['unidentifiedChanges', false, '1 registro(s) alterado(s) sem identificação de documento'],
      ['inconsistentEntries', true, '2 lançamento(s) gravado(s) como inconsistente(s): 1 pendente(s), 1 corrigido(s)'],
      ['noUserInclusions', false, 'Nenhum lançamento incluído sem usuário no log'],
      ['uncoveredDays', false, 'Todos os dias do período estão cobertos por alguma extração'],
      ['daysWithoutEvents', true, '2 dia(s) útil(eis) sem nenhum evento: 28/08/2026, 31/08/2026'],
    ]);
  });

  it('only the selected period', () => {
    expect(texts(PERIODS.P1)).toEqual([
      ['unbalancedDocuments', true, '1 documento(s) desbalanceado(s)'],
      ['unjustifiedDocuments', true, '2 documento(s) com justificativa pendente'],
      ['unidentifiedChanges', false, '1 registro(s) alterado(s) sem identificação de documento'],
      ['inconsistentEntries', true, '2 lançamento(s) gravado(s) como inconsistente(s): 1 pendente(s), 1 corrigido(s)'],
      ['noUserInclusions', false, 'Nenhum lançamento incluído sem usuário no log'],
      ['uncoveredDays', false, 'Todos os dias do período estão cobertos por alguma extração'],
      ['daysWithoutEvents', false, 'Nenhum dia útil sem evento'],
    ]);
  });

  it('flags days of the period not covered by any extraction, separately from quiet weekdays', () => {
    const wide = { startDay: day('15/08/2026'), endDay: day('05/09/2026') };
    const signals = periodSignals(all, wide, context);
    expect(signals.find((s) => s.id === 'uncoveredDays')).toMatchObject({
      count: 3,
      requiresAction: true,
      text: '3 dia(s) do período sem cobertura de extração: 15/08/2026 a 16/08/2026, 05/09/2026',
    });
    expect(signals.find((s) => s.id === 'daysWithoutEvents')?.count).toBe(2);
  });

  it('excludes configured holidays from the quiet weekdays', () => {
    const withHoliday = periodSignals(all, FULL_PERIOD, { ...context, holidays: new Set([day('31/08/2026')]) });
    expect(withHoliday.find((s) => s.id === 'daysWithoutEvents')?.text).toBe('1 dia(s) útil(eis) sem nenhum evento: 28/08/2026');
  });

  it('justified documents are not pending', () => {
    const justified = periodSignals(all, FULL_PERIOD, { ...context, justifiedDocuments: new Set(['17/08/2026|000001|001|000001']) });
    expect(justified.find((s) => s.id === 'unjustifiedDocuments')?.count).toBe(5);
  });

  it('counts inclusions without a user in the log', () => {
    const s = analyze([
      { recno: 1, op: 'Inclusão', at: '01/09/2026 10:00:00', user: '', fields: { CT2_DATA: '01/09/2026', CT2_MANUAL: '1', CT2_VALOR: '1' } },
    ]);
    const signal = periodSignals(s, FULL_PERIOD, { ...context, requestedIntervals: [] }).find((x) => x.id === 'noUserInclusions');
    expect(signal).toMatchObject({ count: 1, requiresAction: false, text: '1 lançamento(s) incluído(s) sem usuário no log' });
  });
});

describe('daily movement', () => {
  const rows = dailyMovement(all);
  const on = (d: string) => rows.find((r) => r.day === day(d));

  it('covers every day from the first to the last event', () => {
    expect(rows).toHaveLength(19);
    expect(rows[0]!.day).toBe(day('17/08/2026'));
    expect(rows.at(-1)!.day).toBe(day('04/09/2026'));
  });

  it('counts lines per category and distinct events per day', () => {
    expect(on('17/08/2026')).toEqual({ day: day('17/08/2026'), posted: 3, deleted: 0, changed: 0, events: 3 });
    expect(on('18/08/2026')).toEqual({ day: day('18/08/2026'), posted: 2, deleted: 0, changed: 0, events: 3 });
    expect(on('21/08/2026')).toEqual({ day: day('21/08/2026'), posted: 0, deleted: 1, changed: 1, events: 2 });
    expect(on('22/08/2026')).toEqual({ day: day('22/08/2026'), posted: 0, deleted: 0, changed: 0, events: 1 });
    expect(on('28/08/2026')).toEqual({ day: day('28/08/2026'), posted: 0, deleted: 0, changed: 0, events: 0 });
    expect(on('02/09/2026')).toEqual({ day: day('02/09/2026'), posted: 2, deleted: 0, changed: 0, events: 4 });
    expect(rows.reduce((n, r) => n + r.events, 0)).toBe(27);
  });
});

describe('panel data', () => {
  it('defaults to the full log and to the last day of the month of the first event', () => {
    const data = buildPanel(all, 2, { period: null, cutoffDay: null }, context);
    expect(data.period).toEqual({ startDay: day('17/08/2026'), endDay: day('04/09/2026') });
    expect(data.bounds).toEqual(data.period);
    expect(data.cutoffDay).toBe(day('31/08/2026'));
    expect(data.compositionMatches).toBe(true);
    expect(data.panel).toEqual(periodPanel(all, FULL_PERIOD));
  });

  it('offers the full log, each extraction and the user presets', () => {
    const userPresets = [{ label: 'Semana 1', period: PERIODS.P1 }];
    const data = buildPanel(all, 2, { period: PERIODS.P1, cutoffDay: day('20/08/2026') }, { ...context, userPresets });
    expect(data.presets).toEqual([
      { id: 'full', label: 'Log completo', period: { startDay: day('17/08/2026'), endDay: day('04/09/2026') } },
      { id: 'file-0', label: 'Arquivo 1 — agosto.xlsx', period: context.requestedIntervals[0] },
      { id: 'file-1', label: 'Arquivo 2 — setembro.xlsx', period: context.requestedIntervals[1] },
      { id: 'user-0', label: 'Semana 1', period: PERIODS.P1 },
    ]);
    expect(data.justificationsLoaded).toBe(false);
    expect(data.panel).toEqual(periodPanel(all, PERIODS.P1));
    expect(data.cutoffDay).toBe(day('20/08/2026'));
  });

  it('last day of month helper', () => {
    expect([lastDayOfMonth(day('17/08/2026')), lastDayOfMonth(day('10/02/2024'))]).toEqual([day('31/08/2026'), day('29/02/2024')]);
  });
});
