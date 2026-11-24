import { describe, expect, it } from 'vitest';
import type { ReconciliationTableFilter, ReconciliationTableId } from '../../src/shared/modules/reconciliation';
import type { WorkerEvent } from '../../src/shared/protocol';
import { reconciliationWorker } from '../../src/worker/modules/reconciliation';
import type { ModuleSession } from '../../src/worker/modules/types';
import { engineCases, engineFixture, type EngineFixture } from '../synthetic/payrollLedgerFixture';
import { configOf, screenFixture, sessionFiles } from '../synthetic/reconciliationSession';

/**
 * Painel = tables (Phase 15, step 5; section 9 of docs/REGRAS_CONCILIADOR.md): every number of the Painel and of the key
 * figures is the sum (or the count) of the table its click opens, account by account, over synthetic sessions with a
 * settlement identified, an F1c, an F1a, real and pre-entry ledgers. Invented data only.
 */
async function session(fx: EngineFixture, split?: { real: EngineFixture['ledger']; preEntry: EngineFixture['ledger'] }) {
  const ingest = reconciliationWorker.configure(configOf(fx.profile), null);
  const ledgers = split ? [{ format: 'text' as const, fixture: split.real }, { format: 'xml' as const, fixture: split.preEntry }] : [{ format: 'text' as const }];
  const files = sessionFiles(fx, ledgers).map((f) => ({ name: f.name, blob: new Blob([f.bytes as Uint8Array<ArrayBuffer>]) }));
  const events: WorkerEvent[] = [];
  const result = await ingest(files, (e) => events.push(e), { progressIntervalMs: 0 });
  const s = result.session as Required<Pick<ModuleSession, 'page' | 'account'>>;
  const table = (id: ReconciliationTableId, conc: ReconciliationTableFilter) => {
    const p = s.page(0, id, { conc }, undefined, 0, 1_000_000);
    const at = (column: string) => p.columns.findIndex((c) => c.id === column);
    return { total: p.total, sum: (column: string) => p.rows.reduce((t, r) => t + ((r[at(column)] as number | null) ?? 0), 0), rows: p.rows, at };
  };
  return { summary: result.summary as Extract<typeof result.summary, { module: 'reconciliation' }>, table, account: s.account };
}

const cases: [string, () => Promise<Awaited<ReturnType<typeof session>>>][] = [
  [
    'real + pre-entry, F1c, settlement identified',
    () => {
      const { fx, real, preEntry } = screenFixture();
      return session(fx, { real, preEntry });
    },
  ],
  [
    'F1a, F1b, F1c, F1d and F1e',
    () => {
      const fx = engineFixture();
      engineCases.differentValue(fx);
      engineCases.outsideCriterionDifferent(fx);
      engineCases.unrecognizedAndBase(fx);
      engineCases.missingIntegration(fx);
      return session(fx);
    },
  ],
];

describe.each(cases)('Painel = tables (%s)', (_name, open) => {
  it('every number of an account is the sum of the table its click opens', async () => {
    const { summary, table, account } = await open();
    for (const row of summary.accounts) {
      if (row.status !== 'analyzed') continue;
      const a = row.index;
      // Esperado → Folha of the account: its criterion in the scope; Σ Contribuição = esperado.
      expect(table('concPayroll', { account: a }).sum('contribution')).toBe(row.expected);
      // Saldo real, pré-lançamento and combined → Razão from the opening of the competence; Σ = saldo.
      expect(table('concLedger', { account: a, part: 'balance' }).sum('amount')).toBe(row.balance);
      if (row.balanceReal !== null) expect(table('concLedger', { account: a, part: 'balance', balanceType: '1' }).sum('amount')).toBe(row.balanceReal);
      if (row.balancePreEntry !== null) expect(table('concLedger', { account: a, part: 'balance', balanceType: '9' }).sum('amount')).toBe(row.balancePreEntry);
      expect(row.difference).toBe(row.expected! - row.balance!);
      // Baixa → the lines of the settlement; their sum reduces the balance by the settled amount.
      const settled = table('concLedger', { account: a, settled: true });
      expect(settled.total).toBe(row.settlement!.lines);
      expect(-settled.sum('amount')).toBe(row.settlement!.amount);
      // Achados of the account by severity.
      for (const severity of ['error', 'warning', 'info'] as const) expect(table('concFindings', { account: a, severity }).total).toBe(row.findings[severity]);
      // The bridge of the side panel: Σ parcels = saldo contábil; each parcel = its base + Σ of its lines in the Razão.
      const detail = account(a);
      expect(detail.bridge!.closes).toBe(true);
      expect(detail.bridge!.parcels.reduce((t, p) => t + p.amount, 0)).toBe(row.balance);
      for (const p of detail.bridge!.parcels) {
        const lines = table('concLedger', { account: a, parcel: p.id });
        expect(lines.total).toBe(p.lineCount);
        expect(p.base + lines.sum('amount')).toBe(p.amount);
      }
      // The lines of the competence: each in exactly one parcel (CC-2).
      expect(detail.bridge!.parcels.reduce((t, p) => t + p.lineCount, 0)).toBe(table('concLedger', { account: a }).total);
    }
  });

  it('every key figure is the count of its table', async () => {
    const { summary, table } = await open();
    const f = summary.figures;
    expect(table('concFindings', { code: 'F1a' }).total).toBe(f.integrationErrors);
    expect(table('concFindings', { code: 'F1c' }).total).toBe(f.missingIntegration);
    expect(table('concIntegration', { keyStatus: 'missing' }).total).toBe(f.missingIntegration);
    expect(table('concIntegration', { keyStatus: 'different' }).total).toBe(f.divergentKeys);
    expect(table('concIntegration', {}).total).toBe(f.keys);
    expect(table('concLedger', { checked: true }).total).toBe(f.checkedLines);
    expect(table('concAccounts', {}).total).toBe(f.accounts);
    expect(summary.accounts.filter((r) => r.difference === 0).length).toBe(f.noDifference);
    expect(summary.accounts.filter((r) => r.difference !== null && r.difference !== 0).length).toBe(f.withDifference);
    // Achados: each finding with lines opens exactly them; the groups are the table by severity.
    summary.findings.forEach((finding, i) => {
      if (finding.lines > 0) expect(table('concLedger', { finding: i }).total).toBe(finding.lines);
    });
    for (const severity of ['error', 'warning', 'info'] as const) expect(table('concFindings', { severity }).total).toBe(summary.findings.filter((x) => x.severity === severity).length);
    // No filter by value: every difference ≠ 0 is a finding (F2), from R$ 0,01 (D-7).
    expect(summary.findings.filter((x) => x.code === 'F2').length).toBe(f.withDifference);
  });
});

describe('tables of the Conciliador', () => {
  it('Razão: Sim/Não in the settlement column, balance type and class of the batch; search and sort', async () => {
    const { fx, real, preEntry } = screenFixture();
    const { table } = await session(fx, { real, preEntry });
    const t = table('concLedger', { account: 1, part: 'balance' });
    const values = (column: string) => t.rows.map((r) => r[t.at(column)]);
    expect(new Set(values('settled'))).toEqual(new Set(['Sim', 'Não']));
    expect(values('kind').filter((k) => k === 'Saldo inicial da competência')).toHaveLength(2);
    expect(new Set(values('balanceType'))).toEqual(new Set(['Real (1)', 'Pré-lançamento (9)']));
    expect(values('batchClass')).toContain('Financeiro');
  });

  it('Folha without an account: every block × verba; Integração: one row per key of every account', async () => {
    const fx = engineFixture();
    const { table, summary } = await session(fx);
    const folha = table('concPayroll', {});
    expect(folha.total).toBeGreaterThan(0);
    expect(new Set(folha.rows.map((r) => r[folha.at('level')]))).toEqual(new Set(['Filial', 'Empresa', 'Grupo de Empresas']));
    const integration = table('concIntegration', { account: 0 });
    expect(integration.total).toBe(summary.figures.keys - table('concIntegration', { account: 1 }).total - table('concIntegration', { account: 2 }).total);
    expect(new Set(integration.rows.map((r) => r[integration.at('status')]))).toEqual(new Set(['Confere']));
  });
});
