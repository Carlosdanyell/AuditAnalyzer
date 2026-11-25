import { describe, expect, it } from 'vitest';
import { readPayrollProfileFile, type PayrollProfileConfig } from '../../src/config/reconciliationSchema';
import { parseDate } from '../../src/shared/dates';
import { readSpreadsheetRows } from '../../src/worker/modules/reconciliation/formats/spreadsheetml';
import { readSpoolLines } from '../../src/worker/modules/reconciliation/formats/text';
import { readPayrollSpool } from '../../src/worker/modules/reconciliation/payrollSource';
import { analyzePayroll, type PayrollAccountResult, type PayrollAnalysis } from '../../src/worker/modules/reconciliation/profiles/payroll/analyze';
import { SUGGESTED_SITUATION_LABELS, suggestedSituation, type AccountFinding } from '../../src/worker/modules/reconciliation/profiles/payroll/findings';
import { LedgerSheetReader, LedgerTextReader, type LedgerReading } from '../../src/worker/modules/reconciliation/reports/ctbr400';
import { ledgerSpool, ledgerXml, type LedgerFixture } from '../synthetic/ledgerFixture';
import { brMoney } from '../synthetic/payrollFixture';
import {
  ASSET_ACCOUNT,
  NET_ACCOUNT,
  VERBAS_ACCOUNT,
  accountOf,
  branchAmounts,
  engineCases,
  engineFixture,
  groupAmounts,
  integrationOf,
  splitByType,
  type EngineFixture,
} from '../synthetic/payrollLedgerFixture';
import { provisionProfileFile } from '../synthetic/reconciliationProfile';

/**
 * Engine of the payroll profile, Padrão A (docs/REGRAS_CONCILIADOR.md, sections 7 and 11; Phase 15, step 4), over the
 * synthetic payroll and the ledger derived from it (tests/synthetic/payrollLedgerFixture.ts): the cases of the table
 * of section 6.2 of the phase, each with CC-2, CC-3 and CC-4 true, the same output in two runs and in both formats of
 * the ledger (CC-5). Invented codes and values only.
 */
const blob = (data: Uint8Array | string) => new Blob([data as BlobPart]);

async function readLedger(f: LedgerFixture, format: 'text' | 'xml'): Promise<LedgerReading> {
  if (format === 'text') {
    const reader = new LedgerTextReader();
    await readSpoolLines(blob(ledgerSpool(f)), (line, n) => reader.line(line, n));
    return reader.finish();
  }
  const reader = new LedgerSheetReader();
  await readSpreadsheetRows(blob(ledgerXml(f)), (s, name, r, cells) => reader.row(s, name, r, cells));
  return reader.finish();
}

function profileOf(fx: EngineFixture): PayrollProfileConfig {
  const read = readPayrollProfileFile(fx.profile);
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.profile;
}

async function run(fx: EngineFixture, options: { format?: 'text' | 'xml'; split?: boolean } = {}): Promise<PayrollAnalysis> {
  const source = await readPayrollSpool(blob(fx.payroll.bytes), { netPayCode: fx.profile.payrollReport.netPayCode });
  expect(source.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([]);
  const format = options.format ?? 'text';
  const ledgers = options.split
    ? await (async () => {
        const { real, preEntry } = splitByType(fx.ledger);
        return [
          { name: 'real.txt', reading: await readLedger(real, format) },
          { name: 'pre.txt', reading: await readLedger(preEntry, format) },
        ];
      })()
    : [{ name: 'razao', reading: await readLedger(fx.ledger, format) }];
  return analyzePayroll({ payroll: source.report, ledgers, profile: profileOf(fx) });
}

/** Without what only one format has (line of the file, FILIAL DE ORIGEM): CC-5 compares the rest. */
function essence(a: PayrollAnalysis): unknown {
  return JSON.parse(JSON.stringify(a, (k, v: unknown) => (k === 'source' || k === 'originBranch' ? undefined : v)));
}

const acc = (r: PayrollAnalysis, code: string) => r.accounts.find((a) => a.account === code)!;
const codes = (a: PayrollAccountResult) => a.findings.map((f) => f.code);
const parcel = (a: PayrollAccountResult, id: string) => a.bridge!.parcels.find((p) => p.id === id)?.amount ?? 0;
const day = (s: string) => parseDate(s);

/** CC-2, CC-3 and CC-4 true in every account; same output in two runs and with the ledger in XML (CC-5). */
async function analyzed(fx: EngineFixture, options: { split?: boolean } = {}): Promise<PayrollAnalysis> {
  const r = await run(fx, options);
  for (const a of r.accounts) {
    expect(a.status, a.account).toBe('analyzed');
    expect(a.invariants, a.account).toEqual({ 'CC-2': true, 'CC-3': true, 'CC-4': true });
    expect(a.bridge!.total, a.account).toBe(a.ledgerBalance);
  }
  expect(r.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([]);
  expect(await run(fx, options)).toEqual(r);
  expect(essence(await run(fx, { ...options, format: 'xml' }))).toEqual(essence(r));
  return r;
}

function fixture(change?: (f: EngineFixture) => void): EngineFixture {
  const f = engineFixture();
  change?.(f);
  return f;
}

describe('the synthetic payroll and ledger are coherent (base, no difference)', () => {
  it('expected (F2), opening of the competence, book balance and difference of every account', async () => {
    const f = fixture();
    const g = groupAmounts(f.payroll, 'Todos');
    const r = await analyzed(f);
    expect(r.period).toBe('202610');
    expect(r.accounts.map((a) => [a.account, a.expected!.amount, a.competenceOpening, a.ledgerBalance, a.difference, a.situation, a.settlement!.situation])).toEqual([
      [NET_ACCOUNT, g['X99']!.amountCents, 500000, g['X99']!.amountCents, 0, 'noDifference', 'IDENTIFICADA'],
      [VERBAS_ACCOUNT, g['B20']!.amountCents + g['7AB']!.amountCents, 150000, g['B20']!.amountCents + g['7AB']!.amountCents, 0, 'noDifference', 'IDENTIFICADA'],
      [ASSET_ACCOUNT, g['A10']!.amountCents, g['C31']!.amountCents, g['A10']!.amountCents, 0, 'noDifference', 'IDENTIFICADA'],
    ]);
    for (const a of r.accounts) expect(a.findings, a.account).toEqual([]);
  });

  it('net pay: one key per branch × verba P and D, all equal; the ledger side gathers the lines of a key', async () => {
    const f = fixture();
    const r = await analyzed(f);
    const net = acc(r, NET_ACCOUNT);
    const expectedKeys = [...branchAmounts(f.payroll, 'Todos')].flatMap(([branch, amounts]) =>
      Object.entries(amounts)
        .filter(([, a]) => a.column !== 'B' && a.amountCents !== 0)
        .map(([verba, a]) => [branch, verba, a.column === 'P' ? a.amountCents : -a.amountCents]),
    );
    expect(net.integration!.keys.map((k) => [k.branch, k.verba, k.payroll])).toEqual(expect.arrayContaining(expectedKeys));
    expect(net.integration!.keys).toHaveLength(expectedKeys.length);
    expect(net.integration!.keys.every((k) => k.status === 'equal' && k.ledger === k.payroll)).toBe(true);
    // The first key was split by cost center: two lines, one key.
    expect(net.integration!.keys.some((k) => k.lines.length === 2)).toBe(true);
    // D-12: every integration line of the competence is compared and counted, the settlement verbas (C31) included.
    const integrationLines = r.accounts.reduce((n, a) => n + a.lines.filter((l) => l.batchClass === 'integration').length, 0);
    const c31 = [...branchAmounts(f.payroll, 'Todos').values()].filter((x) => (x['C31']?.amountCents ?? 0) !== 0).length;
    expect(r.integration).toEqual({ keys: r.integration.checked, checked: r.integration.checked, divergent: 0, checkedLines: integrationLines, criterionLines: integrationLines - c31 });
    // Movement by class of batch (natural side): payments of the Financeiro and the integration.
    expect(net.movements).toEqual({ integration: net.expected!.amount, financial: -500000, manual: 0, other: 0 });
  });

  it('text of the criterion (7.7), first person, with the settlement of the opening balance', async () => {
    const f = fixture();
    const g = groupAmounts(f.payroll, 'Todos');
    const r = await analyzed(f);
    const total = g['B20']!.amountCents + g['7AB']!.amountCents;
    expect(acc(r, VERBAS_ACCOUNT).narrative).toBe(
      `Fizemos a comparação do saldo da conta com as verbas B20 DESC X (R$ ${brMoney(g['B20']!.amountCents)}) e 7AB BASE Y (R$ ${brMoney(g['7AB']!.amountCents)}) ` +
        `da folha de pagamento de 10/2026 (GPER040, Grupo de Empresas / Todos), que somam R$ ${brMoney(total)}. O saldo final do razão é de R$ ${brMoney(total)} C. ` +
        'Os valores são iguais e não há diferença. O saldo anterior (R$ 1.500,00) foi baixado em 20/10/2026 (1 lançamento).',
    );
    expect(acc(r, NET_ACCOUNT).narrative).toContain(`com a verba X99 LIQUIDO A RECE (R$ ${brMoney(g['X99']!.amountCents)}) da folha de pagamento de 10/2026 (GPER040, Grupo de Empresas / Todos), que soma R$`);
    // Asset (natural side D): the book balance as the ledger prints it, debit.
    expect(acc(r, ASSET_ACCOUNT).narrative).toContain(`O saldo final do razão é de R$ ${brMoney(g['A10']!.amountCents)} D.`);
  });
});

describe('cases of the engine (section 6.2 of the phase)', () => {
  it('`verbas` account without difference: F2 = 0, no F1, "Sem diferença"', async () => {
    const a = acc(await analyzed(fixture()), VERBAS_ACCOUNT);
    expect(a.difference).toBe(0);
    expect(a.integration!.findings).toEqual([]);
    expect(a.situation).toBe('noDifference');
  });

  it('verba integrated with a different value in a branch: F1a on the key verba × branch', async () => {
    const f = fixture(engineCases.differentValue);
    const b20 = branchAmounts(f.payroll, 'Todos').get('02')!['B20']!.amountCents;
    const a = acc(await analyzed(f), VERBAS_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.severity, x.branch, x.verba, x.payroll, x.ledger])).toEqual([['F1a', 'error', '02', 'B20', b20, b20 + 1000]]);
    expect(a.difference).toBe(-1000);
    expect(parcel(a, 'criterion')).toBe(1000);
    expect(a.situation).toBe('integrationError');
    expect(acc(await analyzed(f), NET_ACCOUNT).findings).toEqual([]);
  });

  it('verba of the criterion without integration in a branch: F1c; bridge with "integração − esperado" ≠ 0', async () => {
    const f = fixture(engineCases.missingIntegration);
    const value = branchAmounts(f.payroll, 'Todos').get('01')!['7AB']!.amountCents;
    const a = acc(await analyzed(f), VERBAS_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.severity, x.branch, x.verba, x.payroll])).toEqual([['F1c', 'warning', '01', '7AB', value]]);
    expect(parcel(a, 'criterion')).toBe(-value);
    expect(a.difference).toBe(value);
    expect(codes(a)).toEqual(['F1c', 'F2']);
    expect(a.situation).toBe('differenceExplained');
  });

  it('net pay with a provento posted by hand: 1 F1c, difference 0 (the manual entry compensates), the manual parcel in the bridge', async () => {
    const f = fixture(engineCases.manualProvento);
    const value = branchAmounts(f.payroll, 'Todos').get('02')!['A20']!.amountCents;
    const a = acc(await analyzed(f), NET_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.branch, x.verba, x.payroll])).toEqual([['F1c', '02', 'A20', value]]);
    expect(a.difference).toBe(0);
    expect(parcel(a, 'criterion')).toBe(-value);
    expect(parcel(a, 'movement:manual')).toBe(value);
    expect(a.movements.manual).toBe(value);
    // D-13: difference 0 with an Alert.
    expect(a.situation).toBe('noDifferenceCheckAlerts');
    // The FILIAL DE ORIGEM of the manual entry (01) is not the branch of any rule: FILIAL CTB 02 (D-8).
    expect(a.lines.find((l) => l.batchClass === 'manual')!.ledgerBranch).toBe('02');
  });

  it('integration line of a verba outside the criterion: F1b, in its own parcel; compared with the payroll and counted (D-12)', async () => {
    const f = fixture(engineCases.outsideCriterion);
    const b90 = branchAmounts(f.payroll, 'Todos').get('01')!['B90']!.amountCents;
    const base = await analyzed(fixture());
    const r = await analyzed(f);
    const a = acc(r, VERBAS_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.severity, x.branch, x.verba, x.ledger])).toEqual([['F1b', 'warning', '01', 'B90', b90]]);
    expect(a.integration!.keys.filter((k) => k.role !== 'criterion').map((k) => [k.role, k.branch, k.verba, k.payroll, k.ledger, k.status])).toEqual([['outside', '01', 'B90', b90, b90, 'equal']]);
    expect(parcel(a, 'outside')).toBe(b90);
    expect(a.difference).toBe(-b90);
    expect(a.situation).toBe('differenceExplained');
    expect(r.integration.checkedLines).toBe(base.integration.checkedLines + 1);
    expect(r.integration.criterionLines).toBe(base.integration.criterionLines);
  });

  it('D-12: a line outside the criterion with a value ≠ the payroll is F1b and F1a', async () => {
    const f = fixture(engineCases.outsideCriterionDifferent);
    const b90 = branchAmounts(f.payroll, 'Todos').get('01')!['B90']!.amountCents;
    const r = await analyzed(f);
    const a = acc(r, VERBAS_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.severity, x.branch, x.verba, x.payroll, x.ledger])).toEqual([
      ['F1a', 'error', '01', 'B90', b90, 2500],
      ['F1b', 'warning', '01', 'B90', null, 2500],
    ]);
    expect(parcel(a, 'outside')).toBe(2500);
    expect(a.situation).toBe('integrationError');
    expect(r.integration.divergent).toBe(1);
  });

  it('D-11: natural side D, verba of sign +1 integrated on the other side (credit): equal in absolute value, no F1a; the difference shows it (F2)', async () => {
    const f = fixture(engineCases.oppositeSide);
    const a10 = groupAmounts(f.payroll, 'Todos')['A10']!.amountCents;
    const a = acc(await analyzed(f), ASSET_ACCOUNT);
    const criterion = a.integration!.keys.filter((k) => k.role === 'criterion');
    expect(criterion.length).toBeGreaterThan(0);
    expect(criterion.every((k) => k.verba === 'A10' && k.status === 'equal' && k.ledger === -k.payroll && k.payroll > 0)).toBe(true);
    expect(a.integration!.findings).toEqual([]);
    expect(a.expected!.amount).toBe(a10);
    expect(a.ledgerBalance).toBe(-a10);
    expect(a.difference).toBe(2 * a10);
    expect(parcel(a, 'criterion')).toBe(-2 * a10);
    expect(codes(a)).toEqual(['F2']);
    expect(a.situation).toBe('differenceExplained');
  });

  it('D-12: a settlement-verba line different from the payroll is F1a; the settlement is not found', async () => {
    const f = fixture(engineCases.settlementDifferent);
    const c31 = branchAmounts(f.payroll, 'Todos').get('02')!['C31']!.amountCents;
    const r = await analyzed(f);
    const a = acc(r, ASSET_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.severity, x.branch, x.verba, x.payroll, x.ledger])).toEqual([['F1a', 'error', '02', 'C31', c31, -(c31 + 1000)]]);
    expect(a.integration!.keys.find((k) => k.verba === 'C31' && k.branch === '02')!.role).toBe('settlement');
    expect(a.settlement!.situation).toBe('NAO_IDENTIFICADA');
    expect(a.situation).toBe('integrationError');
    expect(r.integration.divergent).toBe(1);
  });

  it('opening paid in 3 entries with a payment of the month between their dates: F3 IDENTIFICADA with the 3; the other in the 5th parcel', async () => {
    const a = acc(await analyzed(fixture(engineCases.settledInThree)), VERBAS_ACCOUNT);
    expect(a.settlement!.situation).toBe('IDENTIFICADA');
    expect(a.settlement!.settled.map((i) => [a.lines[i]!.date, a.amounts[i]])).toEqual([
      [day('06/10/2026'), -40000],
      [day('10/10/2026'), -35000],
      [day('12/10/2026'), -25000],
    ]);
    expect(parcel(a, 'opening')).toBe(0);
    expect(parcel(a, 'movement:financial')).toBe(-12345);
    expect(a.difference).toBe(12345);
    expect(a.situation).toBe('differenceExplained');
    expect(a.narrative).toContain('A diferença de R$ 123,45 é composta por: demais movimentos da competência: Financeiro (R$ -123,45).');
    expect(a.narrative).toContain('O saldo anterior (R$ 1.000,00) foi baixado em 06/10/2026, 10/10/2026 e 12/10/2026 (3 lançamentos).');
  });

  it('opening partly paid: F3 NAO_IDENTIFICADA; 4th parcel = the whole opening; the bridge closes', async () => {
    const a = acc(await analyzed(fixture(engineCases.partlyPaid)), VERBAS_ACCOUNT);
    expect(a.settlement!.situation).toBe('NAO_IDENTIFICADA');
    expect(parcel(a, 'opening')).toBe(100000);
    expect(parcel(a, 'movement:financial')).toBe(-60000);
    expect(a.difference).toBe(-40000);
    expect(codes(a)).toEqual(['F2', 'F3']);
    expect(a.findings.find((x) => x.code === 'F3')!.severity).toBe('info');
    expect(a.situation).toBe('differenceToCheck');
  });

  it('two tied combinations: F3 IDENTIFICADA_AMBIGUA, the choice by the tie-break', async () => {
    const a = acc(await analyzed(fixture(engineCases.tiedCombinations)), VERBAS_ACCOUNT);
    expect(a.settlement!.situation).toBe('IDENTIFICADA_AMBIGUA');
    const payments = a.lines.flatMap((l, i) => (l.batchClass === 'financial' ? [i] : []));
    expect(a.settlement!.settled).toEqual([payments[0], payments[1]]);
    expect(a.settlement!.runnerUp).toEqual([payments[0], payments[2]]);
    expect(parcel(a, 'opening')).toBe(0);
    expect(parcel(a, 'movement:financial')).toBe(-70000);
  });

  it('41 candidates: F3 NAO_PESQUISADA (the list is not truncated)', async () => {
    const a = acc(await analyzed(fixture(engineCases.tooManyCandidates)), VERBAS_ACCOUNT);
    expect(a.settlement!.situation).toBe('NAO_PESQUISADA');
    expect(a.settlement!.candidates).toHaveLength(41);
    expect(parcel(a, 'opening')).toBe(100000);
  });

  it('asset account (natural side D) with settlementVerbas: the settlement is found among the integration lines of those verbas', async () => {
    const f = fixture();
    const a = acc(await analyzed(f), ASSET_ACCOUNT);
    expect(a.naturalSide).toBe('D');
    expect(a.competenceOpening).toBe(groupAmounts(f.payroll, 'Todos')['C31']!.amountCents);
    expect(a.settlement!.situation).toBe('IDENTIFICADA');
    expect(a.settlement!.settled.map((i) => [a.lines[i]!.batchClass, a.lines[i]!.verba])).toEqual([
      ['integration', 'C31'],
      ['integration', 'C31'],
    ]);
    // The settlement verbas are not F1b; their lines are in the 4th parcel, none in the 3rd.
    expect(a.findings).toEqual([]);
    // D-12: compared with the payroll of the branch, in absolute value (the credit is negative in the natural side D).
    const settlementKeys = a.integration!.keys.filter((k) => k.role === 'settlement');
    expect(settlementKeys.map((k) => [k.branch, k.verba, k.status])).toEqual([
      ['01', 'C31', 'equal'],
      ['02', 'C31', 'equal'],
    ]);
    expect(settlementKeys.every((k) => k.ledger === -k.payroll)).toBe(true);
    expect(parcel(a, 'outside')).toBe(0);
    expect(a.bridge!.parcels.find((p) => p.id === 'opening')!.lines).toEqual(a.settlement!.settled);
    // Signed in the natural side: the advance (debit) increases, the settlement (credit) reduces.
    expect(a.amounts.filter((x) => x < 0)).toHaveLength(2);
  });

  it('opening balance zero: F3 SEM_SALDO_ANTERIOR', async () => {
    const a = acc(await analyzed(fixture(engineCases.zeroOpening)), VERBAS_ACCOUNT);
    expect(a.settlement!.situation).toBe('SEM_SALDO_ANTERIOR');
    expect(a.competenceOpening).toBe(0);
    expect(a.difference).toBe(0);
    expect(a.situation).toBe('noDifference');
  });

  it('payroll integration in pre-entry (9) and the opening in real (1): F1, F3 and bridge as with everything in real; T2 with the part in 9', async () => {
    const f = fixture(engineCases.settledInThree);
    const whole = await analyzed(f);
    const split = await analyzed(f, { split: true });
    const same = (r: PayrollAnalysis) =>
      r.accounts.map((a) => ({
        account: a.account,
        expected: a.expected,
        opening: a.competenceOpening,
        balance: a.ledgerBalance,
        difference: a.difference,
        integration: a.integration!.findings,
        keys: a.integration!.keys.map((k) => [k.branch, k.verba, k.payroll, k.ledger, k.status, k.lines.map((i) => a.lines[i]!.key)]),
        settlement: [a.settlement!.situation, a.settlement!.settled.map((i) => [a.lines[i]!.date, a.lines[i]!.key])],
        bridge: a.bridge!.parcels.map((p) => [p.id, p.amount, p.lines.map((i) => [a.lines[i]!.date, a.lines[i]!.key])]),
        situation: a.situation,
        narrative: a.narrative,
      }));
    expect(same(split)).toEqual(same(whole));
    for (const a of split.accounts) {
      expect(a.findings.filter((x) => x.code === 'T2'), a.account).toHaveLength(1);
      expect(a.balanceByType['1']! + a.balanceByType['9']!).toBe(a.ledgerBalance);
      for (const p of a.bridge!.parcels) expect(Object.keys(p.byType).every((t) => t === '9'), `${a.account} ${p.id}`).toBe(true);
    }
    expect(acc(split, VERBAS_ACCOUNT).balanceByType).toEqual({ '1': 100000, '9': acc(split, VERBAS_ACCOUNT).ledgerBalance - 100000 });
  });
});

describe('the other F1 findings and the invariants CC-1 and CC-4', () => {
  it('F1d: integration line without a verba (not compared); F1e: verba of column B in the net pay account (compared, D-12)', async () => {
    const f = fixture(engineCases.unrecognizedAndBase);
    const x99 = branchAmounts(f.payroll, 'Todos').get('02')!['X99']!.amountCents;
    const base = await analyzed(fixture());
    const r = await analyzed(f);
    const a = acc(r, NET_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.severity, x.branch, x.verba, x.ledger])).toEqual([
      ['F1d', 'warning', '01', null, 99],
      ['F1e', 'info', '02', 'X99', -x99],
    ]);
    expect(a.integration!.keys.filter((k) => k.role !== 'criterion').map((k) => [k.role, k.branch, k.verba, k.payroll, k.ledger, k.status])).toEqual([['outside', '02', 'X99', x99, -x99, 'equal']]);
    // F1d stays in the 5th parcel (class integration); F1e in the 3rd (a verba outside the criterion).
    expect(parcel(a, 'movement:integration')).toBe(99);
    expect(parcel(a, 'outside')).toBe(-x99);
    expect(a.difference).toBe(x99 - 99);
    // The F1e line is counted; the F1d line has no key and is not.
    expect(r.integration.checkedLines).toBe(base.integration.checkedLines + 1);
  });

  it('D-12: in the net pay account, a column B line with a value ≠ the payroll is F1e and F1a', async () => {
    const f = fixture((x) => accountOf(x, NET_ACCOUNT).entries.push({ date: '31/10/2026', key: '000777001000009002', history: 'X99 LIQUIDO A RECE 10/2026', ledgerBranch: '02', debit: 1 }));
    const x99 = branchAmounts(f.payroll, 'Todos').get('02')!['X99']!.amountCents;
    const a = acc(await analyzed(f), NET_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.severity, x.branch, x.verba, x.payroll, x.ledger])).toEqual([
      ['F1a', 'error', '02', 'X99', x99, -1],
      ['F1e', 'info', '02', 'X99', null, -1],
    ]);
    expect(a.situation).toBe('integrationError');
  });

  it('a key only in the ledger is compared with a payroll of zero (F1a)', async () => {
    const f = fixture((x) => {
      const [line] = integrationOf(accountOf(x, VERBAS_ACCOUNT), 'B20', '01');
      accountOf(x, VERBAS_ACCOUNT).entries.push({ ...line!, key: line!.key.replace(/\d{3}$/, '777'), ledgerBranch: '03', credit: 500 });
    });
    const a = acc(await analyzed(f), VERBAS_ACCOUNT);
    expect(a.integration!.findings.map((x) => [x.code, x.branch, x.verba, x.payroll, x.ledger])).toEqual([['F1a', '03', 'B20', 0, 500]]);
  });

  it('CC-1: an account of the profile not in the ledger is out of the analysis (warning); a Padrão B account is not analyzed', async () => {
    const f = fixture();
    const provision = provisionProfileFile();
    f.profile = { ...provision, accounts: [...provision.accounts, { ...provision.accounts[1]!, account: '9.9.1.0.99.01', tickMark: '#09' } as (typeof provision.accounts)[number]] };
    const r = await run(f);
    expect(r.accounts.map((a) => [a.account, a.status, a.reason])).toEqual([
      [NET_ACCOUNT, 'analyzed', null],
      [VERBAS_ACCOUNT, 'analyzed', null],
      [ASSET_ACCOUNT, 'analyzed', null],
      ['9.9.1.0.30.01', 'notAnalyzed', 'não analisada — falta GPER070'],
      ['9.9.1.0.99.01', 'notInLedger', 'conta fora da análise — não está no razão (CC-1)'],
    ]);
    const cc1 = r.checks.find((c) => c.id === 'CC-1')!;
    expect(cc1).toMatchObject({ passed: false, severity: 'warning', message: 'Fora da análise, sem razão: 9.9.1.0.99.01.' });
    expect(r.checks.filter((c) => c.id !== 'CC-1').every((c) => c.passed)).toBe(true);
  });

  it('the column of a verba in the profile is conferred with the report', async () => {
    const f = fixture((x) => {
      const a = x.profile.accounts.find((y) => y.account === VERBAS_ACCOUNT)!;
      if (a.mode === 'verbas') a.verbas = a.verbas.map((v) => (v.code === '7AB' ? { ...v, column: 'P' } : v));
    });
    const a = acc(await run(f), VERBAS_ACCOUNT);
    expect(a.expected!.verbas.map((v) => [v.code, v.column, v.configuredColumn, v.columnMatches])).toEqual([
      ['B20', 'D', 'D', true],
      ['7AB', 'B', 'P', false],
    ]);
  });
});

describe('suggested situation (7.6, D-13)', () => {
  const settlement = 'IDENTIFICADA' as const;
  const finding = (code: AccountFinding['code'], severity: AccountFinding['severity']): AccountFinding => ({ code, severity, account: VERBAS_ACCOUNT, message: '' });

  it('difference 0: "Sem diferença" without Erro or Alerta (an Informativo does not count); "Sem diferença — conferir alertas" with an Alerta', () => {
    expect(suggestedSituation(0, [], settlement)).toBe('noDifference');
    expect(suggestedSituation(0, [finding('F3', 'info'), finding('F1e', 'info'), finding('T2', 'info')], 'NAO_IDENTIFICADA')).toBe('noDifference');
    expect(suggestedSituation(0, [finding('F1c', 'warning')], settlement)).toBe('noDifferenceCheckAlerts');
    expect(suggestedSituation(0, [finding('T1', 'warning'), finding('F3', 'info')], settlement)).toBe('noDifferenceCheckAlerts');
    expect(SUGGESTED_SITUATION_LABELS.noDifferenceCheckAlerts).toBe('Sem diferença — conferir alertas');
  });

  it('any F1a is "Erro de integração", with or without difference; the other rows of the table as before', () => {
    expect(suggestedSituation(0, [finding('F1a', 'error'), finding('F1b', 'warning')], settlement)).toBe('integrationError');
    expect(suggestedSituation(100, [finding('F1a', 'error')], settlement)).toBe('integrationError');
    expect(suggestedSituation(100, [finding('F2', 'warning')], settlement)).toBe('differenceExplained');
    expect(suggestedSituation(100, [finding('F2', 'warning')], 'NAO_IDENTIFICADA')).toBe('differenceToCheck');
  });
});
