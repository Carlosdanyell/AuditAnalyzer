/**
 * What the screens of the Conciliador receive from the analysis (docs/REGRAS_CONCILIADOR.md, section 9; Phase 15, step
 * 5), pure: the rows of the Painel (one per account of the profile), the key figures, the findings of the session
 * (Achados, by severity, no filter by value: D-7), the combined ledger view of the Reconciliação and the side panel of an
 * account (criterion, bridge with its lines, settlement, text of the criterion). Every amount of an account is in its
 * natural side, as the engine gives it.
 */
import type { PayrollProfileConfig } from '../../../config/reconciliationSchema';
import type {
  LedgerViewAccount,
  ReconciliationAccountDetail,
  ReconciliationAccountRow,
  ReconciliationFinding,
  ReconciliationLineView,
  ReconciliationSeverity,
  ReconciliationSummary,
} from '../../../shared/modules/reconciliation';
import type { CheckResult } from '../../../shared/protocol';
import type { CombinedLedgerAccount } from './ledger';
import type { PayrollAccountResult, PayrollAnalysis } from './profiles/payroll/analyze';

/** Lines of each parcel the side panel shows; the Razão table has all of them. */
export const LINES_SHOWN = 100;

const SEVERITY_ORDER: Record<ReconciliationSeverity, number> = { error: 0, warning: 1, info: 2 };

/** A finding with the lines it points to (the rows of Tabelas › Razão opened by it). */
export interface SessionFinding extends ReconciliationFinding {
  /** Indices in the account's lines of the competence, or in its lines after the competence (`part: 'after'`). */
  lineIndices: number[];
  part: 'competence' | 'after';
}

/** A finding as the screen receives it (without the line indices, which stay in the worker). */
const publicFinding = (f: SessionFinding): ReconciliationFinding => ({ code: f.code, severity: f.severity, accountIndex: f.accountIndex, account: f.account, branch: f.branch, verba: f.verba, message: f.message, lines: f.lines });

const LEVEL_NAMES = { groupOfCompanies: 'Grupo de Empresas', company: 'Empresa' } as const;

export function scopeLabel(profile: PayrollProfileConfig): string {
  const s = profile.payrollReport.scope;
  return `${LEVEL_NAMES[s.level]} / ${s.contractType}`;
}

/** The view of an account of the profile in the combined ledger (null when it is not in the ledger). */
export function ledgerViewOf(analysis: PayrollAnalysis, account: string): CombinedLedgerAccount | null {
  return analysis.ledger.accounts.find((a) => a.account === account) ?? null;
}

/** Every finding of the session, in the order of Achados: severity, account of the profile, order of the engine. */
export function sessionFindings(analysis: PayrollAnalysis): SessionFinding[] {
  const out: SessionFinding[] = [];
  const inProfile = new Set(analysis.accounts.map((a) => a.account));
  analysis.accounts.forEach((a, accountIndex) => {
    for (const f of a.findings) {
      const lines = f.lines ?? [];
      out.push({ code: f.code, severity: f.severity, accountIndex, account: a.account, branch: f.branch ?? null, verba: f.verba ?? null, message: f.message, lines: lines.length, lineIndices: lines, part: 'competence' });
    }
    const view = a.status === 'analyzed' ? ledgerViewOf(analysis, a.account) : null;
    if (view && view.after.length > 0) {
      out.push({
        code: 'OUT',
        severity: 'info',
        accountIndex,
        account: a.account,
        branch: null,
        verba: null,
        message: `${view.after.length} lançamento(s) depois do último dia da competência, fora da análise (seção 5.5).`,
        lines: view.after.length,
        lineIndices: view.after.map((_, i) => i),
        part: 'after',
      });
    }
  });
  // The T findings of ledger accounts outside the profile (the engine gives those of the profile with each account).
  for (const f of analysis.ledger.findings) {
    if (!inProfile.has(f.account)) out.push({ code: f.code, severity: f.severity, accountIndex: null, account: f.account, branch: null, verba: null, message: f.message, lines: 0, lineIndices: [], part: 'competence' });
  }
  return out
    .map((f, i) => ({ f, i }))
    .sort((x, y) => SEVERITY_ORDER[x.f.severity] - SEVERITY_ORDER[y.f.severity] || (x.f.accountIndex ?? Infinity) - (y.f.accountIndex ?? Infinity) || x.i - y.i)
    .map((x) => x.f);
}

function findingCounts(findings: readonly SessionFinding[], accountIndex: number): Record<ReconciliationSeverity, number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) if (f.accountIndex === accountIndex) counts[f.severity]++;
  return counts;
}

export function accountRow(a: PayrollAccountResult, index: number, findings: readonly SessionFinding[]): ReconciliationAccountRow {
  const analyzed = a.status === 'analyzed';
  const types = Object.keys(a.balanceByType) as ('1' | '9')[];
  return {
    index,
    tickMark: a.tickMark,
    account: a.account,
    name: a.name,
    pattern: a.mode === 'provision' ? 'B' : 'A',
    mode: a.mode,
    naturalSide: a.naturalSide,
    status: a.status,
    reason: a.reason,
    expected: analyzed ? a.expected!.amount : null,
    competenceOpening: analyzed ? a.competenceOpening : null,
    balanceReal: a.balanceByType['1'] ?? null,
    balancePreEntry: a.balanceByType['9'] ?? null,
    balance: analyzed ? a.ledgerBalance : null,
    difference: analyzed ? a.difference : null,
    situation: a.situation,
    settlement: a.settlement ? { situation: a.settlement.situation, lines: a.settlement.settled.length, amount: a.settlement.settledAmount } : null,
    missingType: analyzed && types.length === 1 ? (types[0] === '1' ? '9' : '1') : null,
    findings: findingCounts(findings, index),
    bridgeCloses: a.bridge ? a.bridge.closes : null,
  };
}

/** The summary of the session: the rows of the Painel, the key figures and the findings. */
export function reconciliationSummary(analysis: PayrollAnalysis, profile: PayrollProfileConfig, checks: readonly CheckResult[]): ReconciliationSummary {
  const findings = sessionFindings(analysis);
  const analyzed = analysis.accounts.filter((a) => a.status === 'analyzed');
  const count = (code: string) => findings.filter((f) => f.code === code).length;
  return {
    module: 'reconciliation',
    period: analysis.period,
    competence: analysis.competence,
    scopeLabel: scopeLabel(profile),
    accounts: analysis.accounts.map((a, i) => accountRow(a, i, findings)),
    figures: {
      accounts: analysis.accounts.length,
      analyzed: analyzed.length,
      noDifference: analyzed.filter((a) => a.difference === 0).length,
      withDifference: analyzed.filter((a) => a.difference !== 0).length,
      integrationErrors: count('F1a'),
      missingIntegration: count('F1c'),
      checkedLines: analysis.integration.checkedLines,
      keys: analysis.integration.keys,
      divergentKeys: analysis.integration.divergent,
    },
    findings: findings.map(publicFinding),
    workpaperStatuses: profile.workpaperStatuses ?? [],
    blocking: checks.filter((c) => c.severity === 'error' && !c.passed).length,
  };
}

/** The accounts of the combined ledger view (Reconciliação), credit positive as the ledger prints them. */
export function ledgerViewAccounts(analysis: PayrollAnalysis, profile: PayrollProfileConfig): LedgerViewAccount[] {
  const inProfile = new Set(profile.accounts.map((a) => a.account));
  return analysis.ledger.accounts.map((a) => {
    const types = (['1', '9'] as const).filter((t) => a.types[t]);
    return {
      account: a.account,
      description: a.description,
      inProfile: inProfile.has(a.account),
      types,
      missing: types.length === 1 ? (types[0] === '1' ? '9' : '1') : null,
      openingBalance: a.openingBalance,
      competenceOpening: a.competenceOpening,
      competenceClosing: a.competenceClosing,
      linesBefore: a.before.length,
      linesWithin: a.lines.length,
      linesAfter: a.after.length,
      preEntryLines: a.lines.filter((l) => l.balanceType === '9').length,
    };
  });
}

export function lineView(a: PayrollAccountResult, i: number, settled: ReadonlySet<number>): ReconciliationLineView {
  const l = a.lines[i]!;
  return {
    index: i,
    date: l.date,
    key: l.key,
    history: l.history,
    branch: l.ledgerBranch,
    costCenter: l.costCenter,
    balanceType: l.balanceType,
    batchClass: l.batchClass,
    verba: l.verba,
    debit: l.debit,
    credit: l.credit,
    amount: a.amounts[i]!,
    settled: settled.has(i),
  };
}

/** The side panel of an account. */
export function accountDetail(analysis: PayrollAnalysis, profile: PayrollProfileConfig, index: number): ReconciliationAccountDetail {
  const a = analysis.accounts[index];
  if (!a) throw new Error(`Conta ${index} fora do perfil.`);
  const findings = sessionFindings(analysis);
  const config = profile.accounts[index]!;
  const settled = new Set(a.settlement?.settled ?? []);
  const view = (i: number) => lineView(a, i, settled);
  return {
    row: accountRow(a, index, findings),
    criterion: {
      mode: a.mode,
      scopeLabel: scopeLabel(profile),
      verbas: (a.expected?.verbas ?? []).map((v) => ({ ...v })),
      settlementVerbas: config.mode === 'verbas' ? [...(config.settlementVerbas ?? [])] : [],
    },
    ledgerOpening: a.status === 'analyzed' ? a.ledgerOpening : null,
    bridge: a.bridge
      ? {
          parcels: a.bridge.parcels.map((p) => ({ id: p.id, label: p.label, base: p.base, amount: p.amount, lineCount: p.lines.length, lines: p.lines.slice(0, LINES_SHOWN).map(view), byType: { ...p.byType } })),
          total: a.bridge.total,
          ledgerBalance: a.bridge.ledgerBalance,
          closes: a.bridge.closes,
        }
      : null,
    settlement: a.settlement
      ? {
          situation: a.settlement.situation,
          target: a.settlement.target,
          candidates: a.settlement.candidates.length,
          settledAmount: a.settlement.settledAmount,
          settled: a.settlement.settled.map(view),
          runnerUp: a.settlement.runnerUp ? a.settlement.runnerUp.map(view) : null,
        }
      : null,
    narrative: a.narrative,
    findings: findings.filter((f) => f.accountIndex === index).map(publicFinding),
    linesShown: LINES_SHOWN,
  };
}
