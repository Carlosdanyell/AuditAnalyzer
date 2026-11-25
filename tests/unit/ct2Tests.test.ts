import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { defaultConfig } from '../../src/config/schema';
import type { Ct2Filter, Ct2TableId, Ct2TestsData } from '../../src/shared/modules/ct2Integrity';
import type { Command, WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { buildCfgr700 } from '../synthetic/cfgr700';
import { buildCt2Extraction } from '../synthetic/ct2Extraction';
import { ENGINE_HOLIDAYS, ENGINE_ROWS } from '../synthetic/ct2EngineFixture';
import { fileA as cfgr700FileA } from '../synthetic/fixtures';

/**
 * The list of tests of the Análise and its Teste filter (flow revision of 25/11/2026): every number of the list is the
 * total of the table it opens, under the same common filter.
 */
async function session() {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e), { now: () => 0 });
  const file = new File([buildCt2Extraction({ rows: ENGINE_ROWS }) as Uint8Array<ArrayBuffer>], 'sintetico.xlsx');
  await handle({ type: 'ingest', module: 'ct2Integrity', files: [file], config: ct2DefaultConfig(), platform: { schemaVersion: 1, holidays: ENGINE_HOLIDAYS } });
  let id = 100;
  const ask = async <T extends WorkerEvent['type']>(command: { type: Command['type'] } & Record<string, unknown>, type: T): Promise<Extract<WorkerEvent, { type: T }>> => {
    events.length = 0;
    await handle({ ...command, requestId: ++id } as Command);
    const answer = events.find((e) => e.type === type || e.type === 'error');
    if (!answer || answer.type !== type) throw new Error(answer?.type === 'error' ? answer.message : 'sem resposta');
    return answer as Extract<WorkerEvent, { type: T }>;
  };
  const tests = async (filter: Ct2Filter) => (await ask({ type: 'tests', filter }, 'tests')).data as Ct2TestsData;
  const total = async (table: Ct2TableId, filter: Record<string, unknown>) => (await ask({ type: 'page', scope: 0, table, filter, offset: 0, limit: 1 }, 'page')).total;
  const board = async (filter: Ct2Filter) => (await ask({ type: 'segmentPanel', filter }, 'segmentPanel')).data.board;
  return { tests, total, board };
}

const FILTERS: Ct2Filter[] = [{}, { segment: 1 }, { routine: 'CTBANFE' }, { origins: ['manual'] }, { account: { code: '211', prefix: true } }, { origins: ['automatic', 'unidentified'] }];

describe('CT2: tests of the Análise with their rows in each table', () => {
  it('each count equals the total of the table filtered by the test, under every filter', async () => {
    const s = await session();
    for (const filter of FILTERS) {
      const data = await s.tests(filter);
      const board = await s.board(filter);
      expect(data.filter).toEqual(filter);
      expect(data.tests.map((t) => t.code)).toEqual(board.map((t) => t.code));
      for (const t of data.tests) {
        // Ocorrências: the same number as the board of the panel.
        expect(t.occurrences, `${t.code} ${JSON.stringify(filter)}`).toBe(board.find((b) => b.code === t.code)!.occurrences);
        expect(t.rule.length).toBeGreaterThan(10);
        if (t.state !== 'on' || t.group === null) {
          expect(t.tables).toEqual({});
          continue;
        }
        expect(t.tables.ct2Exceptions).toBe(t.occurrences);
        for (const [table, count] of Object.entries(t.tables)) expect(count, `${t.code} ${table} ${JSON.stringify(filter)}`).toBe(await s.total(table as Ct2TableId, { ...filter, test: t.code }));
      }
    }
  });

  it('lists each test in Ocorrências and in the table of its level', async () => {
    const s = await session();
    const data = await s.tests({});
    const tables = (code: string) => Object.keys(data.tests.find((t) => t.code === code)!.tables).sort();
    expect(tables('B1')).toEqual(['ct2Documents', 'ct2Exceptions']);
    expect(tables('B2')).toEqual(['ct2Batches', 'ct2Exceptions']);
    expect(tables('B3')).toEqual(['ct2Days', 'ct2Exceptions']);
    expect(tables('I1')).toEqual(['ct2Base', 'ct2Exceptions']);
    expect(tables('P4')).toEqual(['ct2Documents', 'ct2Exceptions']);
    expect(data.tests.find((t) => t.code === 'B1')!.tables.ct2Documents).toBe(6);
    // Batch and day items leave with a line-level filter, as in the board; Lotes ignores that filter.
    const routine = await s.tests({ routine: 'CTBANFE' });
    expect(routine.tests.find((t) => t.code === 'B2')!.occurrences).toBe(0);
  });

  it('counts the Misto documents under the filter, none when the origin filter leaves them out', async () => {
    const s = await session();
    expect((await s.tests({})).mixedDocuments).toBe(await s.total('ct2Documents', { origins: ['mixed'] }));
    expect((await s.tests({})).mixedDocuments).toBeGreaterThan(0);
    expect((await s.tests({ origins: ['manual'] })).mixedDocuments).toBe(0);
    expect((await s.tests({ origins: ['manual', 'mixed'] })).mixedDocuments).toBe(await s.total('ct2Documents', { origins: ['mixed'] }));
  });

  it('is not offered by the CFGR700', async () => {
    const events: WorkerEvent[] = [];
    const handle = createCommandHandler((e) => events.push(e), { now: () => 0 });
    const file = new File([buildCfgr700(cfgr700FileA()) as Uint8Array<ArrayBuffer>], 'a.xlsx');
    await handle({ type: 'ingest', files: [file], config: defaultConfig() });
    events.length = 0;
    await handle({ type: 'tests', requestId: 1, filter: {} });
    expect(events[0]).toMatchObject({ type: 'error', requestId: 1 });
  });
});
