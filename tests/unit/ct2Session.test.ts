import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { defaultConfig } from '../../src/config/schema';
import { parseDate } from '../../src/shared/dates';
import { isCt2Reconciliation, isCt2Summary, type Ct2RunParameters } from '../../src/shared/modules/ct2Integrity';
import type { WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { buildCfgr700 } from '../synthetic/cfgr700';
import { buildCt2Extraction } from '../synthetic/ct2Extraction';
import { ENGINE_HOLIDAYS, ENGINE_ROWS } from '../synthetic/ct2EngineFixture';
import { fileA as cfgr700FileA } from '../synthetic/fixtures';
import { Workbook } from '../support/xlsxEval';

/** The analysis reapplied with the parameters informed on the panel, without reading the files again (decision of 29/10/2026). */
async function session() {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e), { now: () => 0 });
  const file = new File([buildCt2Extraction({ rows: ENGINE_ROWS }) as Uint8Array<ArrayBuffer>], 'sintetico.xlsx');
  await handle({ type: 'ingest', module: 'ct2Integrity', files: [file], config: ct2DefaultConfig(), platform: { schemaVersion: 1, holidays: ENGINE_HOLIDAYS } });
  const ready = events.find((e) => e.type === 'ready');
  const summary = ready?.type === 'ready' && isCt2Summary(ready.summary) ? ready.summary : null;
  events.length = 0;
  return { handle, events, parameters: summary!.analysis!.parameters };
}

const analyzed = (events: WorkerEvent[]) => {
  const e = events.find((x) => x.type === 'analyzed');
  if (e?.type !== 'analyzed' || !isCt2Summary(e.summary) || !isCt2Reconciliation(e.reconciliation)) throw new Error('sem análise');
  return e;
};
const occurrences = (e: ReturnType<typeof analyzed>, code: string) => (isCt2Summary(e.summary) ? e.summary.analysis!.tests.find((t) => t.code === code)!.occurrences : -1);

describe('CT2: reapplying the tests with other parameters', () => {
  it('reapplies with a tolerance: the board, the checks and the summary follow', async () => {
    const { handle, events, parameters } = await session();
    await handle({ type: 'analyze', requestId: 1, parameters: { ...parameters, toleranceCents: 1000 } });
    const e = analyzed(events);
    expect(e.requestId).toBe(1);
    expect(isCt2Summary(e.summary) && e.summary.analysis!.parameters.toleranceCents).toBe(1000);
    expect(occurrences(e, 'B1')).toBe(2);
    // The checks of the reading stay, the ones of the analysis are new: the same list, once each.
    expect(e.checks.map((c) => c.id)).toEqual(['ct2-reading', 'ct2-order', 'ct2-values', 'ct2-totals', 'ct2-exceptions', 'ct2-counts', 'ct2-optional', 'ct2-period']);
    expect(e.reconciliation.checks).toEqual(e.checks);
  });

  it('reapplies with a shorter period: E5 and the alert of the period (CI-10)', async () => {
    const { handle, events, parameters } = await session();
    const september: Ct2RunParameters = { ...parameters, periodStart: parseDate('01/09/2026'), periodEnd: parseDate('30/09/2026') };
    await handle({ type: 'analyze', requestId: 2, parameters: september });
    const e = analyzed(events);
    expect(occurrences(e, 'E5')).toBe(1);
    expect(e.checks.find((c) => c.id === 'ct2-period')).toMatchObject({ passed: false });
  });

  it('exports the workpaper with the parameters in force', async () => {
    const { handle, events, parameters } = await session();
    await handle({ type: 'analyze', requestId: 3, parameters: { ...parameters, toleranceCents: 1000 } });
    await handle({ type: 'export', requestId: 4, options: { scope: 0, language: 'pt', confirmFailures: true, generatedAt: '29/10/2026 10:30:00' } });
    const out = events.find((x) => x.type === 'exported');
    if (out?.type !== 'exported') throw new Error('sem planilha');
    const book = await Workbook.read(out.blob, ['Criterios']);
    const ref = book.names.get('P_TOL')!.replace(/^.*!/, '').replace(/\$/g, '');
    expect(book.value('Criterios', ref)).toBe(10);
  });

  it('refuses invalid parameters, keeping the analysis', async () => {
    const { handle, events, parameters } = await session();
    await handle({ type: 'analyze', requestId: 5, parameters: { ...parameters, periodStart: parseDate('30/09/2026'), periodEnd: parseDate('01/09/2026') } });
    await handle({ type: 'analyze', requestId: 6, parameters: { ...parameters, toleranceCents: -1 } });
    const errors = events.filter((x) => x.type === 'error');
    expect(errors.map((x) => x.type === 'error' && x.requestId)).toEqual([5, 6]);
    expect(errors[0]!.type === 'error' && errors[0]!.message).toBe('Parâmetros inválidos.');
    expect(errors[0]!.type === 'error' && errors[0]!.detail).toMatch(/data final é anterior à inicial/);
  });

  it('is not offered by the CFGR700', async () => {
    const events: WorkerEvent[] = [];
    const handle = createCommandHandler((e) => events.push(e), { now: () => 0 });
    await handle({ type: 'ingest', files: [new File([buildCfgr700(cfgr700FileA()) as Uint8Array<ArrayBuffer>], 'a.xlsx')], config: defaultConfig() });
    events.length = 0;
    await handle({ type: 'analyze', requestId: 7, parameters: {} });
    expect(events).toEqual([{ type: 'error', stage: 'documents', message: 'Recurso não disponível nesta análise.', requestId: 7 }]);
  });

  it('answers the panel by segment and the pages of the tables, following the parameters in force', async () => {
    const { handle, events, parameters } = await session();
    await handle({ type: 'segmentPanel', requestId: 8, segment: null });
    await handle({ type: 'page', requestId: 9, scope: 0, table: 'ct2Documents', filter: { test: 'B1' }, offset: 0, limit: 50 });
    await handle({ type: 'analyze', requestId: 10, parameters: { ...parameters, toleranceCents: 1000 } });
    await handle({ type: 'segmentPanel', requestId: 11, segment: 0 });
    await handle({ type: 'page', requestId: 12, scope: 0, table: 'ct2Documents', filter: { test: 'B1' }, offset: 0, limit: 50 });
    const panels = events.filter((e) => e.type === 'segmentPanel');
    const pages = events.filter((e) => e.type === 'page');
    const b1 = (e: (typeof panels)[number]) => (e.type === 'segmentPanel' ? e.data.board.find((t) => t.code === 'B1')!.occurrences : -1);
    expect(panels.map(b1)).toEqual([6, 2]);
    expect(pages.map((e) => (e.type === 'page' ? e.total : -1))).toEqual([6, 2]);
    await handle({ type: 'segmentPanel', requestId: 13, segment: 7 });
    expect(events.at(-1)).toMatchObject({ type: 'error', requestId: 13 });
  });
});

