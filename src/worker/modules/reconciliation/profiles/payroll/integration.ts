/**
 * Integration × payroll (docs/REGRAS_CONCILIADOR.md, 7.2; F1a–F1e), by exact key (branch, verba): the branch is the
 * FILIAL CTB of the ledger (D-8) and the code of the branch block of the payroll. The ledger side of a key is the sum,
 * in the account's natural side, of the integration lines of the competence with that branch and verba (several lines,
 * e.g. by cost center, make one key). Every integration line with a recognized verba is compared, of the criterion,
 * of `settlementVerbas` or of any other verba (D-12), and the comparison is in absolute value (D-11: F1 does not judge
 * the side; a line on the other side shows in the difference of the account, F2). Every amount here is signed in the
 * account's natural side (error 5 of the phase); only the comparison takes the absolute values.
 */
import { formatCents } from '../../../../../shared/format';
import type { PayrollColumn } from '../../../../../shared/modules/reconciliation';
import { matchByKey } from '../../match/exactKey';
import type { MatchItem } from '../../match/item';
import type { PayrollAmounts } from '../../reports/gper040';
import type { PatternAAccount } from './expected';

/** An integration line of the competence in the account: `index` in the account's lines, amount in the natural side. */
export interface IntegrationLine {
  index: number;
  date: number;
  key: string;
  branch: string;
  /** Verba of the history (`verbaFromHistory`); null = not recognizable (F1d). */
  verba: string | null;
  amount: number;
}

/**
 * Role of a key: `criterion` (verbas of the account, or every P and D verba in `netPay`), `settlement`
 * (`settlementVerbas`) or `outside` (any other recognized verba: F1b, or F1e for column B in `netPay`).
 */
export type IntegrationKeyRole = 'criterion' | 'settlement' | 'outside';

/**
 * A key (branch, verba). Keys of the criterion come from the payroll and from the ledger; the others only from the
 * ledger (D-12: every integration line with a verba is compared). `equal`/`different`: lines in the ledger, compared in
 * absolute value (D-11: |ledger| against |payroll|; a key only in the ledger compares with a payroll of zero);
 * `missing`: verba of the criterion ≠ 0 in the payroll without a line (F1c); `zero`: the verba of the criterion is
 * printed with zero in the branch and has no line (nothing to compare).
 */
export interface IntegrationKey {
  branch: string;
  verba: string;
  column: PayrollColumn | null;
  role: IntegrationKeyRole;
  /** `criterion`: signed (`verbas`: sign × valor; `netPay`: +P / −D); otherwise the value as printed in the branch (0 when absent). */
  payroll: number;
  /** Σ of the lines of the key, in the natural side. */
  ledger: number;
  lines: number[];
  status: 'equal' | 'different' | 'missing' | 'zero';
}

export type IntegrationFindingCode = 'F1a' | 'F1b' | 'F1c' | 'F1d' | 'F1e';

export interface IntegrationFinding {
  code: IntegrationFindingCode;
  severity: 'error' | 'warning' | 'info';
  branch: string;
  verba: string | null;
  /** Payroll side (F1a, F1c); null when it does not apply. */
  payroll: number | null;
  /** Ledger side (F1a, F1b, F1d, F1e); null for F1c. */
  ledger: number | null;
  lines: number[];
  message: string;
}

export interface IntegrationResult {
  keys: IntegrationKey[];
  findings: IntegrationFinding[];
  /** Integration lines of verbas of the criterion (the 2nd parcel of the bridge). */
  criterionLines: number[];
  /** Integration lines of a recognized verba outside the criterion: F1b, F1e and the settlement verbas (3rd parcel). */
  outsideLines: number[];
  /** Integration lines without a recognizable verba (F1d): the only ones not compared with the payroll. */
  unrecognizedLines: number[];
  /**
   * CC-4: Σ of the payroll side of the keys of the criterion (signed: = expected); Σ of the ledger side of every key;
   * Σ of the compared lines (every integration line with a recognized verba, D-12) counted on their own.
   */
  payrollTotal: number;
  ledgerTotal: number;
  checkedLinesTotal: number;
}

const SEP = '\u0000';

export function checkIntegration(account: PatternAAccount, lines: readonly IntegrationLine[], branches: ReadonlyMap<string, PayrollAmounts>, columnOf: ReadonlyMap<string, PayrollColumn>): IntegrationResult {
  const signOf = new Map(account.mode === 'verbas' ? account.verbas.map((v) => [v.code, v.sign] as const) : []);
  const settlement = new Set(account.mode === 'verbas' ? (account.settlementVerbas ?? []) : []);
  const inCriterion = (verba: string) => (account.mode === 'verbas' ? signOf.has(verba) : columnOf.get(verba) === 'P' || columnOf.get(verba) === 'D');
  const roleOf = (verba: string): IntegrationKeyRole => (inCriterion(verba) ? 'criterion' : settlement.has(verba) ? 'settlement' : 'outside');

  // Payroll side of the criterion: per branch, the verbas of the criterion printed in its block (F1c when no line).
  const payrollItems: MatchItem[] = [];
  for (const [branch, amounts] of branches) {
    for (const [verba, a] of amounts) {
      if (!inCriterion(verba)) continue;
      const signed = account.mode === 'verbas' ? signOf.get(verba)! * a.amountCents : a.column === 'P' ? a.amountCents : -a.amountCents;
      payrollItems.push({ key: `${branch}${SEP}${verba}`, amount: signed, date: 0, index: payrollItems.length });
    }
  }

  const criterionLines: number[] = [];
  const outsideLines: number[] = [];
  const unrecognizedLines: number[] = [];
  const ledgerItems: MatchItem[] = [];
  const outsideKeys = new Set<string>();
  const findings: IntegrationFinding[] = [];
  for (const l of lines) {
    if (l.verba === null) {
      unrecognizedLines.push(l.index);
      findings.push({
        code: 'F1d',
        severity: 'warning',
        branch: l.branch,
        verba: null,
        payroll: null,
        ledger: l.amount,
        lines: [l.index],
        message: `Linha de integração da filial ${l.branch} sem verba reconhecível no histórico (${formatCents(l.amount)}).`,
      });
      continue;
    }
    const id = `${l.branch}${SEP}${l.verba}`;
    if (inCriterion(l.verba)) criterionLines.push(l.index);
    else {
      outsideLines.push(l.index);
      outsideKeys.add(id);
    }
    ledgerItems.push({ key: id, amount: l.amount, date: l.date, index: l.index });
  }
  // Payroll side of the keys outside the criterion (D-12): the value of the verba as printed in the branch block.
  for (const id of outsideKeys) {
    const [branch, verba] = id.split(SEP) as [string, string];
    payrollItems.push({ key: id, amount: branches.get(branch)?.get(verba)?.amountCents ?? 0, date: 0, index: payrollItems.length });
  }

  const keys: IntegrationKey[] = matchByKey(payrollItems, ledgerItems).map((m) => {
    const [branch, verba] = m.key.split(SEP) as [string, string];
    const inLedger = m.rightItems.length > 0;
    const status = inLedger ? (Math.abs(m.left) === Math.abs(m.right) ? 'equal' : 'different') : m.left !== 0 ? 'missing' : 'zero';
    const column = branches.get(branch)?.get(verba)?.column ?? columnOf.get(verba) ?? null;
    return { branch, verba, column, role: roleOf(verba), payroll: m.left, ledger: m.right, lines: m.rightItems, status };
  });
  const roleText: Record<IntegrationKeyRole, string> = { criterion: '', settlement: ' (verba de baixa do saldo anterior)', outside: ' (verba fora do critério)' };
  for (const k of keys) {
    if (k.status === 'different') {
      const ledger = Math.abs(k.ledger);
      const payroll = Math.abs(k.payroll);
      findings.push({
        code: 'F1a',
        severity: 'error',
        branch: k.branch,
        verba: k.verba,
        payroll: k.payroll,
        ledger: k.ledger,
        lines: k.lines,
        message: `Verba ${k.verba}${roleText[k.role]} na filial ${k.branch}, em valor absoluto: integração ${formatCents(ledger)}, folha ${formatCents(payroll)} (diferença ${formatCents(ledger - payroll)}).`,
      });
    } else if (k.status === 'missing') {
      findings.push({
        code: 'F1c',
        severity: 'warning',
        branch: k.branch,
        verba: k.verba,
        payroll: k.payroll,
        ledger: null,
        lines: [],
        message: `Verba ${k.verba} da folha na filial ${k.branch} (${formatCents(k.payroll)}) sem integração na conta.`,
      });
    }
  }
  // F1b and F1e by key, in the order of the keys (branch, verba); a key may also be an F1a (D-12).
  for (const k of keys) {
    if (k.role !== 'outside') continue;
    if (account.mode === 'netPay' && columnOf.get(k.verba) === 'B') {
      findings.push({ code: 'F1e', severity: 'info', branch: k.branch, verba: k.verba, payroll: null, ledger: k.ledger, lines: k.lines, message: `Integração da verba ${k.verba} (coluna B da folha) na filial ${k.branch} (${formatCents(k.ledger)}).` });
    } else {
      findings.push({ code: 'F1b', severity: 'warning', branch: k.branch, verba: k.verba, payroll: null, ledger: k.ledger, lines: k.lines, message: `Integração da verba ${k.verba}, fora do critério da conta, na filial ${k.branch} (${formatCents(k.ledger)}).` });
    }
  }
  const order: Record<IntegrationFindingCode, number> = { F1a: 0, F1c: 1, F1b: 2, F1d: 3, F1e: 4 };
  findings.sort((a, b) => order[a.code] - order[b.code]);

  return {
    keys,
    findings,
    criterionLines,
    outsideLines,
    unrecognizedLines,
    payrollTotal: keys.reduce((s, k) => s + (k.role === 'criterion' ? k.payroll : 0), 0),
    ledgerTotal: keys.reduce((s, k) => s + k.ledger, 0),
    checkedLinesTotal: lines.filter((l) => l.verba !== null).reduce((s, l) => s + l.amount, 0),
  };
}
