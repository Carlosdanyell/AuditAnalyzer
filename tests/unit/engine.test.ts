/**
 * Engine rules (docs/REGRAS_CFGR700.md, sections 4–7) on small synthetic logs and on the shared fixture.
 */
import { describe, expect, it } from 'vitest';
import { INVALID_TIME, formatIsoDateTime } from '../../src/shared/dates';
import { analyzeScope, type ScopeAnalysis } from '../../src/worker/engine/analysis';
import { recordValue, type RecordInfo } from '../../src/worker/engine/records';
import { FULL_PERIOD, periodPanel } from '../../src/worker/engine/periods';
import { scopeChecks } from '../../src/worker/engine/checks';
import { EVENTS, EXPECTED_BASE_ORDER, EXPECTED_DOCUMENT_ORDER, EXPECTED_STATS, KEYS } from '../synthetic/engineFixture';
import { analyze, buildLog, ct2Line, type LogEvent } from '../synthetic/logBuilder';

const rec = (scope: ScopeAnalysis, recno: number): RecordInfo => {
  const r = scope.records.find((x) => x.recno === recno);
  if (!r) throw new Error(`recno ${recno} ausente`);
  return r;
};
const iso = (t: number) => formatIsoDateTime(t);
const user = (scope: ScopeAnalysis, id: number) => scope.log.dict.get(id);
const doc = (scope: ScopeAnalysis, key: string) => {
  const d = scope.documents.find((x) => x.key === key);
  if (!d) throw new Error(`documento ${key} ausente`);
  return d;
};

describe('alteration classification (§6)', () => {
  const scope = analyze(EVENTS, [0]);

  it('separates effective changes, balance-type activation and user stamps', () => {
    expect(scope.stats.alterations).toEqual(EXPECTED_STATS.august.alterations);
    expect(scope.alterationEvents.map((e) => [e.recno, e.kind])).toEqual([
      [1, 'activation'],
      [2, 'effective'],
      [3, 'stamp'],
      [40, 'effective'],
      [41, 'stamp'],
      [42, 'activation'],
      [50, 'effective'],
    ]);
  });

  it('lists one Alteracoes row per non-noise field of the effective events', () => {
    const rows = scope.effectiveChangeRows.map((i) => scope.log.dict.get(scope.log.details.field[i]!));
    expect(rows).toEqual(['CT2_HIST', 'CT2_HIST', 'CT2_INCONS']);
  });

  it('counts CT2_TPSALD transitions', () => {
    expect(scope.stats.balanceType).toEqual({ total: 2, expected: 2 });
  });

  it('discards only 9 → 1; any other CT2_TPSALD transition is an effective change kept in Alteracoes', () => {
    const odd = analyze([
      { recno: 1, op: 'Inclusão', at: '01/09/2026 09:00:00', fields: ct2Line({ date: '01/09/2026', doc: '1', dc: '1', value: '1.00' }) },
      { recno: 1, op: 'Alteração', at: '01/09/2026 10:00:00', fields: { CT2_TPSALD: ['1', '9'], CT2_USERGA: ['a', 'b'] } },
      { recno: 2, op: 'Alteração', at: '01/09/2026 10:00:00', fields: { CT2_TPSALD: ['9', '1'], CT2_USERGA: ['a', 'b'] } },
    ]);
    expect(odd.stats.balanceType).toEqual({ total: 2, expected: 1 });
    expect(odd.stats.alterations).toEqual({ effective: 1, activation: 1, stamp: 0, total: 2 });
    expect(odd.effectiveChangeRows.map((i) => odd.log.dict.get(odd.log.details.field[i]!))).toEqual(['CT2_TPSALD']);
    expect(rec(odd, 1).changeCount).toBe(1);
    expect(periodPanel(odd, FULL_PERIOD).changed.manual).toEqual({ lines: 1, documents: 1, debitCents: 100 });
    expect(scopeChecks(odd, 2).discardedBalanceTypeExpected).toBe(true);
  });
});

describe('records (§5)', () => {
  const all = analyze(EVENTS);

  it('creates one record per Recno, including Recnos seen only with CT2_USERGA', () => {
    expect(all.records.map((r) => r.recno)).toEqual([1, 2, 3, 10, 11, 20, 21, 31, 32, 40, 41, 42, 50, 51, 60, 61, 70]);
    const onlyStamp = rec(all, 41);
    expect(onlyStamp.origin).toBe('unidentified');
    expect(onlyStamp.documentKey).toBe('SEM IDENTIFICACAO');
    expect(onlyStamp.valueCents).toBeNull();
    expect(onlyStamp.valueStatus).toBe('empty');
  });

  it('takes the last value in (Recno, Data Hora, ord); deletions contribute the old value', () => {
    expect(recordValue(all, rec(all, 2), 'CT2_HIST')).toBe('OUTRO');
    expect(recordValue(all, rec(all, 60), 'CT2_HIST')).toBe('COMPLEMENTO');
    expect(recordValue(all, rec(all, 10), 'CT2_VALOR')).toBe('50.00');
    expect(recordValue(all, rec(all, 3), 'CT2_ROTINA')).toBeNull();
  });

  it('breaks same-second ties by reading order', () => {
    const events: LogEvent[] = [
      { recno: 5, op: 'Alteração', at: '01/09/2026 10:00:00', user: 'zz', fields: { CT2_HIST: ['A', 'B'] } },
      { recno: 5, op: 'Alteração', at: '01/09/2026 10:00:00', user: 'aa', fields: { CT2_HIST: ['B', 'C'] } },
    ];
    const s = analyze(events);
    expect(recordValue(s, rec(s, 5), 'CT2_HIST')).toBe('C');
    expect(rec(s, 5).changeCount).toBe(2);
  });

  it('uses the first Inclusão and the last Exclusão', () => {
    const r60 = rec(all, 60);
    expect([user(all, r60.inclusionUser), iso(r60.inclusionTime)]).toEqual(['usr06', '2026-09-02 08:00:00']);
    const twice: LogEvent[] = [
      { recno: 9, op: 'Exclusão', at: '01/09/2026 10:00:00', user: 'a', fields: { CT2_HIST: 'X' } },
      { recno: 9, op: 'Exclusão', at: '01/09/2026 10:00:00', user: 'b', fields: { CT2_HIST: 'X' } },
    ];
    const s = analyze(twice);
    expect(user(s, rec(s, 9).deletionUser)).toBe('b');
  });

  it('derives origin, nature, line type and debit/credit in cents', () => {
    expect([rec(all, 1).origin, rec(all, 10).origin, rec(all, 40).origin]).toEqual(['manual', 'automatic', 'unidentified']);
    expect([rec(all, 1).lineType, rec(all, 3).lineType, rec(all, 40).lineType]).toEqual(['accounting', 'complement', 'undefined']);
    expect([rec(all, 1).debitCents, rec(all, 1).creditCents]).toEqual([10000, 0]);
    expect([rec(all, 2).debitCents, rec(all, 2).creditCents]).toEqual([0, 10000]);
    expect([rec(all, 20).debitCents, rec(all, 20).creditCents]).toEqual([1000, 1000]);
    expect([rec(all, 3).debitCents, rec(all, 3).creditCents]).toEqual([0, 0]);
    expect(rec(all, 11).valueCents).toBe(4999);
  });

  it('builds the document key only for identified records', () => {
    expect(rec(all, 1).documentKey).toBe(KEYS.D1);
    expect(rec(all, 40).documentKey).toBe('SEM IDENTIFICACAO');
  });

  it('classifies inconsistency from the first CT2_INCONS of the inclusion and the final value', () => {
    expect([rec(all, 50).inconsistency, rec(all, 51).inconsistency, rec(all, 1).inconsistency]).toEqual([
      'corrected',
      'pending',
      'no',
    ]);
    // Inclusion in stages: the first CT2_INCONS in chronological order wins.
    const staged = analyze([
      { recno: 8, op: 'Inclusão', at: '01/09/2026 10:00:00', fields: { CT2_INCONS: '1' } },
      { recno: 8, op: 'Inclusão', at: '01/09/2026 10:00:02', fields: { CT2_INCONS: '2' } },
    ]);
    expect(rec(staged, 8).inconsistency).toBe('corrected'); // 1 at the inclusion, final value 2
    const reversed = analyze([
      { recno: 8, op: 'Inclusão', at: '01/09/2026 10:00:00', fields: { CT2_INCONS: '2' } },
      { recno: 8, op: 'Inclusão', at: '01/09/2026 10:00:02', fields: { CT2_INCONS: '1' } },
    ]);
    expect(rec(reversed, 8).inconsistency).toBe('no'); // 2 at the inclusion
  });

  it('keeps effective change counts and the last change date per source file', () => {
    const r2 = rec(all, 2);
    expect(r2.changeCount).toBe(2);
    expect(Array.from(r2.lastChangeBySource, iso)).toEqual(['2026-08-20 09:00:00', '2026-09-01 10:00:00']);
    expect(rec(all, 1).changeCount).toBe(0);
    expect(rec(all, 1).activationCount).toBe(1);
    expect(rec(all, 3).stampCount).toBe(1);
  });

  it('flags unreadable values; empty only allowed on unidentified records', () => {
    const s = analyze([
      { recno: 1, op: 'Inclusão', at: '01/09/2026 10:00:00', fields: ct2Line({ date: '01/09/2026', doc: '1', dc: '1', value: '1,50' }) },
      { recno: 2, op: 'Inclusão', at: '01/09/2026 10:00:00', fields: ct2Line({ date: '01/09/2026', doc: '1', dc: '2', value: '' }) },
      { recno: 3, op: 'Inclusão', at: '01/09/2026 10:00:00', fields: ct2Line({ date: '01/09/2026', doc: '1', dc: '2', value: '1.505' }) },
      { recno: 4, op: 'Alteração', at: '01/09/2026 10:00:00', fields: { CT2_VALOR: ['', ''] } },
    ]);
    expect(s.records.map((r) => r.valueStatus)).toEqual(['invalid', 'invalid', 'invalid', 'empty']);
    expect(s.stats.invalidValues).toBe(3);
  });
});

describe('documents (§7)', () => {
  const all = analyze(EVENTS);

  it('groups identified records by key, in the Documentos order', () => {
    expect(all.documents.map((d) => d.key)).toEqual(EXPECTED_DOCUMENT_ORDER);
  });

  it('keeps the records of each document contiguous in the base, unidentified last', () => {
    expect(Array.from(all.baseOrder, (i) => all.records[i]!.recno)).toEqual(EXPECTED_BASE_ORDER);
  });

  it('computes counts, recorded/current totals, origin, base, deletion and balance', () => {
    expect(doc(all, KEYS.D1)).toMatchObject({
      accountingLines: 2,
      complementLines: 1,
      deletedLines: 0,
      changedLines: 1,
      debitRecorded: 10000,
      creditRecorded: 10000,
      debitCurrent: 10000,
      creditCurrent: 10000,
      origin: 'manual',
      base: 'complete',
      excluded: 'no',
      unbalanced: 'no',
    });
    expect(doc(all, KEYS.D2)).toMatchObject({ origin: 'automatic', unbalanced: 'yes', excluded: 'partial', debitCurrent: 0, creditCurrent: 4999 });
    expect(doc(all, KEYS.D3)).toMatchObject({ origin: 'mixed', excluded: 'total', unbalanced: 'no', debitCurrent: 0, creditCurrent: 0 });
    expect(doc(all, KEYS.D4)).toMatchObject({ base: 'partial', unbalanced: 'not-evaluable', excluded: 'partial' });
    expect(doc(all, KEYS.D7)).toMatchObject({ base: 'partial', excluded: 'total' });
  });

  it('keeps first/last deletion, first posting and last change per source', () => {
    const d3 = doc(all, KEYS.D3);
    expect([iso(d3.firstDeletion), iso(d3.lastDeletion)]).toEqual(['2026-08-21 15:00:00', '2026-08-26 15:00:00']);
    expect(iso(doc(all, KEYS.D1).firstPosting)).toBe('2026-08-17 10:00:00');
    expect(Array.from(doc(all, KEYS.D1).lastChangeBySource, iso)).toEqual(['2026-08-20 09:00:00', '2026-09-01 10:00:00']);
  });

  it('treats a 1-cent difference as unbalanced and an exact match as balanced', () => {
    const mk = (credit: string) =>
      analyze([
        { recno: 1, op: 'Inclusão', at: '01/09/2026 10:00:00', fields: ct2Line({ date: '01/09/2026', doc: '9', linha: '1', dc: '1', value: '1.00' }) },
        { recno: 2, op: 'Inclusão', at: '01/09/2026 10:00:00', fields: ct2Line({ date: '01/09/2026', doc: '9', linha: '2', dc: '2', value: credit }) },
      ]).documents[0]!.unbalanced;
    expect([mk('1.00'), mk('0.99'), mk('1.01')]).toEqual(['no', 'yes', 'yes']);
  });
});

describe('statistics per scope', () => {
  it.each([
    ['august', [0]],
    ['september', [1]],
    ['consolidated', [0, 1]],
  ] as const)('%s', (name, sources) => {
    const log = buildLog(EVENTS);
    expect(analyzeScope(log, [...sources]).stats).toEqual(EXPECTED_STATS[name]);
  });

  it('a scope only sees its own sources', () => {
    const s = analyze(EVENTS, [1]);
    expect(rec(s, 2).origin).toBe('unidentified');
    expect(rec(s, 10).included).toBe(false);
    expect(rec(s, 2).lastChangeBySource[0]).toBe(INVALID_TIME);
  });
});
