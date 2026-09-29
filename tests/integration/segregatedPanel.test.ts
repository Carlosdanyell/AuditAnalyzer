/**
 * Panel of the segregated analysis (docs/REGRAS_CFGR700.md, section 13): the phases decompose the overall panel,
 * and every number opens a table with exactly that number of rows.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { OPERATION_KEYS, defaultConfig } from '../../src/config/schema';
import { parseDate } from '../../src/shared/dates';
import type { Category, CategoryPanel, OriginFilter, Period, PeriodPanel, TableFilter } from '../../src/shared/protocol';
import { EXCEPTIONS, INFORMATIVES, MARKS, PHASES } from '../../src/shared/segregation';
import { periodPresets, scopeBounds } from '../../src/worker/engine/panel';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { Session } from '../../src/worker/session';
import { synthBlob } from '../synthetic/cfgr700';
import { EVENTS } from '../synthetic/engineFixture';
import { toReportRows, type LogEvent } from '../synthetic/logBuilder';
import { SEG_EVENTS, SEG_PARAMETERS } from '../synthetic/segregationFixture';

const CATEGORIES: Category[] = ['deleted', 'changed', 'unbalanced', 'posted'];
const flat = (c: CategoryPanel) => [
  c.manual.lines,
  c.manual.documents,
  c.manual.debitCents,
  c.automatic.lines,
  c.automatic.documents,
  c.automatic.debitCents,
  c.mixedDocuments,
  c.totalDocuments,
  c.unidentifiedLines,
];

async function sessionOf(events: LogEvent[], parameters: Record<string, string>[]) {
  const config = defaultConfig();
  const sources = [...new Set(events.map((e) => e.source ?? 0))].sort();
  const result = await runIngestion(
    sources.map((s) => ({ name: `arquivo${s}.xlsx`, blob: synthBlob({ rows: toReportRows(events, s), parameters: parameters[s] ?? {} }) })),
    config,
    () => {},
  );
  return new Session(result, config);
}

function periodsOf(session: Session, scope: number): Period[] {
  const s = session.result.analyses[scope]!;
  const presets = periodPresets(s, scopeBounds(s), session.context).map((p) => p.period);
  const days = presets.flatMap((p) => [p.startDay, p.endDay]);
  const single = Array.from({ length: Math.max(...days) - Math.min(...days) + 1 }, (_, i) => ({ startDay: Math.min(...days) + i, endDay: Math.min(...days) + i }));
  return [...presets, ...single];
}

describe.each([
  ['section 13 cases', () => sessionOf(SEG_EVENTS, SEG_PARAMETERS)],
  ['phase 2 cases', () => sessionOf(EVENTS, [{ 'Data inicial': '17/08/2026', 'Data final': '31/08/2026' }, { 'Data inicial': '01/09/2026', 'Data final': '04/09/2026' }])],
])('segregated panel (%s)', (_name, make) => {
  let session: Session;
  beforeAll(async () => {
    session = await make();
  });

  it('the phases add up to the overall panel, for every scope, preset and day', () => {
    for (let scope = 0; scope < session.result.analyses.length; scope++) {
      for (const period of periodsOf(session, scope)) {
        const data = session.panel(scope, period, null);
        for (const category of CATEGORIES) {
          const sum = PHASES.map((ph) => flat(data.segregated.byPhase[ph][category])).reduce((a, b) => a.map((v, i) => v + b[i]!));
          expect(sum, `escopo ${scope} ${category} ${period.startDay}`).toEqual(flat(data.panel[category]));
        }
        const events = PHASES.reduce((n, ph) => n + data.segregated.events[ph].total, 0);
        const daily = data.daily.filter((d) => d.day >= period.startDay && d.day <= period.endDay).reduce((n, d) => n + d.events, 0);
        expect(events, `eventos do período, escopo ${scope}`).toBe(daily);
      }
    }
  });

  it('each number of the segregated panel opens a table with exactly that number of rows', () => {
    const scope = session.result.analyses.length - 1;
    for (const period of periodsOf(session, scope).slice(0, 3)) {
      const data = session.panel(scope, period, null);
      const total = (table: Parameters<Session['page']>[1], filter: TableFilter) => session.page(scope, table, filter, undefined, 0, 1).total;
      for (const phase of PHASES) {
        const p: PeriodPanel = data.segregated.byPhase[phase];
        for (const category of CATEGORIES) {
          const c = p[category];
          const lines = category === 'deleted' ? 'deletions' : 'baseRows';
          const docs = category === 'unbalanced' ? 'unbalanced' : 'documents';
          const f = (origin?: OriginFilter): TableFilter => ({ category, period, phase, ...(origin && { origin }) });
          expect(total(lines, f('manual')), `${phase} ${category} linhas manuais`).toBe(c.manual.lines);
          expect(total(lines, f('automatic'))).toBe(c.automatic.lines);
          expect(total('baseRows', f('unidentified'))).toBe(c.unidentifiedLines);
          expect(total(docs, f('manual'))).toBe(c.manual.documents);
          expect(total(docs, f('mixed'))).toBe(c.mixedDocuments);
          expect(total(docs, f()), `${phase} ${category} documentos`).toBe(c.totalDocuments);
        }
        OPERATION_KEYS.forEach((operation) =>
          expect(total('segregation', { period, phase, operation }), `${phase} ${operation}`).toBe(data.segregated.events[phase][operation]),
        );
        expect(total('segregation', { period, phase })).toBe(data.segregated.events[phase].total);
      }
      for (const id of EXCEPTIONS) expect(total('segregation', { period, exception: id })).toBe(data.segregated.exceptions[id]);
      expect(total('segregation', { period, exception: 'any' })).toBe(data.segregated.exceptionEvents);
      for (const id of INFORMATIVES) expect(total('segregation', { period, informative: id })).toBe(data.segregated.informatives[id]);
      for (const id of MARKS) expect(total('segregation', { period, mark: id })).toBe(data.segregated.marks[id]);
    }
  });
});

describe('segregated panel of the section 13 cases (consolidated, full log)', () => {
  it('counts events, exceptions, informative events, marks and the same-user indicator', async () => {
    const session = await sessionOf(SEG_EVENTS, SEG_PARAMETERS);
    const s = session.panel(2, null, null).segregated;
    expect(Object.fromEntries(PHASES.map((ph) => [ph, s.events[ph]]))).toEqual({
      pre: { insert: 18, update: 6, delete: 3, restore: 1, total: 28 },
      activation: { insert: 0, update: 15, delete: 0, restore: 0, total: 15 },
      posted: { insert: 1, update: 7, delete: 1, restore: 1, total: 10 },
      other: { insert: 1, update: 0, delete: 0, restore: 0, total: 1 },
      undetermined: { insert: 0, update: 3, delete: 0, restore: 0, total: 3 },
    });
    expect(s.exceptions).toEqual({ reopening: 1, afterReopening: 2, directInsert: 1, postedChange: 3, postedDeletion: 1, otherBalance: 1 });
    expect(s.exceptionEvents).toBe(9);
    expect(s.informatives).toEqual({ postedStamp: 3, postedRestore: 1 });
    expect(s.marks).toEqual({ activationWithContent: 1, sameSecond: 4, reopened: 2 });
    expect(s.sameUser).toEqual({ yes: 3, no: 5, notEvaluable: 8 });
    // Posted category (inserts): one line included directly in 1 and one in another balance type.
    expect([s.byPhase.pre.posted.manual.lines, s.byPhase.posted.posted.manual.lines, s.byPhase.other.posted.manual.lines]).toEqual([17, 1, 1]);
    // Changed category: the line changed after posting (r105, r108, r116, r122) is in the posted phase.
    expect(s.byPhase.posted.changed.manual.lines).toBe(4);
    expect(s.byPhase.activation.changed.manual.lines).toBe(1);
    expect(s.byPhase.undetermined.changed.manual.lines + s.byPhase.undetermined.changed.unidentifiedLines).toBe(2);
    // Same-user documents counted by the date of their first posting.
    const september1to3 = session.panel(2, { startDay: parseDate('01/09/2026'), endDay: parseDate('03/09/2026') }, null).segregated;
    expect(september1to3.sameUser).toEqual({ yes: 1, no: 1, notEvaluable: 8 });
  });
});
