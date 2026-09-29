/**
 * Segregated analysis by balance type (docs/REGRAS_CFGR700.md, section 13): balance type at the time of each event,
 * its source, phase, exceptions and marks; phases of lines and documents; segregation of duties.
 */
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../src/shared/dates';
import { analyzeScope, type ScopeAnalysis } from '../../src/worker/engine/analysis';
import {
  NO_PHASE,
  PHASE_IDS,
  SAME_USER_NO,
  SAME_USER_NOT_EVALUABLE,
  SAME_USER_YES,
  eventsByPhase,
  informative,
  marks,
  primaryException,
} from '../../src/worker/engine/balancePhases';
import { countEvents } from '../../src/worker/engine/events';
import { buildLog, type LogEvent } from '../synthetic/logBuilder';
import { SEG_EVENTS, SEG_KEYS } from '../synthetic/segregationFixture';

const OPS = ['?', 'I', 'A', 'E', 'R'];
const SOURCES = ['direct', 'rebuilt', 'undetermined'];

/** One line per event of the scope, in (Recno, dataHora, ord). */
function describeEvents(scope: ScopeAnalysis): string[] {
  const { phases: p, log } = scope;
  const d = log.details;
  const t = p.timeline;
  const rows: { recno: number; time: number; ord: number; text: string }[] = [];
  for (let e = 0; e < p.count; e++) {
    const g = p.global[e]!;
    const row = log.byEvent[p.pos[e]!]!;
    const flags = t.flags[g]!;
    const extra = [
      primaryException(flags) && `!${primaryException(flags)}`,
      informative(flags) && `~${informative(flags)}`,
      ...marks(flags).map((m) => `#${m}`),
    ].filter(Boolean);
    const at = formatDateTime(d.dateTime[row]!).slice(0, 5) + formatDateTime(d.dateTime[row]!).slice(10);
    const balance = t.balance[g]! >= 0 ? t.balanceValues[t.balance[g]!]! : '-';
    rows.push({
      recno: d.recno[row]!,
      time: d.dateTime[row]!,
      ord: row,
      text: [d.recno[row], OPS[d.op[row]!], at, PHASE_IDS[t.phase[g]!], SOURCES[t.source[g]!], balance, ...extra].join(' '),
    });
  }
  return rows.sort((a, b) => a.recno - b.recno || a.time - b.time || a.ord - b.ord).map((r) => r.text);
}

const CONSOLIDATED = [
  '101 I 01/09 08:00:00 pre direct 9',
  '101 A 01/09 09:00:00 pre rebuilt 9',
  '101 A 01/09 10:00:00 activation direct 9',
  '102 I 01/09 08:00:00 pre direct 9',
  '102 A 01/09 10:00:00 activation direct 9',
  '103 I 02/09 08:00:00 pre direct 9',
  '103 E 02/09 09:00:00 pre direct 9',
  '104 I 02/09 08:00:00 pre direct 9',
  '104 E 02/09 09:00:00 pre direct 9',
  '105 I 03/09 08:00:00 pre direct 9',
  '105 A 03/09 09:00:00 activation direct 9',
  '105 A 03/09 10:00:00 posted rebuilt 1 !postedChange',
  '106 I 03/09 08:00:00 pre direct 9',
  '106 A 03/09 09:00:00 activation direct 9',
  '106 E 03/09 11:00:00 posted direct 1 !postedDeletion',
  '107 I 04/09 08:00:00 posted direct 1 !directInsert',
  '107 R 04/09 08:00:00 posted rebuilt 1 ~postedRestore',
  '108 I 07/09 08:00:00 pre direct 9',
  '108 A 07/09 09:00:00 activation direct 9',
  '108 A 07/09 10:00:00 posted direct 1 !reopening',
  '108 A 07/09 11:00:00 pre rebuilt 9 !afterReopening #reopened',
  '108 A 07/09 12:00:00 activation direct 9 !afterReopening #reopened',
  '108 A 07/09 13:00:00 posted rebuilt 1 ~postedStamp',
  '109 A 08/09 08:00:00 pre rebuilt 9',
  '109 A 08/09 09:00:00 activation direct 9',
  '109 A 08/09 10:00:00 posted rebuilt 1 ~postedStamp',
  '110 A 08/09 11:00:00 undetermined undetermined -',
  '110 A 08/09 12:00:00 undetermined undetermined -',
  '111 A 09/09 08:00:00 undetermined undetermined -',
  '111 E 09/09 09:00:00 pre direct 9',
  '112 I 10/09 08:00:00 pre direct 9',
  '112 A 10/09 09:00:00 activation direct 9 #activationWithContent',
  '113 I 10/09 08:00:00 pre direct 9',
  '113 A 10/09 09:00:00 activation direct 9',
  '114 I 11/09 08:00:00 pre direct 9',
  '114 A 11/09 09:00:00 activation direct 9',
  '114 A 11/09 10:00:00 posted rebuilt 1 ~postedStamp',
  '115 I 14/09 08:00:00 pre direct 9',
  '115 A 14/09 09:00:00 pre rebuilt 9 #sameSecond',
  '115 A 14/09 09:00:00 activation direct 9 #sameSecond',
  '116 I 14/09 08:30:00 pre direct 9',
  '116 A 14/09 10:00:00 activation direct 9 #sameSecond',
  '116 A 14/09 10:00:00 posted rebuilt 1 !postedChange #sameSecond',
  '117 I 15/09 08:00:00 pre direct 9',
  '117 A 15/09 09:00:00 activation direct 9',
  '118 I 15/09 10:00:00 pre direct 9',
  '118 R 15/09 10:00:00 pre rebuilt 9',
  '119 I 15/09 11:00:00 other direct 3 !otherBalance',
  '120 I 15/09 12:00:00 pre direct 9',
  '120 I 15/09 12:00:05 pre direct 9',
  '121 I 15/09 14:00:00 pre direct 9',
  '121 A 16/09 08:00:00 pre rebuilt 9',
  '122 I 15/09 15:00:00 pre direct 9',
  '122 A 15/09 16:00:00 activation direct 9',
  '122 A 17/09 08:00:00 posted rebuilt 1 !postedChange',
  '123 A 18/09 08:00:00 pre rebuilt 9',
  '123 A 18/09 09:00:00 activation direct 9',
];

/** File B loaded alone: its own events, re-numbered as source 0. */
const fileBAlone = (): ScopeAnalysis => {
  const events: LogEvent[] = SEG_EVENTS.filter((e) => e.source === 1).map((e) => ({ ...e, source: 0 }));
  return analyzeScope(buildLog(events), [0]);
};

describe('balance type at the time of each event (consolidated base)', () => {
  const log = buildLog(SEG_EVENTS);
  const consolidated = analyzeScope(log, [0, 1]);

  it('classifies every event: balance type, source, phase, exceptions and marks', () => {
    expect(describeEvents(consolidated)).toEqual(CONSOLIDATED);
  });

  it('invariant 12: the phases add up to the events, per operation, per file and consolidated', () => {
    const { perSource, consolidated: all } = countEvents(log.details, 2, log.byEvent);
    const scopes: [ScopeAnalysis, number[]][] = [
      [analyzeScope(log, [0]), perSource[0]!.byOperation],
      [analyzeScope(log, [1]), perSource[1]!.byOperation],
      [consolidated, all.byOperation],
    ];
    for (const [scope, expected] of scopes) {
      const byPhase = eventsByPhase(log, scope.phases);
      const sum = expected.map((_, op) => byPhase.reduce((n, row) => n + row[op]!, 0));
      expect(sum).toEqual(expected);
    }
    const byPhase = eventsByPhase(log, consolidated.phases).map((row) => row.reduce((a, b) => a + b, 0));
    expect(Object.fromEntries(PHASE_IDS.map((id, i) => [id, byPhase[i]]))).toEqual({ pre: 28, activation: 15, posted: 10, other: 1, undetermined: 3 });
  });

  it('a file analysed together with others uses the reconstruction of the consolidated base', () => {
    expect(describeEvents(analyzeScope(log, [1]))).toEqual([
      '121 A 16/09 08:00:00 pre rebuilt 9',
      '122 A 17/09 08:00:00 posted rebuilt 1 !postedChange',
      '123 A 18/09 08:00:00 pre rebuilt 9',
      '123 A 18/09 09:00:00 activation direct 9',
    ]);
    expect(describeEvents(analyzeScope(log, [0]))).toEqual(CONSOLIDATED.filter((l) => !/ (16|17|18)\/09 /.test(l)));
  });

  it('a file loaded alone keeps the limitation of section 10: no earlier value, no later posting → not determined', () => {
    expect(describeEvents(fileBAlone())).toEqual([
      '121 A 16/09 08:00:00 undetermined undetermined -',
      '122 A 17/09 08:00:00 undetermined undetermined -',
      '123 A 18/09 08:00:00 pre rebuilt 9',
      '123 A 18/09 09:00:00 activation direct 9',
    ]);
  });

  it('phase of each line in the panel categories: the most precedent among the events of the category', () => {
    const p = consolidated.phases;
    const S = log.sourceCount;
    const index = new Map(consolidated.records.map((r, i) => [r.recno, i]));
    const at = (recno: number) => index.get(recno)!;
    const phase = (v: number) => (v === NO_PHASE ? null : PHASE_IDS[v]);
    expect(phase(p.inclusionPhase[at(101)]!)).toBe('pre');
    expect(phase(p.inclusionPhase[at(107)]!)).toBe('posted');
    expect(phase(p.inclusionPhase[at(119)]!)).toBe('other');
    expect(phase(p.inclusionPhase[at(109)]!)).toBeNull();
    expect(phase(p.deletionPhase[at(103)]!)).toBe('pre');
    expect(phase(p.deletionPhase[at(106)]!)).toBe('posted');
    expect(phase(p.deletionPhase[at(111)]!)).toBe('pre');
    const changed = (recno: number, source: number) => phase(p.changePhase[at(recno) * S + source]!);
    expect(changed(101, 0)).toBe('pre');
    expect(changed(105, 0)).toBe('posted');
    // Reopening (effective change in 1) and a change after it (in 9): the posted phase takes precedence.
    expect(changed(108, 0)).toBe('posted');
    expect(changed(110, 0)).toBe('undetermined');
    expect(changed(112, 0)).toBe('activation');
    expect(changed(114, 0)).toBeNull(); // stamp only: not an effective change
    expect(changed(122, 0)).toBeNull();
    expect(changed(122, 1)).toBe('posted');
    expect(changed(121, 1)).toBe('pre');
    // Phase of the line (every event) and exception flag, for the Base_Linhas tab.
    expect([101, 103, 107, 108, 110, 114, 119].map((r) => phase(p.recordPhase[at(r)]!))).toEqual(['activation', 'pre', 'posted', 'posted', 'undetermined', 'posted', 'other']);
    expect([101, 103, 107, 108, 110, 114, 119].map((r) => p.recordException[at(r)])).toEqual([0, 0, 1, 1, 0, 0, 1]);
  });

  it('segregation of duties per document: first insert, first posting and the same-user indicator', () => {
    const p = consolidated.phases;
    const d = log.details;
    const byKey = new Map(consolidated.documents.map((doc, i) => [doc.key, i]));
    const user = (e: number) => (e < 0 ? null : log.dict.get(d.user[log.byEvent[p.pos[e]!]!]!));
    const time = (e: number) => (e < 0 ? null : formatDateTime(d.dateTime[log.byEvent[p.pos[e]!]!]!));
    const same = { [SAME_USER_YES]: 'Sim', [SAME_USER_NO]: 'Não', [SAME_USER_NOT_EVALUABLE]: 'Não avaliável' } as Record<number, string>;
    const row = (key: string) => {
      const i = byKey.get(key)!;
      return [user(p.firstInclusion[i]!), time(p.firstInclusion[i]!), user(p.firstActivation[i]!), time(p.firstActivation[i]!), same[p.sameUser[i]!]];
    };
    expect(row(SEG_KEYS.S1)).toEqual(['usr01', '01/09/2026 08:00:00', 'usr02', '01/09/2026 10:00:00', 'Não']);
    expect(row(SEG_KEYS.S2)).toEqual(['usr01', '02/09/2026 08:00:00', null, null, 'Não avaliável']);
    expect(row(SEG_KEYS.S3)).toEqual(['usr03', '03/09/2026 08:00:00', 'usr03', '03/09/2026 09:00:00', 'Sim']);
    expect(row(SEG_KEYS.S4)).toEqual(['usr05', '04/09/2026 08:00:00', null, null, 'Não avaliável']);
    expect(row(SEG_KEYS.S5)).toEqual(['usr01', '07/09/2026 08:00:00', 'usr02', '07/09/2026 09:00:00', 'Não']);
    expect(row(SEG_KEYS.S6)).toEqual([null, null, null, null, 'Não avaliável']);
    expect(row(SEG_KEYS.S8)).toEqual(['usr01', '11/09/2026 08:00:00', 'usr01', '11/09/2026 09:00:00', 'Sim']);
    expect(row(SEG_KEYS.S11)).toEqual(['', '15/09/2026 08:00:00', 'usr02', '15/09/2026 09:00:00', 'Não avaliável']);
    expect(row(SEG_KEYS.S16)).toEqual(['usr01', '15/09/2026 15:00:00', 'usr01', '15/09/2026 16:00:00', 'Sim']);
    const counts = [SAME_USER_YES, SAME_USER_NO, SAME_USER_NOT_EVALUABLE].map((v) => p.sameUser.filter((x) => x === v).length);
    expect(counts).toEqual([3, 5, 8]);
    // Phase and exception flag of the document: the most precedent among its lines.
    const docPhase = (key: string) => PHASE_IDS[p.documentPhase[byKey.get(key)!]!];
    expect([SEG_KEYS.S1, SEG_KEYS.S2, SEG_KEYS.S3, SEG_KEYS.S13].map(docPhase)).toEqual(['activation', 'pre', 'posted', 'other']);
    expect([SEG_KEYS.S1, SEG_KEYS.S3, SEG_KEYS.S8].map((k) => p.documentException[byKey.get(k)!])).toEqual([0, 1, 0]);
  });

  it('the overall analysis does not change: no event is discarded or reclassified', () => {
    // Every Alteração event of section 6 (effective, activation, stamp) is still counted; the posting with a
    // content change (r112) stays an effective change.
    const { alterations } = consolidated.stats;
    expect(alterations.total).toBe(CONSOLIDATED.filter((l) => / A /.test(l)).length);
    const r112 = consolidated.alterationEvents.find((e) => e.recno === 112)!;
    expect(r112.kind).toBe('effective');
  });
});
