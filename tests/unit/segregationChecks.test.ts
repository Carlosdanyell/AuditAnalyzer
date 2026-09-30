/**
 * Invariants 12–15 of the segregated analysis (docs/REGRAS_CFGR700.md, section 13).
 */
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { analyzeScope } from '../../src/worker/engine/analysis';
import { PHASE_ACTIVATION, PHASE_PRE, SOURCE_DIRECT, SOURCE_UNDETERMINED } from '../../src/worker/engine/balancePhases';
import { segregationChecks } from '../../src/worker/engine/checks';
import { countEvents } from '../../src/worker/engine/events';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { synthBlob } from '../synthetic/cfgr700';
import { buildLog, toReportRows } from '../synthetic/logBuilder';
import { SEG_EVENTS, SEG_PARAMETERS } from '../synthetic/segregationFixture';

describe('invariants 12–15', () => {
  it('pass on the synthetic cases, with the exceptions reported as an alert, per file and consolidated', async () => {
    const result = await runIngestion(
      [0, 1].map((s) => ({ name: `arquivo${'AB'[s]}.xlsx`, blob: synthBlob({ rows: toReportRows(SEG_EVENTS, s), parameters: SEG_PARAMETERS[s]! }) })),
      defaultConfig(),
      () => {},
    );
    const byId = Object.fromEntries(result.reconciliation.checks.map((c) => [c.id, c]));
    expect(byId['phases-sum']).toMatchObject({ passed: true, severity: 'error' });
    expect(byId['phase-activation']).toMatchObject({ passed: true, severity: 'error', message: 'Toda movimentação classificada como efetivação é a mudança do tipo de saldo de 9 para 1.' });
    expect(byId['phase-balance-source']).toMatchObject({ passed: true, severity: 'error' });
    expect(byId['posted-exceptions']).toMatchObject({
      label: 'Lançamentos movimentados depois da efetivação',
      passed: false,
      severity: 'warning',
      message:
        'arquivoA.xlsx: 8 movimentação(ões) fora do esperado — 2 alteração(ões) depois da efetivação, 1 exclusão(ões) depois da efetivação, 1 inclusão(ões) direto em saldo 1, sem passar por 9, 1 reabertura(s) (tipo de saldo mudado fora da efetivação 9 → 1), 2 movimentação(ões) depois de uma reabertura, 1 movimentação(ões) em tipo de saldo diferente de 9 e 1; ' +
        'arquivoB.xlsx: 1 movimentação(ões) fora do esperado — 1 alteração(ões) depois da efetivação; ' +
        'Consolidado: 9 movimentação(ões) fora do esperado — 3 alteração(ões) depois da efetivação, 1 exclusão(ões) depois da efetivação, 1 inclusão(ões) direto em saldo 1, sem passar por 9, 1 reabertura(s) (tipo de saldo mudado fora da efetivação 9 → 1), 2 movimentação(ões) depois de uma reabertura, 1 movimentação(ões) em tipo de saldo diferente de 9 e 1. ' +
        'O esperado é incluir em saldo 9, efetivar (9 → 1) e corrigir só por estorno. Veja a lista no Painel, modo Segregado.',
    });
  });

  it('each invariant fails when its rule is broken', () => {
    const log = buildLog(SEG_EVENTS);
    const scope = analyzeScope(log, [0, 1]);
    const events = countEvents(log.details, 2, log.byEvent).consolidated.byOperation;
    expect(segregationChecks(scope, events)).toMatchObject({ phasesAddUp: true, activationsHaveTransition: true, noPresumedBalance: true });

    // 12: a count that differs from the events.
    expect(segregationChecks(scope, events.map((n, op) => (op === 2 ? n + 1 : n))).phasesAddUp).toBe(false);

    const t = log.timeline;
    const pre = t.phase.findIndex((p, g) => p === PHASE_PRE && t.source[g] === SOURCE_DIRECT && log.details.op[log.byEvent[t.start[g]!]!] === 3);
    // 13: an event without the transition 9 → 1 in the posting phase.
    t.phase[pre] = PHASE_ACTIVATION;
    expect(segregationChecks(scope, events).activationsHaveTransition).toBe(false);
    t.phase[pre] = PHASE_PRE;
    // 14: a balance type with no origin (presumed), or "read from the log" with a value the event does not carry.
    t.source[pre] = SOURCE_UNDETERMINED;
    expect(segregationChecks(scope, events).noPresumedBalance).toBe(false);
    t.source[pre] = SOURCE_DIRECT;
    const balance = t.balance[pre]!;
    t.balance[pre] = t.balanceValues.indexOf('1');
    expect(segregationChecks(scope, events).noPresumedBalance).toBe(false);
    t.balance[pre] = balance;
    expect(segregationChecks(scope, events)).toMatchObject({ activationsHaveTransition: true, noPresumedBalance: true });
  });
});
