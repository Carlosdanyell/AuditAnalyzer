/**
 * Engine of the payroll profile, Padrão A (docs/REGRAS_CONCILIADOR.md, sections 7 and 11), pure and testable outside the
 * worker: from the GPER040 read (reports/gper040.ts) and the ledger readings of the session (reports/ctbr400.ts), it
 * combines the ledgers at the competence of the payroll (../../ledger.ts, 5.5 and 5.7) and returns, per account of the
 * profile, the expected value (F2), the opening balance of the competence, the book balance, the difference, the
 * integration check (F1), the settlement of the opening balance (F3), the bridge (F4), the findings, the suggested
 * situation (7.6), the text of the criterion (7.7) and the invariants CC-1 to CC-4. CC-5 (same input and configuration
 * = same output, whatever the format) is a property of this function, proved by the tests.
 *
 * Every amount of an account is signed in its natural side (error 5 of the phase): the ledger prints credit positive;
 * a debit-side account (asset) is turned around here, once.
 */
import type { PayrollProfileConfig } from '../../../../../config/reconciliationSchema';
import { formatCents } from '../../../../../shared/format';
import type { LedgerBalanceType } from '../../../../../shared/modules/reconciliation';
import type { CheckResult } from '../../../../../shared/protocol';
import { buildBridge } from '../../bridge';
import { combineLedgers, type BatchClassId, type CombinedLedger, type CombinedLedgerLine, type LedgerFileReading } from '../../ledger';
import type { MatchItem } from '../../match/item';
import { competenceDays, type CompetenceDays } from '../../reports/ctbr400';
import type { PayrollReport } from '../../reports/gper040';
import { expectedOf, payrollScopes, type ExpectedResult, type PatternAAccount } from './expected';
import { accountFindings, suggestedSituation, type AccountFinding, type SuggestedSituation } from './findings';
import { checkIntegration, type IntegrationResult } from './integration';
import { criterionText } from './narrative';
import { findSettlement, type SettlementResult } from './settlement';

export interface PayrollAnalysisInput {
  payroll: PayrollReport;
  ledgers: readonly LedgerFileReading[];
  profile: PayrollProfileConfig;
}

export const BATCH_CLASS_ORDER: readonly BatchClassId[] = ['integration', 'financial', 'manual', 'other'];

/** Parcels of the bridge of 7.5, in order; the 5th is one parcel per class of batch (`movement:<class>`). */
export const PAYROLL_PARCEL_LABELS = {
  expected: 'Esperado pela folha',
  criterion: 'Integração das verbas do critério menos o esperado',
  outside: 'Integração de verbas fora do critério',
  opening: 'Saldo inicial da competência menos a baixa identificada',
  movement: 'Demais movimentos da competência',
} as const;

export interface PayrollBridgeParcel {
  id: string;
  label: string;
  /** Fixed part (expected value, opening balance) and the account's lines in the parcel (indices in its lines). */
  base: number;
  lines: number[];
  amount: number;
  /** Σ of its lines by balance type (5.7: the bridge separates the movements by class and by balance type). */
  byType: Partial<Record<LedgerBalanceType, number>>;
}

export interface PayrollBridge {
  parcels: PayrollBridgeParcel[];
  total: number;
  ledgerBalance: number;
  closes: boolean;
  unassigned: number[];
  repeated: number[];
}

export interface PayrollAccountResult {
  account: string;
  name: string;
  naturalSide: 'D' | 'C';
  tickMark: string;
  mode: PayrollProfileConfig['accounts'][number]['mode'];
  /** `notInLedger`: CC-1 (warning, out of the analysis); `notAnalyzed`: the source report is not in the session. */
  status: 'analyzed' | 'notInLedger' | 'notAnalyzed';
  reason: string | null;
  expected: ExpectedResult | null;
  /** Opening balance of the ledger report(s), at their start date (natural side). */
  ledgerOpening: number;
  /** Opening balance of the competence (5.5; natural side): the "saldo anterior" of the engine. */
  competenceOpening: number;
  /** Book balance at the last day of the competence (natural side), combined and by balance type. */
  ledgerBalance: number;
  balanceByType: Partial<Record<LedgerBalanceType, number>>;
  /** Movement of the competence by class of batch (natural side). */
  movements: Record<BatchClassId, number>;
  /** Expected − book balance (suporte − contábil, 7.3). */
  difference: number;
  /** Lines of the competence (both types, order (date, key)): the indices of every other field point here. */
  lines: CombinedLedgerLine[];
  /** Amount of each line in the natural side. */
  amounts: number[];
  integration: IntegrationResult | null;
  settlement: SettlementResult | null;
  bridge: PayrollBridge | null;
  findings: AccountFinding[];
  /** 7.6; null when the account is not analyzed. */
  situation: SuggestedSituation | null;
  narrative: string;
  invariants: { 'CC-2': boolean; 'CC-3': boolean; 'CC-4': boolean } | null;
}

export interface PayrollAnalysis {
  period: string;
  competence: CompetenceDays;
  accounts: PayrollAccountResult[];
  /** The combined view of the ledgers (R-7, R-8, T1–T3). */
  ledger: CombinedLedger;
  /**
   * Keys branch × verba of every analyzed account: all, with lines in the ledger (compared), and different (F1a); the
   * integration lines compared with the payroll (every one with a recognized verba, D-12) and those of the criterion.
   */
  integration: { keys: number; checked: number; divergent: number; checkedLines: number; criterionLines: number };
  /** CC-1 to CC-4 and the scope of the payroll. */
  checks: CheckResult[];
}

/** The ledger prints credit positive: natural side C keeps it, D turns it around. */
const natural = (side: 'D' | 'C', creditPositive: number) => (side === 'C' ? creditPositive : -creditPositive);

const SHOWN = 5;
const listed = (items: string[]) => `${items.slice(0, SHOWN).join('; ')}${items.length > SHOWN ? `; e mais ${items.length - SHOWN}` : ''}`;

function competenceOf(period: string | null): CompetenceDays {
  if (period === null || !/^\d{6}$/.test(period)) throw new Error(`GPER040 sem competência (Periodo: AAAAMM) legível: ${period ?? 'ausente'}.`);
  return competenceDays(Number.parseInt(period.slice(0, 4), 10), Number.parseInt(period.slice(4), 10));
}

function emptyResult(a: PayrollProfileConfig['accounts'][number], status: 'notInLedger' | 'notAnalyzed', reason: string): PayrollAccountResult {
  return {
    account: a.account,
    name: a.name,
    naturalSide: a.naturalSide,
    tickMark: a.tickMark,
    mode: a.mode,
    status,
    reason,
    expected: null,
    ledgerOpening: 0,
    competenceOpening: 0,
    ledgerBalance: 0,
    balanceByType: {},
    movements: { integration: 0, financial: 0, manual: 0, other: 0 },
    difference: 0,
    lines: [],
    amounts: [],
    integration: null,
    settlement: null,
    bridge: null,
    findings: [],
    situation: null,
    narrative: '',
    invariants: null,
  };
}

export function analyzePayroll(input: PayrollAnalysisInput): PayrollAnalysis {
  const { payroll, profile } = input;
  const period = payroll.period ?? '';
  const competence = competenceOf(payroll.period);
  const ledger = combineLedgers(input.ledgers, competence, profile.ledger);
  const scopeConfig = profile.payrollReport.scope;
  const scopes = payrollScopes(payroll, scopeConfig);
  const classLabel = (id: BatchClassId) => profile.ledger.batchClasses.find((c) => c.id === id)?.label ?? (id === 'other' ? 'Outros' : id);

  const accounts: PayrollAccountResult[] = [];
  for (const a of profile.accounts) {
    if (a.mode === 'provision') {
      accounts.push(emptyResult(a, 'notAnalyzed', `não analisada — falta ${a.report === 'vacation' ? 'GPER070' : 'GPER090'}`));
      continue;
    }
    const view = ledger.accounts.find((x) => x.account === a.account);
    if (!view) {
      accounts.push(emptyResult(a, 'notInLedger', 'conta fora da análise — não está no razão (CC-1)'));
      continue;
    }
    if (!scopes.scope) {
      accounts.push(emptyResult(a, 'notAnalyzed', 'não analisada — o GPER040 não tem o bloco do escopo do perfil'));
      continue;
    }
    accounts.push(analyzeAccount(a, view, payroll, scopes, period, profile, ledger, classLabel));
  }

  const analyzed = accounts.filter((x) => x.status === 'analyzed');
  const failing = (id: 'CC-2' | 'CC-3' | 'CC-4') => analyzed.filter((x) => !x.invariants![id]);
  const notInLedger = accounts.filter((x) => x.status === 'notInLedger');
  const keys = analyzed.flatMap((x) => x.integration!.keys);
  const scopeName = `${scopeConfig.level === 'groupOfCompanies' ? 'Grupo de Empresas' : 'Empresa'} / ${scopeConfig.contractType}`;
  const checks: CheckResult[] = [
    {
      id: 'F2',
      label: 'Bloco do escopo da folha (payrollReport.scope) no GPER040',
      severity: 'error',
      passed: scopes.scope !== null,
      message: scopes.scope ? `Escopo ${scopeName} encontrado (linha ${scopes.scope.labelLine}).` : `O GPER040 não tem o bloco ${scopeName}: o esperado das contas não pode ser calculado.`,
    },
    {
      id: 'CC-1',
      label: 'Toda conta do perfil com fonte carregada existe no razão',
      severity: 'warning',
      passed: notInLedger.length === 0,
      message: notInLedger.length === 0 ? `${analyzed.length} conta(s) do perfil no razão.` : `Fora da análise, sem razão: ${listed(notInLedger.map((x) => x.account))}.`,
    },
    {
      id: 'CC-2',
      label: 'Toda linha da competência numa única parcela da ponte',
      severity: 'error',
      passed: failing('CC-2').length === 0,
      message:
        failing('CC-2').length === 0
          ? `${analyzed.reduce((n, x) => n + x.lines.length, 0)} linha(s) da competência, cada uma numa parcela.`
          : listed(failing('CC-2').map((x) => `conta ${x.account}: ${x.bridge!.unassigned.length} linha(s) fora da ponte, ${x.bridge!.repeated.length} em mais de uma parcela`)),
    },
    {
      id: 'CC-3',
      label: 'Ponte do esperado ao saldo contábil fecha em centavos',
      severity: 'error',
      passed: failing('CC-3').length === 0,
      message: failing('CC-3').length === 0 ? `A ponte fecha em ${analyzed.length} conta(s).` : listed(failing('CC-3').map((x) => `conta ${x.account}: Σ parcelas ${formatCents(x.bridge!.total)}, saldo contábil ${formatCents(x.ledgerBalance)}`)),
    },
    {
      id: 'CC-4',
      label: 'Chaves verba × filial: lado do razão = linhas de integração conferidas; lado da folha do critério = esperado',
      severity: 'error',
      passed: failing('CC-4').length === 0,
      message:
        failing('CC-4').length === 0
          ? `${keys.length} chave(s) verba × filial conferem com as linhas de integração e, as do critério, com o esperado.`
          : listed(
              failing('CC-4').map(
                (x) => `conta ${x.account}: razão nas chaves ${formatCents(x.integration!.ledgerTotal)}, linhas conferidas ${formatCents(x.integration!.checkedLinesTotal)}; folha nas chaves do critério ${formatCents(x.integration!.payrollTotal)}, esperado ${formatCents(x.expected!.amount)}`,
              ),
            ),
    },
  ];
  return {
    period,
    competence,
    accounts,
    ledger,
    integration: {
      keys: keys.length,
      checked: keys.filter((k) => k.status === 'equal' || k.status === 'different').length,
      divergent: keys.filter((k) => k.status === 'different').length,
      checkedLines: analyzed.reduce((n, x) => n + x.integration!.criterionLines.length + x.integration!.outsideLines.length, 0),
      criterionLines: analyzed.reduce((n, x) => n + x.integration!.criterionLines.length, 0),
    },
    checks,
  };
}

function analyzeAccount(
  a: PatternAAccount,
  view: CombinedLedger['accounts'][number],
  payroll: PayrollReport,
  scopes: ReturnType<typeof payrollScopes>,
  period: string,
  profile: PayrollProfileConfig,
  ledger: CombinedLedger,
  classLabel: (id: BatchClassId) => string,
): PayrollAccountResult {
  const side = a.naturalSide;
  const lines = view.lines;
  const amounts = lines.map((l) => natural(side, l.credit - l.debit));
  const expected = expectedOf(a, payroll, scopes.scope!);
  const competenceOpening = natural(side, view.competenceOpening);
  const ledgerBalance = natural(side, view.competenceClosing);
  const difference = expected.amount - ledgerBalance;
  const movements: Record<BatchClassId, number> = { integration: 0, financial: 0, manual: 0, other: 0 };
  lines.forEach((l, i) => (movements[l.batchClass] += amounts[i]!));

  const integrationLines = lines.flatMap((l, i) => (l.batchClass === 'integration' ? [{ index: i, date: l.date, key: l.key, branch: l.ledgerBranch, verba: l.verba, amount: amounts[i]! }] : []));
  const integration = checkIntegration(a, integrationLines, scopes.branches, payroll.columnOf);
  const settlement = findSettlement(
    competenceOpening,
    lines.map((l, i) => ({ index: i, date: l.date, key: l.key, amount: amounts[i]! })),
    new Set(integration.criterionLines),
    profile.settlementSearch.maxCandidates,
  );

  // Bridge (7.5): every line of the competence in one parcel; the settled lines in the 4th.
  const settled = new Set(settlement.settled);
  const taken = new Set([...integration.criterionLines, ...integration.outsideLines, ...settled]);
  const parcels = [
    { id: 'expected', label: PAYROLL_PARCEL_LABELS.expected, base: expected.amount, items: [] as number[] },
    { id: 'criterion', label: PAYROLL_PARCEL_LABELS.criterion, base: -expected.amount, items: integration.criterionLines },
    { id: 'outside', label: PAYROLL_PARCEL_LABELS.outside, base: 0, items: integration.outsideLines.filter((i) => !settled.has(i)) },
    { id: 'opening', label: PAYROLL_PARCEL_LABELS.opening, base: competenceOpening, items: settlement.settled },
    ...BATCH_CLASS_ORDER.map((c) => ({ id: `movement:${c}`, label: `${PAYROLL_PARCEL_LABELS.movement}: ${classLabel(c)}`, base: 0, items: lines.flatMap((l, i) => (l.batchClass === c && !taken.has(i) ? [i] : [])) })).filter(
      (p) => p.items.length > 0,
    ),
  ];
  const items: MatchItem[] = lines.map((l, i) => ({ key: l.key, amount: amounts[i]!, date: l.date, index: i }));
  const b = buildBridge({ closing: ledgerBalance, items, parcels });
  const bridge: PayrollBridge = {
    parcels: b.parcels.map((p) => {
      const byType: Partial<Record<LedgerBalanceType, number>> = {};
      for (const i of p.items) byType[lines[i]!.balanceType] = (byType[lines[i]!.balanceType] ?? 0) + amounts[i]!;
      return { id: p.id, label: p.label, base: p.base, lines: p.items, amount: p.amount, byType };
    }),
    total: b.total,
    ledgerBalance,
    closes: b.closes,
    unassigned: b.unassigned,
    repeated: b.repeated,
  };

  const findings = accountFindings(a.account, integration.findings, difference, settlement, ledger.findings);
  const balanceByType: Partial<Record<LedgerBalanceType, number>> = {};
  for (const t of ['1', '9'] as const) {
    const part = view.types[t];
    if (part) balanceByType[t] = natural(side, part.competenceClosing);
  }
  const identified = settlement.situation === 'IDENTIFICADA';
  const narrative = criterionText({
    period,
    scope: profile.payrollReport.scope,
    expected,
    ledgerBalance: view.competenceClosing,
    difference,
    parcels: bridge.parcels.slice(1),
    settlement: identified ? { opening: competenceOpening, dates: settlement.settled.map((i) => lines[i]!.date) } : null,
  });
  return {
    account: a.account,
    name: a.name,
    naturalSide: side,
    tickMark: a.tickMark,
    mode: a.mode,
    status: 'analyzed',
    reason: null,
    expected,
    ledgerOpening: natural(side, view.openingBalance),
    competenceOpening,
    ledgerBalance,
    balanceByType,
    movements,
    difference,
    lines,
    amounts,
    integration,
    settlement,
    bridge,
    findings,
    situation: suggestedSituation(difference, findings, settlement.situation),
    narrative,
    invariants: {
      'CC-2': b.unassigned.length === 0 && b.repeated.length === 0 && b.unknown.length === 0,
      'CC-3': b.total === ledgerBalance,
      'CC-4': integration.ledgerTotal === integration.checkedLinesTotal && integration.payrollTotal === expected.amount,
    },
  };
}
