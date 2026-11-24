/**
 * Synthetic payroll and ledger coherent with each other (docs/FASE_15_CONCILIADOR_FOLHA.md, sections 6.1 and 6.2): the
 * ledger of every Padrão A account of the synthetic profile is derived from the payroll description
 * (tests/synthetic/payrollFixture.ts) and the profile (tests/synthetic/reconciliationProfile.ts): one integration line
 * per branch × verba of the criterion, signed in the account's natural side (the first key split by cost center), an
 * opening balance built in the previous month and paid in the competence. The base has no difference in any account;
 * the cases of the table of 6.2 change it (`engineCases`). Invented codes and values only.
 */
import type { PayrollProfileFile } from '../../src/config/reconciliationSchema';
import type { FixtureAccount, FixtureEntry, LedgerFixture } from './ledgerFixture';
import { payrollSpool, type FixtureAmounts, type PayrollFixture } from './payrollFixture';
import { payrollProfileFile } from './reconciliationProfile';

/** Batch prefixes of the synthetic profile: integration and Financeiro; manual batches are ddmmaa. */
export const INTEGRATION_BATCH = '000777';
export const FINANCIAL_BATCH = '000888';
export const MANUAL_BATCH = '201026';

export const NET_ACCOUNT = '9.9.1.0.10.01';
export const VERBAS_ACCOUNT = '9.9.1.0.10.02';
export const ASSET_ACCOUNT = '9.9.1.0.20.01';

export interface EngineFixture {
  payroll: PayrollFixture;
  profile: PayrollProfileFile;
  ledger: LedgerFixture;
}

type Account = PayrollProfileFile['accounts'][number];

/** Branch × verba of the payroll (branch blocks of the contract of the scope), from the totals of the fixture. */
export function branchAmounts(payroll: PayrollFixture, contractType: string): Map<string, FixtureAmounts> {
  const out = new Map<string, FixtureAmounts>();
  for (const s of payroll.totals.scopes) if (s.level === 'branch' && s.contractType === contractType) out.set(s.branch!, s.amounts);
  return out;
}

export function groupAmounts(payroll: PayrollFixture, contractType: string): FixtureAmounts {
  return payroll.totals.scopes.find((s) => s.level === 'groupOfCompanies' && s.contractType === contractType)!.amounts;
}

/** A natural-side amount as debit or credit. */
export function sided(naturalSide: 'D' | 'C', natural: number): { debit?: number; credit?: number } {
  const credit = naturalSide === 'C' ? natural : -natural;
  return credit >= 0 ? { credit } : { debit: -credit };
}

/** A key of 18 digits: batch 6 + sub-batch 3 + document 6 + line 3 (the same numbers repeat between months). */
export function key(batch: string, document: number, line: number): string {
  return `${batch}001${String(document).padStart(6, '0')}${String(line).padStart(3, '0')}`;
}

/** The integration lines of the criterion of an account, from the payroll (one per branch × verba; the first split in two cost centers). */
function integrationEntries(account: Account, payroll: PayrollFixture, contractType: string, date: string, month: string): FixtureEntry[] {
  const description = (code: string) => payroll.description.verbas.find((v) => v.code === code)?.description ?? 'VERBA';
  const out: FixtureEntry[] = [];
  let line = 0;
  for (const [branch, amounts] of [...branchAmounts(payroll, contractType)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const keys: { code: string; natural: number }[] =
      account.mode === 'verbas'
        ? account.verbas.map((v) => ({ code: v.code, natural: v.sign * (amounts[v.code]?.amountCents ?? 0) }))
        : Object.entries(amounts)
            .filter(([, a]) => a.column === 'P' || a.column === 'D')
            .map(([code, a]) => ({ code, natural: a.column === 'P' ? a.amountCents : -a.amountCents }));
    for (const k of keys) {
      if (k.natural === 0) continue;
      const history = `${k.code} ${description(k.code)} ${month}`;
      if (out.length === 0) {
        // The first key in two lines (cost centers): the ledger side of a key may gather several lines.
        const part = Math.trunc(k.natural / 3);
        out.push({ date, key: key(INTEGRATION_BATCH, 1, ++line), history, ledgerBranch: branch, costCenter: '9101', ...sided(account.naturalSide, part) });
        out.push({ date, key: key(INTEGRATION_BATCH, 1, ++line), history, ledgerBranch: branch, costCenter: '9102', ...sided(account.naturalSide, k.natural - part) });
      } else out.push({ date, key: key(INTEGRATION_BATCH, 1, ++line), history, ledgerBranch: branch, ...sided(account.naturalSide, k.natural) });
    }
  }
  return out;
}

const byDate = (a: FixtureEntry, b: FixtureEntry) => {
  const day = (s: string) => s.split('/').reverse().join('');
  return day(a.date) < day(b.date) ? -1 : day(a.date) > day(b.date) ? 1 : 0;
};

/** Sorts the entries of every account by date (stable: the order within a day is kept). */
export function sortEntries(f: LedgerFixture): void {
  for (const a of f.accounts) a.entries.sort(byDate);
}

/**
 * The base: September 2026 (before the competence) builds the opening balance of October in every account, October
 * pays it and integrates the payroll of October. Without difference in any account:
 * - net pay (C): report opening 4.000,00 paid on 04/09; 5.000,00 integrated on 30/09 and paid in October in two
 *   payments of the Financeiro (one with FILIAL DE ORIGEM ≠ FILIAL CTB); integration of every P and D verba;
 * - verbas (C, B20 + 7AB): 1.500,00 integrated on 30/09 and paid on 20/10;
 * - asset (D, A10, settlement by C31): the advance of September (Financeiro, debit) = Σ C31 of the payroll, settled
 *   by the C31 integration of October.
 */
export function engineFixture(): EngineFixture {
  const payroll = payrollSpool();
  const profile = payrollProfileFile();
  const contract = profile.payrollReport.scope.contractType;
  const group = groupAmounts(payroll, contract);
  const integrated = (code: string) => integrationEntries(profile.accounts.find((a) => a.account === code)!, payroll, contract, '31/10/2026', '10/2026');
  const fin = (date: string, document: number, history: string, ledgerBranch: string, amounts: { debit?: number; credit?: number }, more: Partial<FixtureEntry> = {}): FixtureEntry => ({
    date,
    key: key(FINANCIAL_BATCH, document, 1),
    history,
    ledgerBranch,
    ...amounts,
    ...more,
  });
  const accounts: FixtureAccount[] = [
    {
      code: NET_ACCOUNT,
      description: 'ORDENADOS A PAGAR SINTETICA',
      group: { code: '9.9.1.0.1', description: 'OBRIGACOES SINTETICAS' },
      opening: 400000,
      entries: [
        fin('04/09/2026', 1, 'PAG FOLHA 08/2026', '01', { debit: 400000 }),
        { date: '30/09/2026', key: key(INTEGRATION_BATCH, 1, 1), history: 'A10 SALARIO 09/2026', ledgerBranch: '01', credit: 500000 },
        fin('06/10/2026', 1, 'PAG FOLHA 09/2026 FIL 01', '01', { debit: 300000 }),
        fin('06/10/2026', 2, 'PAG FOLHA 09/2026 FIL 02', '02', { debit: 200000 }, { originBranch: '01' }),
        ...integrated(NET_ACCOUNT),
      ],
    },
    {
      code: VERBAS_ACCOUNT,
      description: 'CONTRIBUICAO A RECOLHER SINTETICA',
      group: { code: '9.9.1.0.1', description: 'OBRIGACOES SINTETICAS' },
      opening: 0,
      entries: [
        { date: '30/09/2026', key: key(INTEGRATION_BATCH, 2, 1), history: 'B20 DESC X 09/2026', ledgerBranch: '01', credit: 150000 },
        fin('20/10/2026', 3, 'PAG CONTRIBUICAO 09/2026', '01', { debit: 150000 }),
        ...integrated(VERBAS_ACCOUNT),
      ],
    },
    {
      code: ASSET_ACCOUNT,
      description: 'ADIANTAMENTOS SINTETICA',
      group: { code: '9.9.1.0.2', description: 'ADIANTAMENTOS SINTETICOS' },
      opening: 0,
      entries: [fin('15/09/2026', 4, 'ADIANTAMENTO 10/2026', '01', { debit: group['C31']!.amountCents }), ...integrated(ASSET_ACCOUNT), ...settlementEntries(payroll, contract)],
    },
  ];
  const ledger: LedgerFixture = { from: '01/09/2026', to: '31/10/2026', currency: '01', balanceType: '1', accounts };
  sortEntries(ledger);
  return { payroll, profile, ledger };
}

/** The C31 integration of October in the asset account: one credit per branch (reduces the debit balance). */
function settlementEntries(payroll: PayrollFixture, contract: string): FixtureEntry[] {
  return [...branchAmounts(payroll, contract)]
    .filter(([, a]) => (a['C31']?.amountCents ?? 0) !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([branch, a], i) => ({ date: '31/10/2026', key: key(INTEGRATION_BATCH, 3, i + 1), history: 'C31 ADIANTAMENTO 10/2026', ledgerBranch: branch, credit: a['C31']!.amountCents }));
}

export function accountOf(f: EngineFixture, code: string): FixtureAccount {
  return f.ledger.accounts.find((a) => a.code === code)!;
}

/** Entries of an account whose history starts with the verba and whose branch is `branch`. */
export function integrationOf(a: FixtureAccount, verba: string, branch: string): FixtureEntry[] {
  return a.entries.filter((e) => e.key.startsWith(INTEGRATION_BATCH) && e.date.endsWith('/10/2026') && e.history.startsWith(`${verba} `) && e.ledgerBranch === branch);
}

/** Replaces the opening of the competence (September) and the payments of October of the verbas account. */
function verbasOpening(f: EngineFixture, opening: number, payments: { date: string; amount: number }[]): void {
  const a = accountOf(f, VERBAS_ACCOUNT);
  a.entries = a.entries.filter((e) => e.date.endsWith('/10/2026') && e.key.startsWith(INTEGRATION_BATCH));
  if (opening !== 0) a.entries.push({ date: '30/09/2026', key: key(INTEGRATION_BATCH, 2, 1), history: 'B20 DESC X 09/2026', ledgerBranch: '01', credit: opening });
  payments.forEach((p, i) => a.entries.push({ date: p.date, key: key(FINANCIAL_BATCH, 10 + i, 1), history: `PAG CONTRIBUICAO ${i + 1}`, ledgerBranch: '01', debit: p.amount }));
  sortEntries(f.ledger);
}

/** The cases of the table of section 6.2 (each a change of the base). */
export const engineCases = {
  /** F1a: B20 of branch 02 integrated with 10,00 more. */
  differentValue(f: EngineFixture): void {
    const e = integrationOf(accountOf(f, VERBAS_ACCOUNT), 'B20', '02')[0]!;
    e.credit = e.credit! + 1000;
  },
  /** F1c: 7AB of branch 01 without integration. */
  missingIntegration(f: EngineFixture): void {
    const a = accountOf(f, VERBAS_ACCOUNT);
    const gone = new Set(integrationOf(a, '7AB', '01'));
    a.entries = a.entries.filter((e) => !gone.has(e));
  },
  /** netPay: A20 (provento) of branch 02 posted by hand instead of integrated, FILIAL DE ORIGEM 01. */
  manualProvento(f: EngineFixture): void {
    const a = accountOf(f, NET_ACCOUNT);
    const [line] = integrationOf(a, 'A20', '02');
    a.entries = a.entries.filter((e) => e !== line);
    a.entries.push({ date: '31/10/2026', key: key(MANUAL_BATCH, 1, 1), history: 'AJUSTE ADICIONAL Y 10/2026', ledgerBranch: '02', originBranch: '01', counterpart: '9.9.5.0.10.01', credit: line!.credit! });
    sortEntries(f.ledger);
  },
  /** F1b: an integration line of a verba outside the criterion (B90) in the verbas account, equal to the payroll's B90 of branch 01 (D-12). */
  outsideCriterion(f: EngineFixture): void {
    const b90 = branchAmounts(f.payroll, f.profile.payrollReport.scope.contractType).get('01')!['B90']!.amountCents;
    accountOf(f, VERBAS_ACCOUNT).entries.push({ date: '31/10/2026', key: key(INTEGRATION_BATCH, 2, 90), history: 'B90 SALARIO DO MES 10/2026', ledgerBranch: '01', credit: b90 });
  },
  /** F1b and F1a: the B90 line of branch 01 with 25,00, not the payroll's value (D-12). */
  outsideCriterionDifferent(f: EngineFixture): void {
    accountOf(f, VERBAS_ACCOUNT).entries.push({ date: '31/10/2026', key: key(INTEGRATION_BATCH, 2, 90), history: 'B90 SALARIO DO MES 10/2026', ledgerBranch: '01', credit: 2500 });
  },
  /** D-11: every A10 line of the asset account (natural side D, sign +1) integrated on the other side (credit). */
  oppositeSide(f: EngineFixture): void {
    for (const e of accountOf(f, ASSET_ACCOUNT).entries.filter((x) => x.key.startsWith(INTEGRATION_BATCH) && x.history.startsWith('A10 '))) {
      e.credit = e.debit!;
      delete e.debit;
    }
  },
  /** D-12: the C31 line (a settlement verba) of branch 02 in the asset account with 10,00 more than the payroll. */
  settlementDifferent(f: EngineFixture): void {
    const e = integrationOf(accountOf(f, ASSET_ACCOUNT), 'C31', '02')[0]!;
    e.credit = e.credit! + 1000;
  },
  /** Opening 1.000,00 paid in 3 payments; a payment of the month (123,45) between their dates. */
  settledInThree(f: EngineFixture): void {
    verbasOpening(f, 100000, [
      { date: '06/10/2026', amount: 40000 },
      { date: '08/10/2026', amount: 12345 },
      { date: '10/10/2026', amount: 35000 },
      { date: '12/10/2026', amount: 25000 },
    ]);
  },
  /** Opening 1.000,00, only 600,00 paid. */
  partlyPaid(f: EngineFixture): void {
    verbasOpening(f, 100000, [{ date: '06/10/2026', amount: 60000 }]);
  },
  /** Opening 1.000,00 and two combinations of 2 payments on the same date: 300 + 700 (two of 700). */
  tiedCombinations(f: EngineFixture): void {
    verbasOpening(f, 100000, [
      { date: '06/10/2026', amount: 30000 },
      { date: '06/10/2026', amount: 70000 },
      { date: '06/10/2026', amount: 70000 },
    ]);
  },
  /** 41 candidates (payments of 10,00): more than maxCandidates (40). */
  tooManyCandidates(f: EngineFixture): void {
    verbasOpening(
      f,
      100000,
      Array.from({ length: 41 }, (_, i) => ({ date: `${String(1 + (i % 28)).padStart(2, '0')}/10/2026`, amount: 1000 })),
    );
  },
  /** No opening balance and nothing to pay. */
  zeroOpening(f: EngineFixture): void {
    verbasOpening(f, 0, []);
  },
  /**
   * An integration line without a verba in the history (F1d) and an X99 line (column B) in the net pay account (F1e),
   * a debit equal in absolute value to the payroll's X99 of branch 02 (D-12: compared, no F1a).
   */
  unrecognizedAndBase(f: EngineFixture): void {
    const a = accountOf(f, NET_ACCOUNT);
    const x99 = branchAmounts(f.payroll, f.profile.payrollReport.scope.contractType).get('02')!['X99']!.amountCents;
    a.entries.push({ date: '31/10/2026', key: key(INTEGRATION_BATCH, 9, 1), history: 'INTEGRACAO SEM VERBA', ledgerBranch: '01', credit: 99 });
    a.entries.push({ date: '31/10/2026', key: key(INTEGRATION_BATCH, 9, 2), history: 'X99 LIQUIDO A RECE 10/2026', ledgerBranch: '02', debit: x99 });
  },
} satisfies Record<string, (f: EngineFixture) => void>;

/** The same ledger in two extractions with the same interval (5.7): September in real (1), October in pre-entry (9). */
export function splitByType(f: LedgerFixture): { real: LedgerFixture; preEntry: LedgerFixture } {
  const october = (e: FixtureEntry) => e.date.endsWith('/10/2026');
  return {
    real: { ...f, accounts: f.accounts.map((a) => ({ ...a, entries: a.entries.filter((e) => !october(e)) })) },
    preEntry: { ...f, balanceType: '9', accounts: f.accounts.map((a) => ({ ...a, opening: 0, entries: a.entries.filter(october) })) },
  };
}
