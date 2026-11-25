/**
 * Expected value of a Padrão A account (docs/REGRAS_CONCILIADOR.md, 7.1; F2), from the block of the scope of the
 * profile (`payrollReport.scope`; real: Grupo de Empresas / Todos), and the branch blocks of the same contract type,
 * which the integration check (7.2) compares with the ledger.
 */
import type { PayrollAccount, PayrollProfileConfig } from '../../../../../config/reconciliationSchema';
import type { PayrollColumn } from '../../../../../shared/modules/reconciliation';
import { findScope, type PayrollAmounts, type PayrollReport, type PayrollScope } from '../../reports/gper040';

/** The accounts of Padrão A (section 7); `provision` is Padrão B (section 8, Phase 16). */
export type PatternAAccount = Extract<PayrollAccount, { mode: 'verbas' | 'netPay' }>;

export interface PayrollScopes {
  /** Block of `payrollReport.scope`; null when the file does not print it. */
  scope: PayrollScope | null;
  /**
   * Branch blocks of the contract type of the scope, by branch code. A branch printed by more than one company is the
   * sum of its blocks (the ledger knows only the FILIAL CTB code); a block repeated by the file counts once.
   */
  branches: Map<string, PayrollAmounts>;
}

export function payrollScopes(report: PayrollReport, scope: PayrollProfileConfig['payrollReport']['scope']): PayrollScopes {
  const branches = new Map<string, PayrollAmounts>();
  const seen = new Set<string>();
  for (const s of report.scopes) {
    if (s.level !== 'branch' || s.contractType !== scope.contractType || s.branch === null) continue;
    const id = `${s.company}|${s.branch}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const into = branches.get(s.branch) ?? new Map();
    for (const [code, a] of s.amounts) {
      const known = into.get(code);
      into.set(code, known ? { column: known.column, amountCents: known.amountCents + a.amountCents } : { ...a });
    }
    branches.set(s.branch, into);
  }
  return { scope: findScope(report, scope.level, scope.contractType), branches };
}

export interface ExpectedVerba {
  code: string;
  description: string;
  /** Column of the verba in the report (L-6: one only); null when the report does not have it. */
  column: PayrollColumn | null;
  /** Column the profile gives for it, when it gives one (conferred: `columnMatches`). */
  configuredColumn: PayrollColumn | null;
  columnMatches: boolean;
  sign: 1 | -1;
  /** Value in the scope, as printed (0 when the scope does not have the verba). */
  amount: number;
  /** sign × amount. */
  contribution: number;
}

export interface ExpectedResult {
  /** Σ contributions: `verbas` = Σ sign × valor; `netPay` = valor(netPayCode). */
  amount: number;
  verbas: ExpectedVerba[];
}

export function expectedOf(account: PatternAAccount, report: PayrollReport, scope: PayrollScope): ExpectedResult {
  const entries = account.mode === 'verbas' ? account.verbas.map((v) => ({ code: v.code, sign: v.sign, column: v.column ?? null })) : [{ code: account.netPayCode, sign: 1 as const, column: null }];
  const verbas = entries.map((v): ExpectedVerba => {
    const amount = scope.amounts.get(v.code)?.amountCents ?? 0;
    const column = report.columnOf.get(v.code) ?? null;
    return {
      code: v.code,
      description: report.descriptions.get(v.code) ?? '',
      column,
      configuredColumn: v.column,
      columnMatches: v.column === null || column === null || v.column === column,
      sign: v.sign,
      amount,
      contribution: v.sign * amount,
    };
  });
  return { amount: verbas.reduce((s, v) => s + v.contribution, 0), verbas };
}
