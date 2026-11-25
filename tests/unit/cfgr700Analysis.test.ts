import { describe, expect, it } from 'vitest';
import { cfgr700AnalysisTests, cfgr700TestOf } from '../../src/app/modules/cfgr700/analysisTests';
import { defaultConfig } from '../../src/config/schema';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { Session } from '../../src/worker/session';
import { synthBlob } from '../synthetic/cfgr700';
import { EVENTS } from '../synthetic/engineFixture';
import { toReportRows } from '../synthetic/logBuilder';
import { SEG_EVENTS, SEG_PARAMETERS } from '../synthetic/segregationFixture';

/**
 * The list of the Análise of the CFGR700 (flow revision of 25/11/2026): every flag with a table opens exactly as many
 * rows as its number, for the period chosen.
 */
async function session(files: { name: string; blob: Blob }[]) {
  const config = defaultConfig();
  return { session: new Session(await runIngestion(files, config, () => {}), config), config };
}

const PERIODS = [
  { 'Data inicial': '17/08/2026', 'Data final': '31/08/2026' },
  { 'Data inicial': '01/09/2026', 'Data final': '04/09/2026' },
];

describe('CFGR700: tests of the Análise', () => {
  it('each number equals the total of the table it opens, in every scope and for the full log', async () => {
    const cases = [
      [0, 1].map((s) => ({ name: `f${s}.xlsx`, blob: synthBlob({ rows: toReportRows(EVENTS, s), parameters: PERIODS[s]! }) })),
      [0, 1].map((s) => ({ name: `s${s}.xlsx`, blob: synthBlob({ rows: toReportRows(SEG_EVENTS, s), parameters: SEG_PARAMETERS[s]! }) })),
    ];
    let checked = 0;
    for (const files of cases) {
      const { session: s, config } = await session(files);
      for (let scope = 0; scope < 3; scope++) {
        const data = s.panel(scope, null, null);
        for (const period of [null, ...data.presets.map((p) => p.period)]) {
          const panel = s.panel(scope, period, null);
          const tests = cfgr700AnalysisTests(panel, config.balanceType);
          for (const t of tests) {
            if (!t.request) continue;
            expect(s.page(scope, t.request.table, t.request.filter, undefined, 0, 1).total, `${t.key} ${scope}`).toBe(t.count);
            expect(cfgr700TestOf(tests, t.request)?.key).toBe(t.key);
            if (t.count > 0) checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('flags needing action are Alerta, the others Informativo; the segregated exceptions are Alerta', async () => {
    const files = [0, 1].map((s) => ({ name: `s${s}.xlsx`, blob: synthBlob({ rows: toReportRows(SEG_EVENTS, s), parameters: SEG_PARAMETERS[s]! }) }));
    const { session: s, config } = await session(files);
    const panel = s.panel(2, null, null);
    const tests = cfgr700AnalysisTests(panel, config.balanceType);
    const posted = tests.find((t) => t.key === 'exception:postedChange')!;
    expect(posted).toMatchObject({ label: 'Alteração em lançamento postado', level: 'warning', count: 3, countText: '3 eventos', opens: true });
    for (const sig of panel.signals) expect(tests.find((t) => t.key === `signal:${sig.id}`)!.level).toBe(sig.requiresAction ? 'warning' : 'info');
    expect(tests.find((t) => t.key === 'signal:uncoveredDays')!.opens).toBe(false);
  });
});
